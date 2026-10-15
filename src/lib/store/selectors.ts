import { type Brief, composeBrief } from "@/lib/compose/brief";
import { compareDates, isoWeek } from "@/lib/domain/dates";
import { resolveOwner, resolvePerson } from "@/lib/domain/invariants/check";
import { PRIORITY_RANK, STATUS_ORDER } from "@/lib/domain/labels";
import { compareKeys, sortedByOrder, sortedByZ } from "@/lib/domain/order";
import type { PersonId, ProjectId, StepId, TaskId } from "@/lib/domain/schema/ids";
import type { LocalViewState } from "@/lib/domain/schema/local";
import type { IsoDate, Status } from "@/lib/domain/schema/primitives";
import type { MoodItem, ProjectDoc, Task } from "@/lib/domain/schema/project";
import type { SubtasksProposal } from "@/lib/domain/schema/proposal";
import type { Person, WorkspaceDoc } from "@/lib/domain/schema/workspace";
import { type FocusCandidate, type LaneLoad, laneLoads, loadFor, planProject, type ProjectPlan, schedule } from "@/lib/planning";
import { calendarOffsets, type GridBar, type TimelineGrid } from "@/lib/planning/format";
import { type DocsState, isLiveProject } from "@/lib/store/engine";

/**
 * Memoised selectors over the store (plan §8.1, §12.9): the derived data components read through
 * hooks. Each returns the same reference while its inputs are the same objects, so a component
 * re-renders only when what it shows changed. Documents are frozen and change by identity, so
 * identity is the version: planning memoises by document (planProject, the stage memos, loadFor),
 * and these memoise by the documents, the local state and today.
 *
 * Structural input, so this module never imports the store itself.
 */

export interface SelectState {
  readonly docs: DocsState;
  readonly activeProjectId: ProjectId | null;
  readonly local: LocalViewState;
  readonly today: IsoDate;
}

/**
 * The last result of `fn`, reused while every key is the same (by identity). One store holds one
 * state at a time, so the last inputs are the ones every component asks about.
 */
function memoLast<K extends readonly unknown[], V>(fn: (...keys: K) => V): (...keys: K) => V {
  let last: K | null = null;
  let value: V;
  return (...keys) => {
    if (last !== null && last.length === keys.length && last.every((k, i) => k === keys[i])) return value;
    value = fn(...keys);
    last = keys;
    return value;
  };
}

/** A value per object, built once (documents and their parts are frozen) */
function memoByRef<K extends object, V>(fn: (key: K) => V): (key: K) => V {
  const cache = new WeakMap<K, V>();
  return (key) => {
    if (cache.has(key)) return cache.get(key) as V;
    const value = fn(key);
    cache.set(key, value);
    return value;
  };
}

/* ------------------------------------------------------------------
   Documents
   ------------------------------------------------------------------ */

export const selectWorkspace = (s: SelectState): WorkspaceDoc => s.docs.workspace;

export function selectProject(s: SelectState): ProjectDoc | null {
  const id = s.activeProjectId;
  return id !== null && Object.hasOwn(s.docs.projects, id) ? s.docs.projects[id] : null;
}

/** The live projects by id (neither archived nor deleted) */
export const selectLiveProjects = (s: SelectState): readonly ProjectDoc[] => liveOf(s.docs.projects, s.docs.workspace.projects);

const liveOf = memoLast((projects: DocsState["projects"], index: WorkspaceDoc["projects"]): readonly ProjectDoc[] => {
  const ws = { projects: index } as WorkspaceDoc;
  return Object.freeze(
    (Object.keys(projects) as ProjectId[])
      .sort(compareKeys)
      .filter((id) => isLiveProject(ws, id))
      .map((id) => projects[id]),
  );
});

/** Task ids in workflow order */
export const taskIdsOf = memoByRef((tasks: ProjectDoc["tasks"]): readonly TaskId[] => Object.freeze(sortedByOrder(tasks).map((t) => t.id)));

