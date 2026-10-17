import { DAY_NUM_MAX, fromDayNum, isoWeek, isoWeekday, toDayNum, type IsoWeekKey } from "@/lib/domain/dates";
import { resolveOwner } from "@/lib/domain/invariants/check";
import { compareKeys, sortedByOrder } from "@/lib/domain/order";
import type { PersonId, ProjectId, TaskId } from "@/lib/domain/schema/ids";
import type { IsoDate } from "@/lib/domain/schema/primitives";
import type { ProjectDoc, Task } from "@/lib/domain/schema/project";
import type { Person, WorkspaceDoc } from "@/lib/domain/schema/workspace";
import { personCalendar, type WorkCalendar } from "@/lib/planning/calendar";
import type { Schedule, ScheduledTiming } from "@/lib/planning/schedule";

/**
 * Weekly load (plan §6.5, FORM-v1 §7.4): what each person carries in each ISO week, across every
 * project that counts, against what they can carry that week.
 *
 * - **Load.** An open task (not Done) whose owner resolves to an active person and that has dates
 *   adds its daily share, `estimateDays / duration`, on each of its working days (Q17: the total
 *   equals the estimate, so half-day rounding never inflates it). A week holds the task's working
 *   days in that week on the project's calendar, times the share. O(weeks spanned) per task.
 * - **Capacity.** `capacityDaysPerWeek × the person's working days in the week / the workspace's
 *   working weekdays`: closures and time off lower it. Null when the capacity is unknown (Q3: no
 *   over/under verdict).
 * - **Not on the calendar.** Open owned tasks without dates: no estimate, waiting on an unknown
 *   task, or in a project with no start at all (FORM-v1 §7.4: "without an estimate or without
 *   dates"). They are listed per person ("Not on the calendar: 2 tasks").
 * - **Projects counted:** status planning or active, and neither archived nor deleted in the
 *   index (FORM-v1 §7.4).
 *
 * Figures are rounded to a millionth of a day (`roundLoad`), so summing shares such as 2.5 / 3
 * never leaves a 4e-16 "overload". Iteration is in project id order, then workflow order, so the
 * report never depends on record key order. O(Σ V + Σ weeks spanned + P·W).
 */

/* ------------------------------------------------------------------
   Types
   ------------------------------------------------------------------ */

/** One ISO week of one task */
export interface TaskWeek {
  readonly week: IsoWeekKey;
  readonly monday: IsoDate;
  /** The task's working days in the week, on the project's calendar */
  readonly days: number;
  /** Its load in the week: estimate × days / duration */
  readonly load: number;
}

/** An open task of a plan, as load sees it */
export interface TaskLoad {
  readonly projectId: ProjectId;
  readonly task: Task;
  /** Who carries it: the override, else the owner, when that resolves to an active person; else null (unassigned) */
  readonly personId: PersonId | null;
  /** Its weeks; null when it is not on the calendar. A milestone has dates and no weeks. */
  readonly weeks: readonly TaskWeek[] | null;
}

/** One person's week */
export interface WeekCell {
  readonly week: IsoWeekKey;
  readonly monday: IsoDate;
  /** Null when the person's capacity is unknown (Q3) */
  readonly capacity: number | null;
  /** Days of work across every counted project */
  readonly load: number;
  /** The same days by project */
  readonly byProject: ReadonlyMap<ProjectId, number>;
}

export interface LoadReport {
  /** Active people with work on the calendar: their weeks, in week order */
  readonly people: ReadonlyMap<PersonId, ReadonlyMap<IsoWeekKey, WeekCell>>;
  /** Active people's open tasks without dates, by project id then workflow order */
  readonly notOnCalendar: ReadonlyMap<PersonId, readonly { readonly projectId: ProjectId; readonly taskId: TaskId }[]>;
  /** The owner overrides the report was computed with (a reassign preview), so lanes read the same owners */
  readonly overrides: ReadonlyMap<TaskId, PersonId | null> | null;
}

/** What load reads of a plan: a `ProjectPlan` fits */
export interface LoadPlan {
  readonly project: ProjectDoc;
  readonly calendar: WorkCalendar;
  readonly schedule: Schedule;
}

