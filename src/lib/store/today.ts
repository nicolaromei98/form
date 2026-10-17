import { todayIn } from "@/lib/domain/dates";
import type { IsoDate } from "@/lib/domain/schema/primitives";

/**
 * Today in the workspace's time zone (plan §8.1): `todayIn(ws.timezone, Date.now())`, re-ticked at
 * local midnight. Planning takes today as a civil date, so this is the store's only clock read for
 * dates.
 */

/** The zone used when a stored one is unknown to this runtime's Intl */
export const FALLBACK_ZONE = "UTC";

/** Today in `timezone`; a zone this runtime doesn't know reads as UTC rather than throwing */
export function todayFor(timezone: string, nowMs: number): IsoDate {
  try {
    return todayIn(timezone, nowMs);
  } catch {
    return todayIn(FALLBACK_ZONE, nowMs);
  }
}

/** Far enough to cross the next midnight from any instant, in any zone and on any DST day (seconds) */
const SEARCH_SPAN_S = 26 * 3_600;

/**
 * Milliseconds until the civil date in `timezone` next changes. A binary search on `todayFor`
 * over whole seconds (every zone's offset is whole seconds, so midnight falls on one), so DST
 * days of 23 or 25 hours and offsets that aren't whole hours need no special case.
 */
export function msUntilNextDay(timezone: string, nowMs: number): number {
  const today = todayFor(timezone, nowMs);
  // Invariant: the date at second `lo` is still today, and at second `hi` it has changed
  let lo = Math.floor(nowMs / 1_000);
  let hi = lo + SEARCH_SPAN_S;
  if (todayFor(timezone, hi * 1_000) === today) return hi * 1_000 - nowMs;
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (todayFor(timezone, mid * 1_000) === today) lo = mid;
    else hi = mid;
  }
  return hi * 1_000 - nowMs;
}

export interface TickerOptions {
  /** The workspace's zone, read at every tick (it can change) */
  timezone: () => string;
  now: () => number;
  onTick: (today: IsoDate) => void;
}

/**
 * Calls `onTick` with the new date at every local midnight, until the returned function stops it.
 * A timer that fires early (or a clock that jumped) just re-arms; a late one (a sleeping laptop)
 * still ticks with the right date.
 */
export function startMidnightTicker({ timezone, now, onTick }: TickerOptions): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const arm = () => {
    if (stopped) return;
    // A small margin past midnight, so the new date is already readable when the timer fires
    timer = setTimeout(fire, msUntilNextDay(timezone(), now()) + 50);
  };
  const fire = () => {
    timer = null;
    onTick(todayFor(timezone(), now()));
    arm();
  };
  arm();
  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
  };
}