export const selectTaskIds = (s: SelectState): readonly TaskId[] => {
  const p = selectProject(s);
  return p ? taskIdsOf(p.tasks) : NO_IDS;
};

const NO_IDS: readonly TaskId[] = Object.freeze([]);

/** The project's members who are in the team (Q7: archived or missing people aren't shown) */
export const selectMembers = (s: SelectState): readonly Person[] => {
  const p = selectProject(s);
  return p ? membersOf(p.memberIds, s.docs.workspace.people) : NO_PEOPLE;
};

const NO_PEOPLE: readonly Person[] = Object.freeze([]);

const membersOf = memoLast((memberIds: readonly PersonId[], people: WorkspaceDoc["people"]): readonly Person[] => {
  const out: Person[] = [];
  for (const id of memberIds) {
    const person = resolvePerson(id, { people });
    if (typeof person === "object") out.push(person);
  }
  return Object.freeze(out);
});

/** Mood items bottom to top (z order) */
export const moodItemsOf = memoByRef((items: ProjectDoc["moodboard"]["items"]): readonly MoodItem[] => Object.freeze(sortedByZ(items)));

export const selectMoodItems = (s: SelectState): readonly MoodItem[] => {
  const p = selectProject(s);
  return p ? moodItemsOf(p.moodboard.items) : NO_ITEMS;
};

const NO_ITEMS: readonly MoodItem[] = Object.freeze([]);

/** The pending subtasks proposal when it breaks this task down, else null */
export function selectSubtaskProposal(s: SelectState, taskId: TaskId): SubtasksProposal | null {
  const proposal = selectProject(s)?.proposal ?? null;
  return proposal?.kind === "subtasks" && proposal.taskId === taskId ? proposal : null;
}

/* ------------------------------------------------------------------
   The visible tasks (v0 visibleTasks, with the v2 filters)
   ------------------------------------------------------------------ */

const STATUS_RANK: Readonly<Record<Status, number>> = { active: 0, review: 1, todo: 2, done: 3 };
const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** Sorts by the view's key, ties in workflow order (order key, then id) */
function comparator(sort: ProjectDoc["viewConfig"]["sort"]): (a: Task, b: Task) => number {
  const byKey = (a: Task, b: Task): number => {
    switch (sort) {
      case "priority":
        return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      case "progress":
        return b.progress - a.progress;
      case "status":
        return STATUS_RANK[a.status] - STATUS_RANK[b.status];
      case "title":
        return collator.compare(a.title, b.title);
      case "estimate":
        return (b.estimateDays ?? -1) - (a.estimateDays ?? -1);
      case "due":
        // Dated first, earliest first
        if (a.dueDate === b.dueDate) return 0;
        if (a.dueDate === null) return 1;
        if (b.dueDate === null) return -1;
        return compareDates(a.dueDate, b.dueDate);
      case "manual":
        return 0;
    }
  };
  return (a, b) => byKey(a, b) || compareKeys(a.order, b.order) || compareKeys(a.id, b.id);
}

/** Whether a task passes the view's filters (hide done, status, priority, owner, tag, due) */
function passes(t: Task, view: ProjectDoc["viewConfig"], people: WorkspaceDoc["people"], today: IsoDate): boolean {
  const f = view.filters;
  if (view.hideDone && t.status === "done") return false;
  if (f.statuses.length > 0 && !f.statuses.includes(t.status)) return false;
  if (f.priorities.length > 0 && !f.priorities.includes(t.priority)) return false;
  if (f.ownerIds.length > 0) {
    // An archived or missing owner reads as unassigned (Q7)
    const owner = resolveOwner(t.ownerId, { people });
    const key = owner === null || typeof owner === "string" ? "none" : owner.id;
    if (!f.ownerIds.includes(key)) return false;
  }
  if (f.tags.length > 0 && !t.tags.some((tag) => f.tags.includes(tag))) return false;
  if (f.due === "late" && (t.dueDate === null || t.status === "done" || compareDates(t.dueDate, today) >= 0)) return false;
  if (f.due === "thisWeek") {
    const week = isoWeek(today);
    if (t.dueDate === null || compareDates(t.dueDate, week.monday) < 0 || compareDates(t.dueDate, week.sunday) > 0) return false;
  }
  return true;
}

