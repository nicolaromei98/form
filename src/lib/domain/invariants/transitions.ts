import { sortedByOrder } from "@/lib/domain/order";
import type { TaskId } from "@/lib/domain/schema/ids";
import type { ProjectStatus, Status, TaskKind, Timestamp } from "@/lib/domain/schema/primitives";
import type { Task } from "@/lib/domain/schema/project";

/**
 * Status and progress (plan §5.5, FORM-v1 §5.7). This table is the only implementation of the
 * rules: reducers call these functions, and `check.ts` asks `coherenceProblems` whether a task
 * obeys them. An op changes exactly one of status and progress; the other follows:
 *
 * | Change                                  | Result                                                        |
 * |-----------------------------------------|---------------------------------------------------------------|
 * | status → done                           | progress 100; completedAt = now (kept when already done)      |
 * | status → todo                           | progress 0; completedAt null                                   |
 * | status → active                         | progress 95 if it was 100; completedAt null                    |
 * | status → review                         | progress 95 if it was 100 and !requireReview; completedAt null |
 * | progress → 100                          | review if requireReview and not Done, else done (completedAt)  |
 * | progress < 100 on a Done task           | active; completedAt null                                       |
 * | progress > 0 on a To-do task            | active                                                         |
 * | progress changed on a task In review    | stays In review                                                |
 * | a task becomes active, project planning | project.status = "active"                                      |
 * | requireReview turned off                | every review@100 → done (completedAt = now)                    |
 * | milestone                               | status todo or done only; progress 0 or 100 (100 ⇔ done)       |
 *
 * The functions mutate a task in place (an Immer draft inside a reducer) and write a field only
 * when its value changes, so a same-value change produces no patch: a no-op stays a no-op.
 * Rejections are structurally the registry's `Rejection` (`ops/registry/_contract.ts`), which
 * `domain` can't import.
 */

/** Where a task lands when it leaves Done (or In review without the review step) from 100% */
export const LEFT_DONE_PROGRESS = 95;

export interface TransitionRejection {
  code: "invalid_state";
  /** English, caption-ready, at most 140 characters */
  message: string;
}

/** The project fields a transition reads or writes */
export interface TransitionProject {
  requireReview: boolean;
  status: ProjectStatus;
}

/** Long titles are cut so a message stays within a caption part (140 characters) */
const TITLE_IN_MESSAGE = 60;

export function titleInMessage(title: string): string {
  const chars = Array.from(title);
  return chars.length <= TITLE_IN_MESSAGE ? title : `${chars.slice(0, TITLE_IN_MESSAGE - 1).join("")}…`;
}

const reject = (message: string): TransitionRejection => ({ code: "invalid_state", message });

/** Assigns only when the value changes, so Immer emits no patch for a same-value write */
function set<K extends "status" | "progress" | "completedAt" | "kind" | "estimateDays" | "allocation">(
  task: Task,
  key: K,
  value: Task[K],
): void {
  if (task[key] !== value) task[key] = value;
}

/** A task started: a project still in planning becomes active */
function started(project: TransitionProject): void {
  if (project.status === "planning") project.status = "active";
}

function milestoneStates(task: Task): TransitionRejection {
  return reject(`${titleInMessage(task.title)} is a milestone: it's either to do or done.`);
}

/** Sets a task's status; its progress and `completedAt` follow the table. */
export function applyStatus(task: Task, status: Status, project: TransitionProject, now: Timestamp): TransitionRejection | void {
  if (task.kind === "milestone" && status !== "todo" && status !== "done") return milestoneStates(task);
  const was = task.status;
  switch (status) {
    case "done":
      // Re-marking a Done task keeps when it was completed (null for imported tasks: unknown)
      if (was !== "done") set(task, "completedAt", now);
      set(task, "status", "done");
      set(task, "progress", 100);
      return;
    case "todo":
      set(task, "status", "todo");
      set(task, "progress", 0);
      set(task, "completedAt", null);
      return;
    case "active":
      if (task.progress === 100) set(task, "progress", LEFT_DONE_PROGRESS);
      set(task, "status", "active");
      set(task, "completedAt", null);
      if (was !== "active") started(project);
      return;
    case "review":
      if (task.progress === 100 && !project.requireReview) set(task, "progress", LEFT_DONE_PROGRESS);
      set(task, "status", "review");
      set(task, "completedAt", null);
      return;
  }
}

/** Sets a task's progress (0–100); its status and `completedAt` follow the table. */
export function applyProgress(task: Task, progress: number, project: TransitionProject, now: Timestamp): TransitionRejection | void {
  if (task.kind === "milestone") {
    if (progress !== 0 && progress !== 100) return milestoneStates(task);
    return applyStatus(task, progress === 100 ? "done" : "todo", project, now);
  }
  const was = task.status;
  if (progress === 100) {
    if (project.requireReview && was !== "done") {
      set(task, "status", "review");
      set(task, "completedAt", null);
    } else {
      if (was !== "done") set(task, "completedAt", now);
      set(task, "status", "done");
    }
    set(task, "progress", 100);
    return;
  }
  set(task, "progress", progress);
  if (was === "done" || (was === "todo" && progress > 0)) {
    set(task, "status", "active");
    set(task, "completedAt", null);
    started(project);
  }
  // In progress and In review keep their status; To do at 0% stays To do
}

