import { isoWeekday, toDayNum } from "@/lib/domain/dates";
import type { StepId, TaskId } from "@/lib/domain/schema/ids";
import type { IsoDate } from "@/lib/domain/schema/primitives";
import type { Task } from "@/lib/domain/schema/project";
import type { FocusCandidate } from "@/lib/planning/focus";
import type { AnchorMode, Schedule, ScheduleAnchor, UnknownTiming } from "@/lib/planning/schedule";

/**
 * Formatting for planning output (plan §2): dates as the v0 surfaces print them, the v0 day grid
 * of the timeline, and the labels of the date mode and of unknown tasks. Components may import
 * this module (plan §2), so it stays small and pure: no `Date`, no host locale. Every date is an
 * `IsoDate` read in the workspace time zone.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MONTHS_UPPER = MONTHS.map((m) => m.toUpperCase());
/** Index 0 = Monday (ISO) */
const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;

const monthIndex = (d: IsoDate) => (d.charCodeAt(5) - 48) * 10 + (d.charCodeAt(6) - 48) - 1;
/** Day of the month without padding ("1"), as a string */
const dayOf = (d: IsoDate) => (d[8] === "0" ? d.slice(9, 10) : d.slice(8, 10));

/* ------------------------------------------------------------------
   Dates (the v0 formats, on IsoDate)
   ------------------------------------------------------------------ */

/** "01 OCT": the timeline's week labels (v0 `fmtDay`) */
export function fmtDay(d: IsoDate): string {
  return `${d.slice(8, 10)} ${MONTHS_UPPER[monthIndex(d)]}`;
}

/** "01.10": the timeline's ranges and today tag (v0 `fmtShort`) */
export function fmtShort(d: IsoDate): string {
  return `${d.slice(8, 10)}.${d.slice(5, 7)}`;
}

/** "THU" (v0 `fmtWeekday`) */
export function fmtWeekday(d: IsoDate): string {
  return WEEKDAYS[isoWeekday(d) - 1];
}

/** "1 Oct": sentences in the brief, focus and risks ("Planned end 26 Oct …") */
export function fmtDate(d: IsoDate): string {
  return `${dayOf(d)} ${MONTHS[monthIndex(d)]}`;
}

/** "28 Sep 2026": the timeline's start control and other places that need the year */
export function fmtDateYear(d: IsoDate): string {
  return `${fmtDate(d)} ${d.slice(0, 4)}`;
}

/** "3d", "2.5d", or "—" for an unknown estimate (v0 `fmtDays`) */
export function fmtDays(n: number | null): string {
  if (n === null) return "—";
  return `${Number.isInteger(n) ? n : n.toFixed(1)}d`;
}

/** "1 working day", "8 working days" */
export function fmtWorkingDays(n: number): string {
  return `${n} working ${n === 1 ? "day" : "days"}`;
}

/* ------------------------------------------------------------------
   Date mode
   ------------------------------------------------------------------ */

/**
 * How a surface shows the schedule's dates:
 * - "absolute": real dates (a confirmed start);
 * - "sample": real dates labelled as a sample: /demo keeps absolute sample dates until Phase 4
 *   (plan §1.3);
 * - "relative": "D1–D3" and "Week 2" labels, no calendar date (FORM-v1 §7.2): a project with no
 *   date anywhere, and in /app an unconfirmed start.
 */
export type DateMode = "absolute" | "sample" | "relative";

/** Where the schedule is shown: /demo (Phase 1) or the signed-in app (Phase 3 on) */
export type DateSurface = "demo" | "app";

export function dateMode(anchor: ScheduleAnchor | AnchorMode, surface: DateSurface = "demo"): DateMode {
  const mode = typeof anchor === "string" ? anchor : anchor.mode;
  if (mode === "absolute") return "absolute";
  if (mode === "relative") return "relative";
  return surface === "demo" ? "sample" : "relative";
}

/** The timeline footer's first words (v0: "Sample schedule" until the start is confirmed) */
export function scheduleLabel(mode: DateMode): "Schedule" | "Sample schedule" {
  return mode === "sample" ? "Sample schedule" : "Schedule";
}

/* ------------------------------------------------------------------
   Unknown tasks
   ------------------------------------------------------------------ */

/**
 * The timeline's label for a task without dates (plan §8.2): "Needs a duration" for the task
 * that lacks the estimate, "Needs UI Design's estimate" for the tasks waiting on it.
 */