const visibleOf = memoLast(
  (tasks: ProjectDoc["tasks"], view: ProjectDoc["viewConfig"], people: WorkspaceDoc["people"], today: IsoDate): readonly TaskId[] =>
    Object.freeze(
      Object.values(tasks)
        .filter((t) => passes(t, view, people, today))
        .sort(comparator(view.sort))
        .map((t) => t.id),
    ),
);

/** The tasks the view shows, filtered and sorted (v0 `visibleTasks`) */
export function selectVisibleTaskIds(s: SelectState): readonly TaskId[] {
  const p = selectProject(s);
  return p ? visibleOf(p.tasks, p.viewConfig, s.docs.workspace.people, s.today) : NO_IDS;
}

export type TasksByStatus = Readonly<Record<Status, readonly TaskId[]>>;

const byStatusOf = memoLast((ids: readonly TaskId[], tasks: ProjectDoc["tasks"]): TasksByStatus => {
  const out = Object.fromEntries(STATUS_ORDER.map((st) => [st, [] as TaskId[]])) as Record<Status, TaskId[]>;
  for (const id of ids) out[tasks[id].status].push(id);
  for (const st of STATUS_ORDER) Object.freeze(out[st]);
  return Object.freeze(out);
});

const NO_LANES: TasksByStatus = Object.freeze({ todo: NO_IDS, active: NO_IDS, review: NO_IDS, done: NO_IDS });

/** The visible tasks by status: the board's lanes (v0 `tasksByStatus`) */
export function selectTasksByStatus(s: SelectState): TasksByStatus {
  const p = selectProject(s);
  return p ? byStatusOf(selectVisibleTaskIds(s), p.tasks) : NO_LANES;
}

/* ------------------------------------------------------------------
   Planning
   ------------------------------------------------------------------ */

/** The open project's plan on today (memoised by planProject itself) */
export function selectPlan(s: SelectState): ProjectPlan | null {
  const p = selectProject(s);
  return p ? planProject(p, s.docs.workspace, s.today) : null;
}

/** The schedule on the v0 calendar-day grid */
export const timelineGridOf = memoByRef(calendarOffsets);

export function selectTimelineGrid(s: SelectState): TimelineGrid | null {
  const plan = selectPlan(s);
  return plan ? timelineGridOf(plan.schedule) : null;
}

const NO_CELLS: ReadonlyMap<StepId, GridBar> = new Map();

/**
 * Where the steps of a subtasks proposal would sit once accepted, as cells of the timeline grid:
 * the schedule run on the project with the proposed steps appended to their task, so the preview
 * follows the one step rule (Q1) and lands exactly where accepting puts the steps. A task's
 * dates never depend on its steps, so the grid's origin and the task's bar are the plan's own.
 */
const proposalCellsOf = memoLast((plan: ProjectPlan, proposal: SubtasksProposal): ReadonlyMap<StepId, GridBar> => {
  const tasks = plan.project.tasks;
  if (!Object.hasOwn(tasks, proposal.taskId)) return NO_CELLS;
  const task = tasks[proposal.taskId];
  const steps = [...task.steps, ...proposal.items.map((item) => ({ id: item.stepId, estimateDays: item.estimateDays }))];
  const preview = { ...plan.project, tasks: { ...tasks, [task.id]: { ...task, steps } } };
  const grid = calendarOffsets(schedule(preview, plan.calendar));
  const cells = new Map<StepId, GridBar>();
  for (const item of proposal.items) {
    const cell = grid.steps.get(item.stepId);
    if (cell !== undefined) cells.set(item.stepId, cell);
  }
  return cells;
});

