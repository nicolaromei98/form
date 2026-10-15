import type { IsoWeekKey } from "@/lib/domain/dates";
import { ESTIMATE_MAX_DAYS, PROPOSAL_ITEMS_MAX } from "@/lib/domain/limits";
import { compareKeys } from "@/lib/domain/order";
import type { PersonId, ProjectId, TaskId } from "@/lib/domain/schema/ids";
import type { IsoDate } from "@/lib/domain/schema/primitives";
import type { Person, WorkspaceDoc } from "@/lib/domain/schema/workspace";
import { fmtDays } from "@/lib/planning/format";
import { capacityInWeek, countsForLoad, openTaskLoads, roundLoad, taskWeeks, type LoadPlan, type TaskLoad, type TaskWeek } from "@/lib/planning/load";
import type { ScheduledTiming } from "@/lib/planning/schedule";

/**
 * Balance v2 (plan §6.6, FORM-v1 §7.5): handovers that bring people back within capacity, week
 * by week, across every project that counts. Only tasks of the project in scope move.
 *
 * 1. **Unowned work** (optional): each open, dated task with no active owner goes to the person
 *    with the most room who can take it in every one of its weeks (v0 parity).
 * 2. **Handovers**, up to `maxMoves` times:
 *    - the giver is the person most over capacity across their lane window (the weeks of their
 *      open, dated work in scope: the Team lane's `over`, so the sentence and the lane agree);
 *    - candidates are the giver's To-do and In-progress tasks in scope (never Review or Done)
 *      that fall in one of their overloaded weeks, least under way first, then workflow order;
 *    - a receiver is an active person with a known capacity whose free capacity covers the
 *      task's share in **every** week of the task; receivers rank by the giver's role (trimmed,
 *      case-insensitive), then the largest minimum free capacity over the task's weeks, then name;
 *    - loads update after each move.
 * 3. **Shift** (when nothing fits and `allowShift`): the candidate with known float ≥ 1 whose
 *    smallest shift s ≤ float clears the giver's overload in every week of the shifted window.
 *    It ends the run: a shift moves successors too, so later figures would need a new schedule.
 *
 * When an overloaded giver remains and nothing fits, `blocked` names them. At most
 * `PROPOSAL_ITEMS_MAX` moves in all, so the result fits one reassign proposal. O(M·C·R·W).
 */

/* ------------------------------------------------------------------
   Types
   ------------------------------------------------------------------ */

export type BalanceMove =
  | { readonly type: "owner"; readonly taskId: TaskId; readonly from: PersonId | null; readonly to: PersonId; readonly why: string }
  | { readonly type: "shift"; readonly taskId: TaskId; readonly days: number; readonly pinnedStart: IsoDate; readonly why: string };

export interface BalanceOptions {
  /** Propose a shift within float when no handover fits (default true; /demo passes false) */
  allowShift?: boolean;
  /** Handover rounds (default 8) */
  maxMoves?: number;
  /** Give unowned work to whoever has room first (default true) */
  assignUnowned?: boolean;
}

export interface BalanceResult {
  readonly moves: readonly BalanceMove[];
  /** The person still over capacity when nothing fits, with their overload; null otherwise */
  readonly blocked: { readonly personId: PersonId; readonly over: number } | null;
}

/** Load comparisons allow for float noise in summed shares */
const EPS = 1e-9;

/* ------------------------------------------------------------------
   The load model
   ------------------------------------------------------------------ */

/** Everyone's load per week, updated move by move; capacities computed once per person and week */
class Loads {
  private readonly load = new Map<PersonId, Map<IsoWeekKey, number>>();
  private readonly caps = new Map<PersonId, Map<IsoWeekKey, number | null>>();

  constructor(private readonly ws: Pick<WorkspaceDoc, "people" | "workingDays" | "closures">) {}

  add(personId: PersonId, weeks: readonly TaskWeek[], sign: 1 | -1): void {
    let byWeek = this.load.get(personId);
    if (byWeek === undefined) this.load.set(personId, (byWeek = new Map()));
    for (const w of weeks) byWeek.set(w.week, (byWeek.get(w.week) ?? 0) + sign * w.load);
  }

  loadOf(personId: PersonId, week: IsoWeekKey): number {
    return this.load.get(personId)?.get(week) ?? 0;
  }

  capOf(person: Person, week: Pick<TaskWeek, "week" | "monday">): number | null {
    let byWeek = this.caps.get(person.id);
    if (byWeek === undefined) this.caps.set(person.id, (byWeek = new Map()));
    let cap = byWeek.get(week.week);
    if (cap === undefined) byWeek.set(week.week, (cap = capacityInWeek(this.ws, person, week.monday)));
    return cap;
  }