/** What load reads of the workspace: a `WorkspaceDoc` fits */
export type LoadWorkspace = Pick<WorkspaceDoc, "people" | "projects" | "workingDays" | "closures">;

/* ------------------------------------------------------------------
   Helpers
   ------------------------------------------------------------------ */

/** Rounds a figure of days to a millionth, so float noise never reads as load */
export function roundLoad(days: number): number {
  return Math.round(days * 1_000_000) / 1_000_000;
}

/** Whether a project's work counts toward people's load: planning or active, not archived or deleted */
export function countsForLoad(ws: Pick<WorkspaceDoc, "projects">, project: Pick<ProjectDoc, "id" | "status">): boolean {
  if (project.status !== "planning" && project.status !== "active") return false;
  // A project the index doesn't list yet (a test document, a spawn in flight) counts
  const entry = Object.hasOwn(ws.projects, project.id) ? ws.projects[project.id] : null;
  return entry === null || (entry.archivedAt === null && entry.deletedAt === null);
}

/** The workspace's distinct working weekdays: the "standard" week capacity is measured against */
function standardWeek(ws: Pick<WorkspaceDoc, "workingDays">): number {
  const days = new Set<number>();
  for (const d of ws.workingDays) if (Number.isInteger(d) && d >= 1 && d <= 7) days.add(d);
  return Math.max(1, days.size);
}

/**
 * A person's capacity in the ISO week of `monday` (any day of the week works): their weekly
 * capacity × their working days that week (the workspace calendar minus closures and their time
 * off) / the workspace's working weekdays. Null when the capacity is unknown (Q3).
 */
export function capacityInWeek(ws: Pick<WorkspaceDoc, "workingDays" | "closures">, person: Person, monday: IsoDate): number | null {
  if (person.capacityDaysPerWeek === null) return null;
  const week = isoWeek(monday);
  const days = personCalendar(ws, person).workingDaysBetween(week.monday, week.sunday);
  return roundLoad((person.capacityDaysPerWeek * days) / standardWeek(ws));
}

/** ISO weeks by their Monday's day number: computed once, they are asked for over and over */
const weeksByMonday = new Map<number, { readonly key: IsoWeekKey; readonly monday: IsoDate }>();
const WEEK_CACHE_LIMIT = 8_192;

function weekOf(mondayDay: number): { readonly key: IsoWeekKey; readonly monday: IsoDate } {
  let week = weeksByMonday.get(mondayDay);
  if (week === undefined) {
    const monday = fromDayNum(mondayDay);
    week = Object.freeze({ key: isoWeek(monday).key, monday });
    if (weeksByMonday.size >= WEEK_CACHE_LIMIT) weeksByMonday.clear();
    weeksByMonday.set(mondayDay, week);
  }
  return week;
}

/**
 * The weeks of a scheduled task: its working days per ISO week and its load in each. Null in
 * relative mode (no dates); empty for a milestone or a zero estimate, which carry no load.
 * O(weeks spanned).
 */
export function taskWeeks(estimateDays: number, timing: ScheduledTiming, cal: WorkCalendar): TaskWeek[] | null {
  if (timing.start === null || timing.end === null) return null;
  if (timing.duration === 0 || estimateDays <= 0) return [];
  const startDay = toDayNum(timing.start);
  const endDay = toDayNum(timing.end);
  const weeks: TaskWeek[] = [];
  // The task holds the working ordinals [es, finish); each week takes those before the next Monday
  let ordinal = timing.es;
  for (let monday = startDay - isoWeekday(startDay) + 1; monday <= endDay; monday += 7) {
    const next = monday + 7;
    const until = next > DAY_NUM_MAX ? timing.finish : Math.min(timing.finish, cal.ordinal(fromDayNum(next)));
    const days = until - ordinal;
    if (days > 0) {
      const week = weekOf(monday);
      weeks.push({ week: week.key, monday: week.monday, days, load: (estimateDays * days) / timing.duration });
      ordinal = until;
    }
  }
  return weeks;
}

/** The person who carries a task: the override if there is one, else the owner, when active */
function carrier(task: Task, ws: Pick<WorkspaceDoc, "people">, overrides: ReadonlyMap<TaskId, PersonId | null> | null | undefined): PersonId | null {
  const ownerId = overrides?.has(task.id) ? (overrides.get(task.id) ?? null) : task.ownerId;
  const owner = resolveOwner(ownerId, ws);
  return owner === null || typeof owner === "string" ? null : owner.id;
}