export function unknownLabel(timing: UnknownTiming, sched: Schedule, titleOf: (id: TaskId) => string): string {
  switch (timing.reason) {
    case "noEstimate":
      return "Needs a duration";
    case "cycle":
      return "In a dependency loop";
    case "horizon":
      return "Too far out to date";
    case "waitsOn": {
      const root = sched.timings.get(timing.cause);
      if (root?.kind === "unknown" && root.reason === "cycle") return "Waits on a dependency loop";
      if (root?.kind === "unknown" && root.reason === "horizon") return "Too far out to date";
      return `Needs ${titleOf(timing.cause)}'s estimate`;
    }
  }
}

/** "{Task} has no estimate, so its dates are unknown." (FORM-v1 §17) */
export function noEstimateSentence(title: string): string {
  return `${title} has no estimate, so its dates are unknown.`;
}

/* ------------------------------------------------------------------
   Focus
   ------------------------------------------------------------------ */

/**
 * The Focus sentence (v0 `summaryOf`): where the task stands ("In progress, 30% done."), then why
 * it matters now, the candidate's own `why` ("Urgent and on the critical path.").
 */
export function summaryOf(
  candidate: Pick<FocusCandidate, "why">,
  task: Pick<Task, "status" | "progress" | "estimateDays">,
): { lead: string; point: string } {
  const e = task.estimateDays;
  const days = e !== null ? `${Number.isInteger(e) ? e : e.toFixed(1)} ${e === 1 ? "day" : "days"} of work` : "no duration yet";
  const lead =
    task.status === "active"
      ? `In progress, ${task.progress}% done.`
      : task.status === "review"
        ? `In review, ${days}.`
        : task.status === "done"
          ? "Done."
          : `Not started, ${days}.`;
  return { lead, point: candidate.why };
}

/* ------------------------------------------------------------------
   The v0 day grid
   ------------------------------------------------------------------ */

/** A bar on the grid: `start` and `days` in the grid's unit, `days` ≥ 1 */
export interface GridBar {
  readonly start: number;
  readonly days: number;
}

export interface TimelineGrid {
  /**
   * "day": calendar days from `origin`, so a bar spans the weekends inside it (the v0 look);
   * "workingDay": working days from the anchor, in relative mode, where no calendar date exists.
   */
  readonly unit: "day" | "workingDay";
  /** Day 0 of the grid: the anchor date (`startDate`, else the earliest pin); null in relative mode */
  readonly origin: IsoDate | null;
  /** Scheduled tasks; a milestone takes the single cell of its date */
  readonly bars: ReadonlyMap<TaskId, GridBar & { readonly milestone: boolean }>;
  /** Steps with a slot */
  readonly steps: ReadonlyMap<StepId, GridBar>;
  /** Grid cells up to and including the planned end; 0 when nothing is scheduled */
  readonly totalDays: number;
  /** Tasks without dates, in topological order ("{n} without dates") */
  readonly unscheduled: readonly TaskId[];
}

/**
 * The schedule on the v0 calendar-day grid (plan §8.2): every bar runs from its working-day start
 * to its working-day end and spans the weekends and closures inside. O(V + S).
 */
export function calendarOffsets(sched: Schedule): TimelineGrid {
  const origin = sched.anchor.mode === "relative" ? null : sched.anchor.date;
  const A = sched.anchor.ordinal;
  const base = origin === null ? 0 : toDayNum(origin);
  /** Grid position of a date, or of a working-day ordinal in relative mode */
  const at = (date: IsoDate | null, ordinal: number) => (origin === null || date === null ? ordinal - A : toDayNum(date) - base);

  const bars = new Map<TaskId, GridBar & { readonly milestone: boolean }>();
  const unscheduled: TaskId[] = [];
  for (const id of sched.topo) {
    const t = sched.timings.get(id);
    if (t === undefined || t.kind === "unknown") {
      unscheduled.push(id);
      continue;
    }
    const first = t.duration > 0 ? at(t.start, t.es) : at(t.end, t.last);
    const lastCell = at(t.end, t.last);
    bars.set(id, { start: first, days: lastCell - first + 1, milestone: t.milestone });
  }
  const steps = new Map<StepId, GridBar>();
  for (const [id, slot] of sched.steps) {
    if (slot === null) continue;
    const first = at(slot.start, slot.es);
    const lastCell = at(slot.end, slot.finish - 1);
    steps.set(id, { start: first, days: Math.max(1, lastCell - first + 1) });
  }
  const end = sched.end;
  const totalDays = end === null ? 0 : at(end.date, end.last) + 1;
  return { unit: origin === null ? "workingDay" : "day", origin, bars, steps, totalDays, unscheduled };
}
