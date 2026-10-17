import type { Priority } from "@/lib/domain/schema/primitives";

/**
 * The Focus weights (plan §6.7, FORM-v1 §7.6): the single configuration file of the score. Every
 * point a task scores comes from one of these entries, and every entry has the sentence that
 * explains it (`focus.ts`). Changing a weight needs no other code change.
 *
 * - priority: points by priority (Urgent / High / Medium / Low);
 * - active, review: a task already In progress, or In review;
 * - late: a late task (confirmed start only), plus `latePerDay` per working day late, up to
 *   `lateMax` extra;
 * - dueSoon: due within `dueSoonDays` working days of today, or already past;
 * - critical: on the critical path;
 * - tightFloat: at most `tightFloatDays` working days of float (none, or negative, included);
 * - waitingEach: per open task that waits on it, directly or not, up to `waitingMax`.
 */
export interface FocusWeights {
  readonly priority: Readonly<Record<Priority, number>>;
  readonly active: number;
  readonly review: number;
  readonly late: number;
  readonly latePerDay: number;
  readonly lateMax: number;
  readonly dueSoon: number;
  readonly dueSoonDays: number;
  readonly critical: number;
  readonly tightFloat: number;
  readonly tightFloatDays: number;
  readonly waitingEach: number;
  readonly waitingMax: number;
}

export const FOCUS_WEIGHTS = {
  priority: { urgent: 40, high: 25, medium: 12, low: 4 },
  active: 15,
  review: 10,
  late: 35,
  latePerDay: 3,
  lateMax: 30,
  dueSoon: 20,
  dueSoonDays: 3,
  critical: 15,
  tightFloat: 8,
  tightFloatDays: 2,
  waitingEach: 5,
  waitingMax: 25,
} as const satisfies FocusWeights;