/**
 * The open tasks of a plan with their carrier and weeks, in workflow order. Whether the project
 * counts is the caller's question (`countsForLoad`): lanes and balance read their own project
 * even when it is on hold.
 */
export function openTaskLoads(
  ws: Pick<WorkspaceDoc, "people">,
  plan: LoadPlan,
  overrides?: ReadonlyMap<TaskId, PersonId | null> | null,
): TaskLoad[] {
  const { project, schedule, calendar } = plan;
  const loads: TaskLoad[] = [];
  for (const task of sortedByOrder(project.tasks)) {
    if (task.status === "done") continue;
    const timing = schedule.timings.get(task.id);
    const weeks = timing === undefined || timing.kind !== "scheduled" ? null : taskWeeks(task.estimateDays ?? 0, timing, calendar);
    loads.push({ projectId: project.id, task, personId: carrier(task, ws, overrides), weeks });
  }
  return loads;
}

/* ------------------------------------------------------------------
   The report
   ------------------------------------------------------------------ */

interface MutableCell {
  week: IsoWeekKey;
  monday: IsoDate;
  load: number;
  byProject: Map<ProjectId, number>;
}

/**
 * Every active person's load per ISO week across the counted projects, and their open tasks
 * without dates. `overrides` replaces owners by task (a pending reassign proposal, previewed on
 * the Team view); null unassigns.
 */
export function weeklyLoad(
  ws: LoadWorkspace,
  plans: readonly LoadPlan[],
  overrides?: ReadonlyMap<TaskId, PersonId | null> | null,
): LoadReport {
  const cells = new Map<PersonId, Map<IsoWeekKey, MutableCell>>();
  const notOnCalendar = new Map<PersonId, { projectId: ProjectId; taskId: TaskId }[]>();

  const counted = plans.filter((p) => countsForLoad(ws, p.project)).sort((a, b) => compareKeys(a.project.id, b.project.id));
  for (const plan of counted) {
    for (const { projectId, task, personId, weeks } of openTaskLoads(ws, plan, overrides)) {
      if (personId === null) continue;
      if (weeks === null) {
        let list = notOnCalendar.get(personId);
        if (list === undefined) notOnCalendar.set(personId, (list = []));
        list.push({ projectId, taskId: task.id });
        continue;
      }
      let byWeek = cells.get(personId);
      for (const w of weeks) {
        if (byWeek === undefined) cells.set(personId, (byWeek = new Map()));
        let cell = byWeek.get(w.week);
        if (cell === undefined) byWeek.set(w.week, (cell = { week: w.week, monday: w.monday, load: 0, byProject: new Map() }));
        cell.load += w.load;
        cell.byProject.set(projectId, (cell.byProject.get(projectId) ?? 0) + w.load);
      }
    }
  }

  // Capacities, rounding and week order, person by person
  const people = new Map<PersonId, ReadonlyMap<IsoWeekKey, WeekCell>>();
  for (const id of [...cells.keys()].sort(compareKeys)) {
    const person = ws.people[id];
    const byWeek = cells.get(id)!;
    const out = new Map<IsoWeekKey, WeekCell>();
    for (const key of [...byWeek.keys()].sort(compareKeys)) {
      const cell = byWeek.get(key)!;
      const byProject = new Map<ProjectId, number>();
      for (const [projectId, days] of cell.byProject) byProject.set(projectId, roundLoad(days));
      out.set(
        key,
        Object.freeze({ week: cell.week, monday: cell.monday, capacity: capacityInWeek(ws, person, cell.monday), load: roundLoad(cell.load), byProject }),
      );
    }
    people.set(id, out);
  }
  const notOnCalendarSorted = new Map<PersonId, readonly { projectId: ProjectId; taskId: TaskId }[]>();
  for (const id of [...notOnCalendar.keys()].sort(compareKeys)) notOnCalendarSorted.set(id, Object.freeze(notOnCalendar.get(id)!));

  return Object.freeze({ people, notOnCalendar: notOnCalendarSorted, overrides: overrides ?? null });
}
