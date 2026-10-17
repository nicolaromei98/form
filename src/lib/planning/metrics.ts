import { derivedCost } from "@/lib/domain/invariants/check";
import { sortedByOrder } from "@/lib/domain/order";
import type { TaskId } from "@/lib/domain/schema/ids";
import type { IsoDate, Status } from "@/lib/domain/schema/primitives";
import type { ProjectDoc, Task } from "@/lib/domain/schema/project";
import type { WorkspaceDoc } from "@/lib/domain/schema/workspace";
import type { WorkCalendar } from "@/lib/planning/calendar";
import { ordinalAfter, type Schedule } from "@/lib/planning/schedule";

/**
 * Project metrics (plan §6.4, FORM-v1 §7.7), O(V + S) plus the workflow sort. Every task is
 * top-level in v2 (steps live inside their task). Sums are exact: estimates are halves, progress
 * is an integer and money is integer cents, so iteration order can't change a figure.
 */

export interface Budget {
  readonly currency: string;
  readonly budgetCents: number | null;
  /** Σ manual costCents */
  readonly knownCents: number;
  /** Σ estimate × day rate, for tasks with no manual cost whose owner resolves and has a day rate ("Derived from day rates") */
  readonly derivedCents: number;
  /** The tasks behind `derivedCents`, in workflow order */
  readonly derived: readonly TaskId[];
  /** Tasks (not milestones) with neither a manual nor a derived cost, in workflow order ("{n} tasks have no cost yet") */
  readonly withoutCost: readonly TaskId[];
}

export interface Metrics {
  /** Every task, milestones included */
  readonly count: number;
  readonly done: number;
  readonly byStatus: Readonly<Record<Status, number>>;
  /** Σ known estimates, in working days at 100% */
  readonly totalEstimate: number;
  /** Tasks (not milestones) without an estimate */
  readonly missingEstimates: number;
  /** Urgent tasks not Done */
  readonly urgentOpen: number;
  /** Steps across all tasks, and how many are done */
  readonly steps: number;
  readonly stepsDone: number;
  /**
   * Estimate-weighted complete %, rounded: Σ(progress × estimate) / Σ estimate over the tasks with
   * an estimate, milestones excluded. With no estimate anywhere, the plain average of progress (v0).
   */
  readonly completePct: number;
  /** The tasks left out of `completePct` for lack of an estimate, in workflow order ("2 tasks not counted: no estimate") */
  readonly uncounted: readonly TaskId[];
  /** The schedule's end date; null in relative mode or with nothing scheduled */
  readonly plannedEnd: IsoDate | null;
  /** An open task is unknown, so the end is "at least" */
  readonly endIsLowerBound: boolean;
  /** Working days from the deadline to the planned end: positive after it, 0 on it, negative before it. Null without both. */
  readonly deadlineGap: number | null;
  readonly budget: Budget;
}

/** What metrics read of a project: a `ProjectDoc` fits */
export type MetricsProject = Pick<ProjectDoc, "deadline" | "currency" | "budgetCents"> & {
  readonly tasks: Readonly<
    Record<TaskId, Pick<Task, "id" | "order" | "kind" | "status" | "priority" | "progress" | "estimateDays" | "costCents" | "ownerId" | "steps">>
  >;
};

export function metrics(project: MetricsProject, sched: Schedule, ws: Pick<WorkspaceDoc, "people">, cal: WorkCalendar): Metrics {
  const byStatus: Record<Status, number> = { todo: 0, active: 0, review: 0, done: 0 };
  let count = 0;
  let totalEstimate = 0;
  let weighted = 0;
  let weight = 0;
  let progressSum = 0;
  let progressCount = 0;
  let urgentOpen = 0;
  let steps = 0;
  let stepsDone = 0;
  let knownCents = 0;
  let derivedCents = 0;
  const uncounted: TaskId[] = [];
  const derived: TaskId[] = [];
  const withoutCost: TaskId[] = [];

  for (const t of sortedByOrder(project.tasks)) {
    count++;
    byStatus[t.status]++;
    if (t.priority === "urgent" && t.status !== "done") urgentOpen++;
    steps += t.steps.length;
    for (const s of t.steps) if (s.done) stepsDone++;
    if (t.costCents !== null) knownCents += t.costCents;
    if (t.kind === "milestone") continue;

    progressSum += t.progress;
    progressCount++;
    if (t.estimateDays === null) uncounted.push(t.id);
    else {
      totalEstimate += t.estimateDays;
      weighted += t.progress * t.estimateDays;
      weight += t.estimateDays;
    }
    if (t.costCents === null) {
      const cost = derivedCost(t, ws);
      if (cost === null) withoutCost.push(t.id);
      else {
        derivedCents += cost;
        derived.push(t.id);
      }
    }
  }

  const completePct = Math.round(weight > 0 ? weighted / weight : progressCount > 0 ? progressSum / progressCount : 0);
  const end = sched.end;
  const plannedEnd = end?.date ?? null;
  const deadlineGap = plannedEnd !== null && end !== null && project.deadline !== null ? end.last + 1 - ordinalAfter(cal, project.deadline) : null;

  return Object.freeze({
    count,
    done: byStatus.done,
    byStatus: Object.freeze(byStatus),
    totalEstimate,
    missingEstimates: uncounted.length,
    urgentOpen,
    steps,
    stepsDone,
    completePct,
    uncounted: Object.freeze(uncounted),
    plannedEnd,
    endIsLowerBound: end !== null && !end.complete,
    deadlineGap,
    budget: Object.freeze({
      currency: project.currency,
      budgetCents: project.budgetCents,
      knownCents,
      derivedCents,
      derived: Object.freeze(derived),
      withoutCost: Object.freeze(withoutCost),
    }),
  });
}
