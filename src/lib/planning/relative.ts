import type { CalendarSpec } from "@/lib/planning/calendar";
import type { Schedule, TaskTiming } from "@/lib/planning/schedule";

/**
 * Relative labels (plan §6.4, FORM-v1 §7.2): positions counted in working days from the project's
 * anchor, for a start that isn't confirmed or doesn't exist. "D1" is the anchor's first working
 * day. Computed in Phase 1; first shown in Phase 4 (/demo keeps its sample dates, plan §1.3).
 */

/** "D{n}": the n-th working day of the project, for a working-day ordinal */
export function relativeDay(ordinal: number, sched: Schedule): string {
  return `D${ordinal - sched.anchor.ordinal + 1}`;
}

/**
 * "D{es − A + 1}–D{finish − A}" for a scheduled task: "D1–D3" is the project's first three
 * working days. A one-day task and a milestone read as a single day ("D4"). Null for a task
 * without dates.
 */
export function relativeRange(timing: TaskTiming, sched: Schedule): string | null {
  if (timing.kind !== "scheduled") return null;
  const first = timing.duration > 0 ? timing.es : timing.last;
  const from = relativeDay(first, sched);
  const to = relativeDay(timing.last, sched);
  return from === to ? from : `${from}–${to}`;
}

/** Distinct worked weekdays of a spec (at least 1) */
function perWeek(spec: Pick<CalendarSpec, "workingDays">): number {
  const days = new Set<number>();
  for (const d of spec.workingDays) if (Number.isInteger(d) && d >= 1 && d <= 7) days.add(d);
  return Math.max(1, days.size);
}

/**
 * "Week {⌊(ordinal − A) / |workingDays|⌋ + 1}": the project week a working day falls in, counted
 * in whole working weeks from the anchor. Takes the calendar spec (`effectiveSpec`), because the
 * number of worked weekdays isn't a property of a `WorkCalendar`.
 */
export function relativeWeek(ordinal: number, sched: Schedule, spec: Pick<CalendarSpec, "workingDays">): string {
  return `Week ${Math.floor((ordinal - sched.anchor.ordinal) / perWeek(spec)) + 1}`;
}