  /** Capacity left in a week; null when the capacity is unknown */
  freeOf(person: Person, week: Pick<TaskWeek, "week" | "monday">): number | null {
    const cap = this.capOf(person, week);
    return cap === null ? null : cap - this.loadOf(person.id, week.week);
  }
}

/** A task of the project in scope, with its current carrier */
interface ScopeTask extends TaskLoad {
  personId: PersonId | null;
  weeks: readonly TaskWeek[] | null;
}

const normaliseRole = (role: string | null) => (role === null ? "" : role.trim().toLowerCase());
const byName = (a: Person, b: Person) => compareKeys(a.name, b.name) || compareKeys(a.id, b.id);

/* ------------------------------------------------------------------
   Balance
   ------------------------------------------------------------------ */

export function balance(
  ws: Pick<WorkspaceDoc, "people" | "projects" | "workingDays" | "closures">,
  plans: readonly LoadPlan[],
  scope: ProjectId,
  opts: BalanceOptions = {},
): BalanceResult {
  const allowShift = opts.allowShift ?? true;
  const maxMoves = opts.maxMoves ?? 8;
  const assignUnowned = opts.assignUnowned ?? true;
  const scopePlan = plans.find((p) => p.project.id === scope);
  if (scopePlan === undefined) return Object.freeze({ moves: Object.freeze([]), blocked: null });

  const people = Object.values(ws.people)
    .filter((p) => !p.archived)
    .sort((a, b) => compareKeys(a.order, b.order) || compareKeys(a.id, b.id));
  const loads = new Loads(ws);
  let tasks: ScopeTask[] = [];
  for (const plan of [...plans].sort((a, b) => compareKeys(a.project.id, b.project.id))) {
    const inScope = plan.project.id === scope;
    if (!inScope && !countsForLoad(ws, plan.project)) continue;
    const open = openTaskLoads(ws, plan);
    for (const t of open) if (t.personId !== null && t.weeks !== null) loads.add(t.personId, t.weeks, 1);
    if (inScope) tasks = open.map((t) => ({ ...t }));
  }

  const moves: BalanceMove[] = [];
  const room = () => moves.length < PROPOSAL_ITEMS_MAX;

  /** The people who can take `weeks`, best first: free capacity covers every week */
  const receiversFor = (weeks: readonly TaskWeek[], except: PersonId | null, role: string) => {
    const fits: { person: Person; minFree: number; sameRole: boolean }[] = [];
    for (const person of people) {
      if (person.id === except || person.capacityDaysPerWeek === null) continue;
      let minFree = Number.POSITIVE_INFINITY;
      for (const w of weeks) {
        const free = loads.freeOf(person, w)!;
        if (free < w.load - EPS) {
          minFree = Number.NEGATIVE_INFINITY;
          break;
        }
        minFree = Math.min(minFree, free);
      }
      if (minFree === Number.NEGATIVE_INFINITY) continue;
      fits.push({ person, minFree, sameRole: role !== "" && normaliseRole(person.role) === role });
    }
    return fits.sort((a, b) => Number(b.sameRole) - Number(a.sameRole) || b.minFree - a.minFree || byName(a.person, b.person));
  };

  const handOver = (t: ScopeTask, to: Person, why: string) => {
    if (t.personId !== null) loads.add(t.personId, t.weeks!, -1);
    loads.add(to.id, t.weeks!, 1);
    moves.push(Object.freeze({ type: "owner", taskId: t.task.id, from: t.task.ownerId, to: to.id, why }));
    t.personId = to.id;
  };

  // 1. Unowned work goes to whoever has room in every week
  if (assignUnowned) {
    for (const t of tasks) {
      if (!room()) break;
      if (t.personId !== null || t.weeks === null || t.weeks.length === 0) continue;
      const [best] = receiversFor(t.weeks, null, "");
      if (best !== undefined) handOver(t, best.person, `Nobody owns it yet. ${best.person.name} has room for its ${fmtDays(t.task.estimateDays)}.`);
    }
  }

  /** A person's overload across their lane window, and the overloaded weeks */
  const overloadOf = (person: Person) => {
    const window = new Map<IsoWeekKey, TaskWeek>();
    for (const t of tasks) if (t.personId === person.id) for (const w of t.weeks ?? []) window.set(w.week, w);
    let over = 0;
    const weeks = new Set<IsoWeekKey>();
    for (const w of window.values()) {
      const free = loads.freeOf(person, w);
      if (free === null) return { over: 0, weeks };
      if (free < -EPS) {
        over -= free;
        weeks.add(w.week);
      }
    }
    return { over: roundLoad(over), weeks };
  };

  /** Their To-do and In-progress tasks in an overloaded week: least under way first, then workflow order */
  const candidatesOf = (person: Person, weeks: ReadonlySet<IsoWeekKey>) =>
    tasks
      .filter(
        (t) =>
          t.personId === person.id &&
          (t.task.status === "todo" || t.task.status === "active") &&
          t.weeks !== null &&
          t.weeks.some((w) => weeks.has(w.week)),
      )
      .sort((a, b) => a.task.progress - b.task.progress || compareKeys(a.task.order, b.task.order) || compareKeys(a.task.id, b.task.id));

  // 2. Handovers from whoever is most over capacity
  let blocked: BalanceResult["blocked"] = null;
  for (let round = 0; round < maxMoves && room(); round++) {
    const givers = people
      .map((person) => ({ person, ...overloadOf(person) }))
      .filter((g) => g.over > 0)
      .sort((a, b) => b.over - a.over || byName(a.person, b.person));
    if (givers.length === 0) break;

    let moved = false;
    for (const giver of givers) {
      const role = normaliseRole(giver.person.role);
      for (const t of candidatesOf(giver.person, giver.weeks)) {
        const [best] = receiversFor(t.weeks!, giver.person.id, role);
        if (best === undefined) continue;
        handOver(t, best.person, `${giver.person.name} is ${fmtDays(giver.over)} over capacity. ${best.person.name} has room for its ${fmtDays(t.task.estimateDays)}.`);
        moved = true;
        break;
      }
      if (moved) break;
    }
    if (moved) continue;

    // 3. Nothing fits: a shift within float, else blocked
    const shift = allowShift ? shiftFor(givers, candidatesOf, loads, scopePlan) : null;
    if (shift !== null) moves.push(shift);
    else blocked = Object.freeze({ personId: givers[0].person.id, over: givers[0].over });
    break;
  }

  return Object.freeze({ moves: Object.freeze(moves), blocked });
}

