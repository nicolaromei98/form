import { topoOrder } from "@/lib/domain/invariants/graph";
import { compareKeys } from "@/lib/domain/order";
import type { StepId, TaskId } from "@/lib/domain/schema/ids";
import type { IsoDate } from "@/lib/domain/schema/primitives";
import type { Step, Task } from "@/lib/domain/schema/project";
import type { WorkCalendar } from "@/lib/planning/calendar";

/**
 * The schedule (plan §6.3): a forward pass in topological order places every task on the
 * working-day calendar, a backward pass gives floats and the critical set, and steps get slots
 * inside their parent's window (Q1).
 *
 * Positions are working-day ordinals of the calendar (`WorkCalendar.ordinal`): a task occupies
 * the working days [es, finish), so its duration is `finish − es`. Dates are derived from the
 * ordinals only at the end, so every comparison is exact integer arithmetic.
 *
 * FORM never assumes a duration: a task without an estimate is unknown, and so is everything that
 * waits on it, each with the root cause ("Needs UI Design's estimate"). The function is total: a
 * loop in `dependsOn` (impossible in a valid document) makes its tasks unknown instead of
 * throwing, and so does a chain too long to date (see `PLAN_SPAN_MAX`). O(V + E + S) plus
 * O((V + S) log H) for the dates.
 */

/* ------------------------------------------------------------------
   Types
   ------------------------------------------------------------------ */

/** Why a task has no dates */
export type UnknownReason =
  /** A task (not a milestone) without an estimate. FORM never assumes a duration. */
  | "noEstimate"
  /** A predecessor is unknown; `cause` names the root task */
  | "waitsOn"
  /** The task is on, or behind, a dependency loop (impossible in a valid document) */
  | "cycle"
  /** The task would finish more than `PLAN_SPAN_MAX` working days after the anchor */
  | "horizon";

export interface ScheduledTiming {
  readonly kind: "scheduled";
  /** Earliest start: the ordinal of the first working day */
  readonly es: number;
  /** Exclusive: the ordinal after the last working day (`es + duration`) */
  readonly finish: number;
  /** Working days: ⌈estimate / allocation⌉, 0 for a milestone */
  readonly duration: number;
  /**
   * The ordinal of the end date. `finish − 1` for a task with a duration; for a milestone, the
   * day its predecessors end (or its own `es` when nothing before it ends there).
   */
  readonly last: number;
  /** Null in relative mode */
  readonly start: IsoDate | null;
  readonly end: IsoDate | null;
  /** The task has a pinned start */
  readonly pinned: boolean;
  readonly milestone: boolean;
  /** Working days the task can slip without moving the end (or past the deadline); null when it or anything after it is unknown */
  readonly float: number | null;
  /** float ≤ 0 */
  readonly critical: boolean;
}

export interface UnknownTiming {
  readonly kind: "unknown";
  readonly reason: UnknownReason;
  /** The root task: itself for noEstimate, cycle and horizon; the root's id for waitsOn */
  readonly cause: TaskId;
}

export type TaskTiming = ScheduledTiming | UnknownTiming;

/**
 * A step's slot inside its parent's window (Q1), as working days [es, finish). Steps with an
 * estimate run back to back from the parent's start; a slot that would run past the parent's
 * finish is cut there (a step that would start after it keeps the parent's last day) and flagged.
 */
export interface StepSlot {
  readonly es: number;
  readonly finish: number;
  readonly start: IsoDate | null;
  readonly end: IsoDate | null;
  /** The step doesn't fit in the parent's window, so its slot was cut */
  readonly overflows: boolean;
}

/**
 * - absolute: a confirmed start; real dates, and lateness counts.
 * - provisional: a start date that isn't confirmed (the /demo sample start); dates are shown as
 *   samples or relative labels, and nothing is ever late.
 * - relative: no date at all; positions only ("D1–D3", "Week 2"), dates null.
 */
export type AnchorMode = "absolute" | "provisional" | "relative";

export interface ScheduleAnchor {
  /** `startDate`, else the earliest pinned start; null in relative mode */
  readonly date: IsoDate | null;
  /** A: the ordinal of the first working day on or after the anchor date */
  readonly ordinal: number;
  readonly mode: AnchorMode;
}

