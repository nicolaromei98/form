import type { PersonId, TaskId } from "@/lib/domain/schema/ids";
import type { IsoDate } from "@/lib/domain/schema/primitives";
import type { ProjectDoc } from "@/lib/domain/schema/project";
import type { WorkspaceDoc } from "@/lib/domain/schema/workspace";
import { effectiveSpec, makeCalendar, type CalendarSpec, type WorkCalendar } from "@/lib/planning/calendar";
import { projectFocus, type FocusResult } from "@/lib/planning/focus";
import { weeklyLoad, type LoadReport } from "@/lib/planning/load";
import { metricsOf, risksOf, scheduleOf, workflowNumbers } from "@/lib/planning/memo";
import type { Metrics } from "@/lib/planning/metrics";
import type { Risks } from "@/lib/planning/risk";
import type { Schedule } from "@/lib/planning/schedule";

/**
 * The planning façade (plan §6.8). `planProject` gathers everything planning knows about one
 * project on one day. Parts are lazy getters backed by the stage memos (`memo.ts`, and
 * `projectFocus` for focus), so a reader pays only for what it asks, and an edit recomputes only
 * the stages it touches. `planWorkspace` adds the weekly load across projects (`load.ts`); Team
 * lanes, balance and leveling take a plan and that load (`lanes.ts`, `balance.ts`, `level.ts`).
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
  /** What to work on now, with the project's pin (`viewConfig.focusPin`) */
  readonly focus: FocusResult;
  /** The workflow number of a task: "01", "02" … ("00" for an id the project doesn't have, as in v0) */
  readonly number: (id: TaskId) => string;
}

class Plan implements ProjectPlan {
  private cachedSchedule: Schedule | null = null;
  private cachedRisks: Risks | null = null;
  private cachedMetrics: Metrics | null = null;
  private cachedFocus: FocusResult | null = null;

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

  get focus(): FocusResult {
    return (this.cachedFocus ??= projectFocus(this));
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

/* ------------------------------------------------------------------
   The workspace
   ------------------------------------------------------------------ */

export interface WorkspacePlan {
  /** One plan per project, in the order given */
  readonly plans: readonly ProjectPlan[];
  /** Weekly load across the projects that count (plan §6.5) */
  readonly load: LoadReport;
}

/** A load report with the inputs it was computed from, compared by identity */
interface LoadEntry {
  readonly refs: readonly unknown[];
  readonly report: LoadReport;
}
const loadReports: LoadEntry[] = [];
/** Reports kept: the live state, a reassign preview and the states undo is likely to revisit */
const LOAD_REPORTS_KEPT = 4;

/**
 * `weeklyLoad`, memoised on the shallow tuple of what it reads (plan §6.8): the project documents
 * and their calendars, the workspace's people, index and calendar, and the overrides. The same
 * inputs return the same report. Today is not an input: load is the same on any day.
 */
export function loadFor(ws: WorkspaceDoc, plans: readonly ProjectPlan[], overrides?: ReadonlyMap<TaskId, PersonId | null> | null): LoadReport {
  const refs: unknown[] = [ws.people, ws.projects, ws.workingDays, ws.closures, overrides ?? null];
  for (const plan of plans) refs.push(plan.project, plan.calendar.key);
  const hit = loadReports.find((e) => e.refs.length === refs.length && e.refs.every((r, i) => r === refs[i]));
  if (hit !== undefined) return hit.report;
  const report = weeklyLoad(ws, plans, overrides);
  if (loadReports.length >= LOAD_REPORTS_KEPT) loadReports.shift();
  loadReports.push({ refs, report });
  return report;
}

/** Every project's plan on one day, and the workspace's weekly load across them (plan §6.8) */
export function planWorkspace(ws: WorkspaceDoc, projects: readonly ProjectDoc[], today: IsoDate): WorkspacePlan {
  const plans = projects.map((p) => planProject(p, ws, today));
  return Object.freeze({ plans: Object.freeze(plans), load: loadFor(ws, plans) });
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
export {
  capacityInWeek,
  countsForLoad,
  openTaskLoads,
  roundLoad,
  taskWeeks,
  weeklyLoad,
  type LoadPlan,
  type LoadReport,
  type LoadWorkspace,
  type TaskLoad,
  type TaskWeek,
  type WeekCell,
} from "@/lib/planning/load";
export { laneLoads, type LaneLoad } from "@/lib/planning/lanes";
export { balance, type BalanceMove, type BalanceOptions, type BalanceResult } from "@/lib/planning/balance";
export { level, type LevelMove, type LevelPlan } from "@/lib/planning/level";
export {
  FOCUS_REASON_ORDER,
  focus,
  projectFocus,
  whyOf,
  type FocusCandidate,
  type FocusOptions,
  type FocusPlan,
  type FocusReason,
  type FocusReasonKey,
  type FocusResult,
} from "@/lib/planning/focus";
export { FOCUS_WEIGHTS, type FocusWeights } from "@/lib/planning/focus.weights";
