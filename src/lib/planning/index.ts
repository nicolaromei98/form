import type { TaskId } from "@/lib/domain/schema/ids";
import type { IsoDate } from "@/lib/domain/schema/primitives";
import type { ProjectDoc } from "@/lib/domain/schema/project";
import type { WorkspaceDoc } from "@/lib/domain/schema/workspace";
import { effectiveSpec, makeCalendar, type CalendarSpec, type WorkCalendar } from "@/lib/planning/calendar";
import { metricsOf, risksOf, scheduleOf, workflowNumbers } from "@/lib/planning/memo";
import type { Metrics } from "@/lib/planning/metrics";
import type { Risks } from "@/lib/planning/risk";
import type { Schedule } from "@/lib/planning/schedule";

/**
 * The planning façade (plan §6.8). `planProject` gathers everything planning knows about one
 * project on one day. Parts are lazy getters backed by the stage memos (`memo.ts`), so a reader
 * pays only for what it asks, and an edit recomputes only the stages it touches.
 *
 * The engine is pure and isomorphic. The caller passes today as the workspace's civil date
 * (`todayIn(ws.timezone, Date.now())`).
 */

export interface ProjectPlan {
  readonly project: ProjectDoc;
  readonly workspace: WorkspaceDoc;
  readonly today: IsoDate;
  /** The project's effective calendar spec (workspace, with the project override) */
  readonly spec: CalendarSpec;
  readonly calendar: WorkCalendar;
  /** `schedule.topo` */
  readonly topo: readonly TaskId[];
  readonly schedule: Schedule;
  readonly risks: Risks;
  readonly metrics: Metrics;
  /** The workflow number of a task: "01", "02" … ("00" for an id the project doesn't have, as in v0) */
  readonly number: (id: TaskId) => string;
}

class Plan implements ProjectPlan {
  private cachedSchedule: Schedule | null = null;
  private cachedRisks: Risks | null = null;
  private cachedMetrics: Metrics | null = null;

  constructor(
    readonly project: ProjectDoc,
    readonly workspace: WorkspaceDoc,
    readonly today: IsoDate,
    readonly spec: CalendarSpec,
    readonly calendar: WorkCalendar,
  ) {}

  get schedule(): Schedule {
    return (this.cachedSchedule ??= scheduleOf(this.project, this.calendar));
  }

  get topo(): readonly TaskId[] {
    return this.schedule.topo;
  }

  get risks(): Risks {
    return (this.cachedRisks ??= risksOf(this.project, this.calendar, this.today));
  }

  get metrics(): Metrics {
    return (this.cachedMetrics ??= metricsOf(this.project, this.workspace, this.calendar));
  }

  readonly number = (id: TaskId): string => workflowNumbers(this.project.tasks).get(id) ?? "00";
}

/** Plans by project, then workspace, then `${calendarKey}|${today}` */
const plans = new WeakMap<ProjectDoc, WeakMap<WorkspaceDoc, Map<string, ProjectPlan>>>();
/** Entries kept per (project, workspace): the calendar or today rarely change more often */
const PLANS_PER_PAIR = 4;

/**
 * The plan of one project. Memoised by the identities of the project and the workspace, then by
 * the calendar key and today: the same documents on the same day return the same object. The
 * workspace is part of the key because metrics read its people (plan §6.8 keys on the project
 * alone; derived costs make that stale).
 */
export function planProject(project: ProjectDoc, ws: WorkspaceDoc, today: IsoDate): ProjectPlan {
  const spec = effectiveSpec(ws, project);
  const calendar = makeCalendar(spec);
  const key = `${calendar.key}|${today}`;

  let byWorkspace = plans.get(project);
  if (byWorkspace === undefined) {
    byWorkspace = new WeakMap();
    plans.set(project, byWorkspace);
  }
  let byKey = byWorkspace.get(ws);
  if (byKey === undefined) {
    byKey = new Map();
    byWorkspace.set(ws, byKey);
  }
  let plan = byKey.get(key);
  if (plan === undefined) {
    plan = new Plan(project, ws, today, spec, calendar);
    if (byKey.size >= PLANS_PER_PAIR) byKey.delete(byKey.keys().next().value as string);
    byKey.set(key, plan);
  }
  return plan;
}

export { calendarKey, effectiveSpec, makeCalendar, personCalendar, type CalendarSpec, type WorkCalendar } from "@/lib/planning/calendar";
export {
  PLAN_SPAN_MAX,
  RELATIVE_ORIGIN,
  schedule,
  scheduledTiming,
  type AnchorMode,
  type Schedule,
  type ScheduleAnchor,
  type ScheduleEnd,
  type ScheduledTiming,
  type StepSlot,
  type TaskTiming,
  type UnknownReason,
  type UnknownTiming,
} from "@/lib/planning/schedule";
export { relativeDay, relativeRange, relativeWeek } from "@/lib/planning/relative";
export { DUE_SOON_DAYS, NO_RISK, deadlineSentence, risks, taskRisk, type DeadlineRisk, type Risks, type TaskRisk } from "@/lib/planning/risk";
export { metrics, type Budget, type Metrics } from "@/lib/planning/metrics";
export { memoByRef, RefCache } from "@/lib/planning/memo";