export interface ScheduleEnd {
  /** The latest finish */
  readonly finish: number;
  /** The ordinal of the end date: the latest `last` */
  readonly last: number;
  /** Null in relative mode */
  readonly date: IsoDate | null;
  /** False when an open task is unknown: the end is then a lower bound */
  readonly complete: boolean;
}

export interface Schedule {
  readonly anchor: ScheduleAnchor;
  /** Every task, in `topo` order */
  readonly timings: ReadonlyMap<TaskId, TaskTiming>;
  /** Every step of every task: null when it has no estimate or its parent is unknown */
  readonly steps: ReadonlyMap<StepId, StepSlot | null>;
  /** Topological order, ties in workflow order; tasks on or behind a loop come last, in workflow order */
  readonly topo: readonly TaskId[];
  /** Null when no task is scheduled */
  readonly end: ScheduleEnd | null;
  /** Scheduled tasks with float ≤ 0, in workflow order */
  readonly critical: readonly TaskId[];
}

/** What the schedule reads of a task */
export type ScheduleTask = Pick<Task, "id" | "order" | "kind" | "status" | "estimateDays" | "allocation" | "pinnedStart" | "dependsOn"> & {
  readonly steps: readonly Pick<Step, "id" | "estimateDays">[];
};

/** What the schedule reads of a project: a `ProjectDoc` fits */
export interface ScheduleProject {
  readonly tasks: Readonly<Record<TaskId, ScheduleTask>>;
  readonly startDate: IsoDate | null;
  readonly startConfirmed: boolean;
  readonly deadline: IsoDate | null;
}

/* ------------------------------------------------------------------
   Constants
   ------------------------------------------------------------------ */

/**
 * The virtual start of a project with no date: a Monday, on the project's working days. Only
 * differences between ordinals are used in relative mode, so the year never shows.
 */
export const RELATIVE_ORIGIN = "2001-01-01" as IsoDate;

/**
 * The longest a plan may run, in working days after its anchor. A task that would finish later is
 * unknown with reason "horizon", and so is everything after it.
 *
 * The bound keeps `dateAt` total. Stored dates (starts, pins, closures, time off) end in 2199
 * (`DATE_MAX`), and every week has at least one working day, so the working days from 2200 to
 * the end of year 9999 number more than 406,000: any ordinal below A + 400,000 has a date. Only an
 * absurd plan reaches it (more than 400 tasks of 250 days at 25% in one chain, on a one-day week);
 * five working days a week would date it around year 3700.
 */
export const PLAN_SPAN_MAX = 400_000;

/* ------------------------------------------------------------------
   The schedule
   ------------------------------------------------------------------ */

/** ⌈estimate / allocation⌉ working days; an allocation outside (0, 1] counts as full time */
export function durationOf(estimateDays: number, allocation: number): number {
  const a = allocation > 0 && allocation <= 1 ? allocation : 1;
  return Math.ceil(estimateDays / a);
}

/** Working days up to and including `d`: the ordinal of the day after it, without leaving year 9999 */
export function ordinalAfter(cal: WorkCalendar, d: IsoDate): number {
  return cal.ordinal(d) + (cal.isWorkingDay(d) ? 1 : 0);
}

function earliestPin(tasks: readonly ScheduleTask[]): IsoDate | null {
  let earliest: IsoDate | null = null;
  for (const t of tasks) if (t.pinnedStart !== null && (earliest === null || t.pinnedStart < earliest)) earliest = t.pinnedStart;
  return earliest;
}

