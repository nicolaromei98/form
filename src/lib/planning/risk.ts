import type { TaskId } from "@/lib/domain/schema/ids";
import type { IsoDate } from "@/lib/domain/schema/primitives";
import type { ProjectDoc, Task } from "@/lib/domain/schema/project";
import type { WorkCalendar } from "@/lib/planning/calendar";
import { fmtDate, fmtWorkingDays } from "@/lib/planning/format";
import { ordinalAfter, type Schedule } from "@/lib/planning/schedule";

/**
 * Lateness and risks (plan §6.4, FORM-v1 §7.3), O(V). Every count is in working days of the
 * project's calendar and is computed on ordinals, so it holds for any task the schedule placed.
 *
 * - **Late:** only with a confirmed start (absolute mode): a sample or unconfirmed schedule is
 *   never late (audit B.8). An open task whose end is before today, by
 *   `max(1, workingDaysBetween(end + 1, today))`.
 * - **Due risk:** an open task whose planned end runs past its due date, by
 *   `workingDaysBetween(dueDate + 1, end)`. Needs dates, so not in relative mode.
 * - **Due soon:** an open task due within `dueSoonDays` working days of today, or already past.
 * - **Deadline:** the planned end after the project deadline, by
 *   `workingDaysBetween(deadline + 1, end)`, with the FORM-v1 §17 sentence.
 */

/** Working days ahead that count as "due soon" (FOCUS_WEIGHTS.dueSoonDays, FORM-v1 §7.6) */
export const DUE_SOON_DAYS = 3;

export interface TaskRisk {
  /** Working days late, or null */
  readonly late: number | null;
  /** Working days the planned end runs past the due date, or null */
  readonly dueRisk: number | null;
  readonly dueSoon: boolean;
}

export interface DeadlineRisk {
  readonly deadline: IsoDate;
  readonly kind: "hard" | "soft";
  /** The planned end */
  readonly end: IsoDate;
  /** Working days after the deadline, at least 1 */
  readonly gap: number;
  /** The end is a lower bound (an open task is unknown): the gap is "at least" */
  readonly lowerBound: boolean;
  /** "Planned end 26 Oct is 8 working days after the deadline." */
  readonly sentence: string;
}

export interface Risks {
  /** Only the tasks with some risk, in topological order */
  readonly byTask: ReadonlyMap<TaskId, TaskRisk>;
  readonly deadline: DeadlineRisk | null;
}

/** What risks read of a project: a `ProjectDoc` fits */
export type RiskProject = Pick<ProjectDoc, "deadline" | "deadlineKind"> & {
  readonly tasks: Readonly<Record<TaskId, Pick<Task, "status" | "dueDate">>>;
};

export const NO_RISK: TaskRisk = Object.freeze({ late: null, dueRisk: null, dueSoon: false });

/** A task's risk, or NO_RISK */
export function taskRisk(risks: Risks, id: TaskId): TaskRisk {
  return risks.byTask.get(id) ?? NO_RISK;
}

/** "Planned end 26 Oct is 8 working days after the deadline.", with "at least" for a lower bound */
export function deadlineSentence(end: IsoDate, gap: number, lowerBound: boolean): string {
  return `Planned end ${fmtDate(end)} is ${lowerBound ? "at least " : ""}${fmtWorkingDays(gap)} after the deadline.`;
}

export function risks(
  project: RiskProject,
  sched: Schedule,
  cal: WorkCalendar,
  today: IsoDate,
  opts: { dueSoonDays?: number } = {},
): Risks {
  const dueSoonDays = opts.dueSoonDays ?? DUE_SOON_DAYS;
  const absolute = sched.anchor.mode === "absolute";
  const dated = sched.anchor.mode !== "relative";
  // Working days before today, and up to and including it
  const beforeToday = cal.ordinal(today);
  const throughToday = ordinalAfter(cal, today);

  const byTask = new Map<TaskId, TaskRisk>();
  for (const id of sched.topo) {
    const task = project.tasks[id];
    if (task === undefined || task.status === "done") continue;
    const timing = sched.timings.get(id);
    const placed = timing !== undefined && timing.kind === "scheduled" ? timing : null;

    // End before today: its last working day comes before today's
    const late = absolute && placed !== null && placed.last < beforeToday ? Math.max(1, throughToday - (placed.last + 1)) : null;

    let dueRisk: number | null = null;
    let dueSoon = false;
    if (task.dueDate !== null) {
      const throughDue = ordinalAfter(cal, task.dueDate);
      if (dated && placed !== null && placed.last + 1 > throughDue) dueRisk = placed.last + 1 - throughDue;
      // Working days after today up to the due date: none or negative when it's today or past
      dueSoon = throughDue - throughToday <= dueSoonDays;
    }

    if (late !== null || dueRisk !== null || dueSoon) byTask.set(id, Object.freeze({ late, dueRisk, dueSoon }));
  }

  let deadline: DeadlineRisk | null = null;
  const end = sched.end;
  if (dated && project.deadline !== null && end !== null && end.date !== null && end.date > project.deadline) {
    // At least 1: the end is a working day after the deadline
    const gap = end.last + 1 - ordinalAfter(cal, project.deadline);
    if (gap > 0) {
      const lowerBound = !end.complete;
      deadline = Object.freeze({
        deadline: project.deadline,
        kind: project.deadlineKind,
        end: end.date,
        gap,
        lowerBound,
        sentence: deadlineSentence(end.date, gap, lowerBound),
      });
    }
  }

  return Object.freeze({ byTask, deadline });
}