/**
 * Turns the review step on or off. Turning it off makes every task In review at 100% Done, with
 * `completedAt = now`; the ids come back in workflow order, for the caption ("Review step off ·
 * 2 tasks → Done"). Turning it on changes no task.
 */
export function applyRequireReview(
  project: { requireReview: boolean; tasks: Record<TaskId, Task> },
  requireReview: boolean,
  now: Timestamp,
): TaskId[] {
  if (project.requireReview === requireReview) return [];
  project.requireReview = requireReview;
  if (requireReview) return [];
  const completed: TaskId[] = [];
  for (const task of sortedByOrder(project.tasks)) {
    if (task.status === "review" && task.progress === 100) {
      task.status = "done";
      task.completedAt = now;
      completed.push(task.id);
    }
  }
  return completed;
}

/**
 * Turns a task into a milestone or back. A milestone takes no time: estimate 0, allocation 1, no
 * steps, and it is only to do or done, so a task with steps or with work under way is refused.
 * A milestone that becomes a task has an unknown estimate (null), never 0.
 */
export function applyKind(task: Task, kind: TaskKind): TransitionRejection | void {
  if (task.kind === kind) return;
  if (kind === "milestone") {
    if (task.steps.length > 0) return reject(`${titleInMessage(task.title)} has steps, and a milestone can't have any.`);
    if (task.status === "active" || task.status === "review") {
      return reject(`${titleInMessage(task.title)} has started: a milestone is only to do or done.`);
    }
    set(task, "kind", "milestone");
    set(task, "estimateDays", 0);
    set(task, "allocation", 1);
    return;
  }
  set(task, "kind", "task");
  if (task.estimateDays === 0) set(task, "estimateDays", null);
}

/**
 * Makes an imported task coherent, status first (Q2; the migration only): Done → 100%; To do with
 * progress → In progress (100% → 95%); In progress, or In review without the review step, at
 * 100% → 95%. A milestone is Done at 100% or To do at 0%. `completedAt` is null: when an imported
 * task was completed is unknown, never invented. Returns the same object when nothing changes.
 */
export function repairTask(task: Task, requireReview = false): Task {
  let { status, progress } = task;
  if (task.kind === "milestone") {
    if (status === "done") progress = 100;
    else {
      status = "todo";
      progress = 0;
    }
  } else if (status === "done") {
    progress = 100;
  } else if (status === "todo") {
    if (progress > 0) {
      status = "active";
      if (progress === 100) progress = LEFT_DONE_PROGRESS;
    }
  } else if (progress === 100 && (status === "active" || !requireReview)) {
    progress = LEFT_DONE_PROGRESS;
  }
  if (status === task.status && progress === task.progress && task.completedAt === null) return task;
  return { ...task, status, progress, completedAt: null };
}

/**
 * What makes a task's status and progress incoherent (plan §3.8 invariant 5): an empty list for a
 * coherent task.
 */
export function coherenceProblems(task: Pick<Task, "status" | "progress" | "completedAt">, requireReview: boolean): string[] {
  const problems: string[] = [];
  const { status, progress } = task;
  if (status === "done" && progress !== 100) problems.push(`Done at ${progress}%: Done means 100%.`);
  if (status === "todo" && progress !== 0) problems.push(`To do at ${progress}%: To do means 0%.`);
  if (progress === 100 && status !== "done" && !(status === "review" && requireReview)) {
    problems.push(
      status === "review"
        ? "In review at 100% without the review step: it is Done."
        : `${status === "todo" ? "To do" : "In progress"} at 100%: it is Done.`,
    );
  }
  if (task.completedAt !== null && status !== "done") problems.push("Completed, but not Done.");
  return problems;
}

/**
 * What breaks the shape of a milestone (plan §3.8 invariant 6): an estimate of 0, no steps,
 * allocation 1, and only To do or Done. Empty for a well-formed milestone and for any task.
 */
export function milestoneProblems(task: Pick<Task, "kind" | "status" | "estimateDays" | "steps" | "allocation">): string[] {
  if (task.kind !== "milestone") return [];
  const problems: string[] = [];
  if (task.estimateDays !== 0) problems.push("A milestone takes no time: its estimate is 0.");
  if (task.steps.length > 0) problems.push("A milestone has no steps.");
  if (task.allocation !== 1) problems.push("A milestone's allocation is 1.");
  if (task.status !== "todo" && task.status !== "done") problems.push("A milestone is only to do or done.");
  return problems;
}