export function schedule(project: ScheduleProject, cal: WorkCalendar): Schedule {
  const tasks = project.tasks;
  const { order, cyclic } = topoOrder(project);
  const n = order.length;
  const list: ScheduleTask[] = order.map((id) => tasks[id]);
  const pos = new Map<TaskId, number>();
  for (let i = 0; i < n; i++) pos.set(order[i], i);

  // 1. Anchor
  const anchorDate = project.startDate ?? earliestPin(Object.values(tasks));
  const mode: AnchorMode = anchorDate === null ? "relative" : project.startConfirmed ? "absolute" : "provisional";
  const dated = mode !== "relative";
  // A non-working day has the ordinal of the next working day, so this is ordinal(nextWorkingDay(anchor))
  const A = cal.ordinal(anchorDate ?? RELATIVE_ORIGIN);

  // Tasks and their steps share most of their days, so each ordinal's date is looked up once
  const dates = new Map<number, IsoDate | null>();
  /** The date of an ordinal, or null when it falls outside the years an IsoDate can hold */
  const dateOf = (i: number): IsoDate | null => {
    let date = dates.get(i);
    if (date === undefined) {
      try {
        date = cal.dateAt(i);
      } catch (error) {
        // A calendar built from documents never gets here (PLAN_SPAN_MAX); one built by hand may
        if (!(error instanceof RangeError)) throw error;
        date = null;
      }
      dates.set(i, date);
    }
    return date;
  };

  // 2. Forward pass. Per topological position: known (1) or not, and the figures of known tasks.
  const known = new Uint8Array(n);
  const es = new Float64Array(n);
  const fin = new Float64Array(n);
  const dur = new Float64Array(n);
  const last = new Float64Array(n);
  const starts: (IsoDate | null)[] = new Array(n).fill(null);
  const ends: (IsoDate | null)[] = new Array(n).fill(null);
  const unknown: (UnknownTiming | null)[] = new Array(n).fill(null);
  const causeOf = (i: number): TaskId => unknown[i]?.cause ?? order[i];

  for (let i = 0; i < n; i++) {
    const t = list[i];
    const milestone = t.kind === "milestone";
    if (!milestone && t.estimateDays === null) {
      unknown[i] = { kind: "unknown", reason: "noEstimate", cause: t.id };
      continue;
    }
    // The first unknown predecessor in topological order, and the latest known finish
    let blocker = -1;
    let predMax = Number.NEGATIVE_INFINITY;
    let lastAtMax = Number.NEGATIVE_INFINITY;
    for (const p of t.dependsOn) {
      const j = pos.get(p);
      if (j === undefined) continue; // a missing id: the invariants report it
      if (!known[j]) {
        if (blocker < 0 || j < blocker) blocker = j;
      } else if (fin[j] > predMax) {
        predMax = fin[j];
        lastAtMax = last[j];
      } else if (fin[j] === predMax && last[j] > lastAtMax) {
        lastAtMax = last[j];
      }
    }
    // A pin never rescues a task whose predecessor is unknown
    if (blocker >= 0) {
      unknown[i] = { kind: "unknown", reason: "waitsOn", cause: causeOf(blocker) };
      continue;
    }
    const d = milestone ? 0 : durationOf(t.estimateDays ?? 0, t.allocation);
    const pin = t.pinnedStart === null ? A : cal.ordinal(t.pinnedStart);
    const start = Math.max(A, pin, predMax);
    const finish = start + d;
    // A zero-length task sits on the day its predecessors end, unless the anchor or its pin puts it later
    const end = d > 0 ? finish - 1 : start === predMax && !(t.pinnedStart !== null && pin === start) ? lastAtMax : start;
    if (finish - A > PLAN_SPAN_MAX) {
      unknown[i] = { kind: "unknown", reason: "horizon", cause: t.id };
      continue;
    }
    if (dated) {
      const startDate = dateOf(d > 0 ? start : end);
      const endDate = d > 0 ? dateOf(end) : startDate;
      if (startDate === null || endDate === null) {
        unknown[i] = { kind: "unknown", reason: "horizon", cause: t.id };
        continue;
      }
      starts[i] = startDate;
      ends[i] = endDate;
    }
    known[i] = 1;
    es[i] = start;
    fin[i] = finish;
    dur[i] = d;
    last[i] = end;
  }

  // 3. Backward pass. T is the deadline's finish (the working day after it), else the latest finish.
  let maxFinish = Number.NEGATIVE_INFINITY;
  let maxLast = Number.NEGATIVE_INFINITY;
  let endDate: IsoDate | null = null;
  for (let i = 0; i < n; i++) {
    if (!known[i]) continue;
    if (fin[i] > maxFinish) maxFinish = fin[i];
    if (last[i] > maxLast) {
      maxLast = last[i];
      endDate = ends[i];
    }
  }
  // Relative mode has no calendar dates, so a deadline can't be placed on it
  const T = dated && project.deadline !== null ? ordinalAfter(cal, project.deadline) : maxFinish;
  const lf = new Float64Array(n).fill(T);
  // 1 when an unknown task waits on this one, directly or not: its float is then unknowable
  const unknownAfter = new Uint8Array(n);
  for (const id of cyclic) {
    for (const p of tasks[id].dependsOn) {
      const j = pos.get(p);
      if (j !== undefined) unknownAfter[j] = 1;
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    const blocked = !known[i] || unknownAfter[i] === 1;
    const ls = lf[i] - dur[i];
    for (const p of list[i].dependsOn) {
      const j = pos.get(p);
      if (j === undefined) continue;
      if (blocked) unknownAfter[j] = 1;
      else if (ls < lf[j]) lf[j] = ls;
    }
  }

  // Timings, in topological order, then the tasks on or behind a loop
  const timings = new Map<TaskId, TaskTiming>();
  const critical: ScheduleTask[] = [];
  let openUnknown = false;
  for (let i = 0; i < n; i++) {
    const t = list[i];
    const u = unknown[i];
    if (u !== null) {
      timings.set(t.id, Object.freeze(u));
      if (t.status !== "done") openUnknown = true;
      continue;
    }
    const float = unknownAfter[i] ? null : lf[i] - dur[i] - es[i];
    const isCritical = float !== null && float <= 0;
    if (isCritical) critical.push(t);
    timings.set(
      t.id,
      Object.freeze({
        kind: "scheduled",
        es: es[i],
        finish: fin[i],
        duration: dur[i],
        last: last[i],
        start: starts[i],
        end: ends[i],
        pinned: t.pinnedStart !== null,
        milestone: t.kind === "milestone",
        float,
        critical: isCritical,
      } satisfies ScheduledTiming),
    );
  }
  for (const id of cyclic) {
    timings.set(id, Object.freeze({ kind: "unknown", reason: "cycle", cause: id } satisfies UnknownTiming));
    if (tasks[id].status !== "done") openUnknown = true;
  }

  // 4. Steps (Q1): back to back from the parent's start, each ⌈estimate / allocation⌉ long, cut at its finish
  const steps = new Map<StepId, StepSlot | null>();
  for (let i = 0; i < n; i++) {
    const t = list[i];
    if (t.steps.length === 0) continue;
    if (!known[i]) {
      for (const s of t.steps) steps.set(s.id, null);
      continue;
    }
    const lo = es[i];
    const hi = fin[i];
    let cursor = lo;
    for (const s of t.steps) {
      if (s.estimateDays === null) {
        steps.set(s.id, null);
        continue;
      }
      const length = durationOf(s.estimateDays, t.allocation);
      // Clamped into the parent's window: a step past its end keeps the parent's last day
      const sEs = hi > lo ? Math.min(cursor, hi - 1) : lo;
      const sFinish = hi > lo ? Math.max(sEs + 1, Math.min(cursor + length, hi)) : lo;
      const first = hi > lo ? sEs : last[i];
      const lastDay = hi > lo ? sFinish - 1 : last[i];
      steps.set(
        s.id,
        Object.freeze({
          es: sEs,
          finish: sFinish,
          start: dated ? dateOf(first) : null,
          end: dated ? dateOf(lastDay) : null,
          overflows: cursor + length > hi,
        }),
      );
      cursor += length;
    }
  }
  for (const id of cyclic) for (const s of tasks[id].steps) steps.set(s.id, null);

  // 5. End: the latest finish; a lower bound while an open task is unknown
  const end: ScheduleEnd | null =
    maxFinish === Number.NEGATIVE_INFINITY ? null : Object.freeze({ finish: maxFinish, last: maxLast, date: endDate, complete: !openUnknown });

  critical.sort((a, b) => compareKeys(a.order, b.order) || compareKeys(a.id, b.id));

  return Object.freeze({
    anchor: Object.freeze({ date: anchorDate, ordinal: A, mode }),
    timings,
    steps,
    topo: Object.freeze([...order, ...cyclic]),
    end,
    critical: Object.freeze(critical.map((t) => t.id)),
  });
}

/** A task's timing when it is scheduled, else null */
export function scheduledTiming(sched: Schedule, id: TaskId): ScheduledTiming | null {
  const t = sched.timings.get(id);
  return t !== undefined && t.kind === "scheduled" ? t : null;
}