/**
 * The smallest shift within float that clears a giver's overload in every week of the shifted
 * window, over the givers in order and their candidates in order. Null when none does.
 */
function shiftFor(
  givers: readonly { person: Person; weeks: ReadonlySet<IsoWeekKey> }[],
  candidatesOf: (person: Person, weeks: ReadonlySet<IsoWeekKey>) => ScopeTask[],
  loads: Loads,
  plan: LoadPlan,
): BalanceMove | null {
  const { schedule, calendar } = plan;
  for (const giver of givers) {
    let best: { t: ScopeTask; s: number; timing: ScheduledTiming } | null = null;
    for (const t of candidatesOf(giver.person, giver.weeks)) {
      const timing = schedule.timings.get(t.task.id);
      if (timing === undefined || timing.kind !== "scheduled" || timing.float === null || timing.float < 1 || timing.start === null) continue;
      const own = new Map(t.weeks!.map((w) => [w.week, w.load]));
      const limit = Math.min(timing.float, ESTIMATE_MAX_DAYS, best === null ? Number.POSITIVE_INFINITY : best.s - 1);
      for (let s = 1; s <= limit; s++) {
        const shifted = shiftedTiming(timing, s, calendar);
        const weeks = shifted === null ? null : taskWeeks(t.task.estimateDays ?? 0, shifted, calendar);
        if (weeks === null) break;
        const clears = weeks.every((w) => {
          const cap = loads.capOf(giver.person, w);
          return cap !== null && loads.loadOf(giver.person.id, w.week) - (own.get(w.week) ?? 0) + w.load <= cap + EPS;
        });
        if (clears) {
          best = { t, s, timing: shifted! };
          break;
        }
      }
    }
    if (best !== null) {
      const { t, s, timing } = best;
      const float = (schedule.timings.get(t.task.id) as ScheduledTiming).float!;
      return Object.freeze({
        type: "shift",
        taskId: t.task.id,
        days: s,
        pinnedStart: timing.start!,
        why: `Shift ${t.task.title} by ${s} ${s === 1 ? "day" : "days"}: it has ${float} ${float === 1 ? "day" : "days"} of float`,
      });
    }
  }
  return null;
}

/** A timing moved `s` working days later on the calendar; null when the dates run out */
function shiftedTiming(timing: ScheduledTiming, s: number, cal: LoadPlan["calendar"]): ScheduledTiming | null {
  try {
    const es = timing.es + s;
    const finish = timing.finish + s;
    return { ...timing, es, finish, last: timing.last + s, start: cal.dateAt(es), end: cal.dateAt(finish - 1) };
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}