/** The grid cells of the pending subtasks proposal's steps (empty without one) */
export function selectProposalCells(s: SelectState): ReadonlyMap<StepId, GridBar> {
  const plan = selectPlan(s);
  const proposal = plan?.project.proposal ?? null;
  return plan !== null && proposal?.kind === "subtasks" ? proposalCellsOf(plan, proposal) : NO_CELLS;
}

const candidatesOf = memoByRef((focus: ProjectPlan["focus"]): ReadonlyMap<TaskId, FocusCandidate> => {
  const map = new Map<TaskId, FocusCandidate>();
  for (const c of focus.ranked) map.set(c.taskId, c);
  if (focus.pick) map.set(focus.pick.taskId, focus.pick);
  return map;
});

/** One task's focus reasons and why, when it is a candidate (open and not blocked) */
export function selectFocusFor(s: SelectState, id: TaskId): FocusCandidate | null {
  const plan = selectPlan(s);
  return plan ? (candidatesOf(plan.focus).get(id) ?? null) : null;
}

/** The plans of the live projects, the open one included even when archived */
const plansOf = memoLast((live: readonly ProjectDoc[], open: ProjectDoc | null, ws: WorkspaceDoc, today: IsoDate): readonly ProjectPlan[] => {
  const plans = live.map((p) => planProject(p, ws, today));
  if (open !== null && !live.includes(open)) plans.push(planProject(open, ws, today));
  return Object.freeze(plans);
});

/** Owner changes a pending reassign proposal would make, for the Team preview */
const previewOf = memoByRef((project: ProjectDoc): ReadonlyMap<TaskId, PersonId | null> | null => {
  const p = project.proposal;
  if (p?.kind !== "reassign") return null;
  const moves = p.moves.filter((m) => m.type === "owner");
  return moves.length > 0 ? new Map(moves.map((m) => [m.taskId, m.to])) : null;
});

const lanesOf = memoLast(
  (plan: ProjectPlan, plans: readonly ProjectPlan[], ws: WorkspaceDoc, overrides: ReadonlyMap<TaskId, PersonId | null> | null): readonly LaneLoad[] =>
    Object.freeze(laneLoads(plan, loadFor(ws, plans, overrides), ws)),
);
const previewLanesOf = memoLast(
  (plan: ProjectPlan, plans: readonly ProjectPlan[], ws: WorkspaceDoc, overrides: ReadonlyMap<TaskId, PersonId | null> | null): readonly LaneLoad[] =>
    Object.freeze(laneLoads(plan, loadFor(ws, plans, overrides), ws)),
);

const NO_LANE_LOADS: readonly LaneLoad[] = Object.freeze([]);

/**
 * The Team lanes of the open project (plan §6.5): its members, then the unassigned row. With
 * `preview`, as they would be after the pending reassign proposal.
 */
export function selectLaneLoads(s: SelectState, preview = false): readonly LaneLoad[] {
  const project = selectProject(s);
  const plan = selectPlan(s);
  if (project === null || plan === null) return NO_LANE_LOADS;
  const plans = plansOf(selectLiveProjects(s), project, s.docs.workspace, s.today);
  const overrides = preview ? previewOf(project) : null;
  return preview && overrides !== null ? previewLanesOf(plan, plans, s.docs.workspace, overrides) : lanesOf(plan, plans, s.docs.workspace, null);
}

const briefOf = memoLast(
  (plan: ProjectPlan, people: WorkspaceDoc["people"], audience: "client" | "team", short: boolean, today: IsoDate, lanes: readonly LaneLoad[]): Brief | null =>
    composeBrief({ plan, ws: { people }, audience, short, today, lanes }),
);

/** The status brief for the view's audience and length (plan §6.9) */
export function selectBrief(s: SelectState): Brief | null {
  const plan = selectPlan(s);
  if (plan === null) return null;
  const { audience, short } = plan.project.viewConfig.brief;
  return briefOf(plan, s.docs.workspace.people, audience, short, s.today, selectLaneLoads(s));
}
