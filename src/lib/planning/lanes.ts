import type { IsoWeekKey } from "@/lib/domain/dates";
import { resolvePerson } from "@/lib/domain/invariants/check";
import { compareKeys } from "@/lib/domain/order";
import type { PersonId, TaskId } from "@/lib/domain/schema/ids";
import type { IsoDate } from "@/lib/domain/schema/primitives";
import type { Person, WorkspaceDoc } from "@/lib/domain/schema/workspace";
import { capacityInWeek, openTaskLoads, roundLoad, type LoadPlan, type LoadReport, type TaskLoad } from "@/lib/planning/load";

/**
 * The Phase 1 Team lane (plan §6.5, DECISIONS §13 item 18): one bar per person, for one project.
 *
 * A person's lane covers their **work window**: the ISO weeks of their open, dated work in this
 * project. Over and free are summed week by week against everything they carry in those weeks,
 * this project and the others, so slack in one week never hides overload in another. With no
 * work here the lane shows one standard week (`capacityDaysPerWeek`).
 *
 * The figures:
 * - `capacity` = Σ capacity per week;
 * - `days` = this project's load in the window;
 * - `otherProjectsDays` = the other counted projects' load in the same weeks (a neutral segment in
 *   Phase 4);
 * - `over` = Σ max(0, load − capacity) and `free` = Σ max(0, capacity − load), per week;
 * - `unsized` = open tasks of theirs here that are not on the calendar.
 *
 * Rows are the project's members (in member order), then any active owner of open work here who
 * isn't a member (so no work disappears from the Team view), then the unassigned row. Archived
 * and missing people are not rows: their tasks are unassigned (Q7). The project's own load is read
 * from its plan, so a project on hold still shows its lanes; other projects come from the report.
 *
 * Phase 4 replaces the lane with the weekly grid (plan §12 item 3).
 */

export interface LaneLoad {
  /** Null for the unassigned row */
  readonly personId: PersonId | null;
  /** Their open tasks in this project, in workflow order */
  readonly taskIds: readonly TaskId[];
  /** This project's load in the window */
  readonly days: number;
  /** Open tasks of theirs here that are not on the calendar */
  readonly unsized: number;
  /** Null when the capacity is unknown (Q3), and on the unassigned row */
  readonly capacity: number | null;
  readonly over: number | null;
  readonly free: number | null;
  /** The other projects' load in the window's weeks */
  readonly otherProjectsDays: number;
  /** The window, in week order; empty for the standard week */
  readonly weeks: readonly IsoWeekKey[];
}

/** One week of a lane's window */
interface WindowWeek {
  monday: IsoDate;
  own: number;
}

function windowOf(tasks: readonly TaskLoad[]): Map<IsoWeekKey, WindowWeek> {
  const window = new Map<IsoWeekKey, WindowWeek>();
  for (const t of tasks) {
    for (const w of t.weeks ?? []) {
      const week = window.get(w.week);
      if (week === undefined) window.set(w.week, { monday: w.monday, own: w.load });
      else week.own += w.load;
    }
  }
  return window;
}

function lane(
  person: Person | null,
  tasks: readonly TaskLoad[],
  plan: LoadPlan,
  report: LoadReport,
  ws: Pick<WorkspaceDoc, "workingDays" | "closures">,
): LaneLoad {
  const window = windowOf(tasks);
  const weeks = [...window.keys()].sort(compareKeys);
  const taskIds = Object.freeze(tasks.map((t) => t.task.id));
  const unsized = tasks.filter((t) => t.weeks === null).length;
  let days = 0;
  for (const key of weeks) days += window.get(key)!.own;

  if (person === null) {
    return Object.freeze({ personId: null, taskIds, days: roundLoad(days), unsized, capacity: null, over: null, free: null, otherProjectsDays: 0, weeks });
  }
  if (weeks.length === 0) {
    const capacity = person.capacityDaysPerWeek;
    return Object.freeze({
      personId: person.id,
      taskIds,
      days: 0,
      unsized,
      capacity,
      over: capacity === null ? null : 0,
      free: capacity,
      otherProjectsDays: 0,
      weeks,
    });
  }

  const cells = report.people.get(person.id);
  const projectId = plan.project.id;
  let capacity: number | null = 0;
  let over = 0;
  let free = 0;
  let other = 0;
  for (const key of weeks) {
    const { monday, own } = window.get(key)!;
    const cell = cells?.get(key);
    // The report holds this project's load too when it counts; the plan's own figure replaces it
    const others = cell === undefined ? 0 : roundLoad(cell.load - (cell.byProject.get(projectId) ?? 0));
    other += others;
    const cap = capacityInWeek(ws, person, monday);
    if (cap === null || capacity === null) {
      capacity = null;
      continue;
    }
    const all = roundLoad(others + own);
    capacity += cap;
    over += Math.max(0, all - cap);
    free += Math.max(0, cap - all);
  }
  return Object.freeze({
    personId: person.id,
    taskIds,
    days: roundLoad(days),
    unsized,
    capacity: capacity === null ? null : roundLoad(capacity),
    over: capacity === null ? null : roundLoad(over),
    free: capacity === null ? null : roundLoad(free),
    otherProjectsDays: roundLoad(other),
    weeks,
  });
}

/**
 * The Team lanes of one project: its members, then active owners who aren't members, then the
 * unassigned row. `report` is `weeklyLoad` over the workspace's plans; its overrides (a reassign
 * preview) apply here too.
 */
export function laneLoads(plan: LoadPlan, report: LoadReport, ws: Pick<WorkspaceDoc, "people" | "workingDays" | "closures">): LaneLoad[] {
  const open = openTaskLoads(ws, plan, report.overrides);
  const byPerson = new Map<PersonId | null, TaskLoad[]>();
  for (const t of open) {
    let list = byPerson.get(t.personId);
    if (list === undefined) byPerson.set(t.personId, (list = []));
    list.push(t);
  }

  const rows: Person[] = [];
  const seen = new Set<PersonId>();
  for (const id of plan.project.memberIds) {
    const person = resolvePerson(id, ws);
    if (typeof person === "string" || seen.has(id)) continue;
    seen.add(id);
    rows.push(person);
  }
  const strays = [...byPerson.keys()]
    .filter((id): id is PersonId => id !== null && !seen.has(id))
    .map((id) => ws.people[id])
    .sort((a, b) => compareKeys(a.order, b.order) || compareKeys(a.id, b.id));
  rows.push(...strays);

  return [...rows.map((p) => lane(p, byPerson.get(p.id) ?? [], plan, report, ws)), lane(null, byPerson.get(null) ?? [], plan, report, ws)];
}
