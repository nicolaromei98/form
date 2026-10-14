import { DAY_NUM_MAX, DAY_NUM_MIN, fromDayNum, toDayNum, type DayNum } from "@/lib/domain/dates";
import type { IsoDate } from "@/lib/domain/schema/primitives";

/**
 * The working-day calendar (plan §6.1). Planning counts working days, never calendar days: a
 * task of 3 days that starts on a Friday ends on the Tuesday. A calendar is the workspace's
 * working weekdays minus its closures (and, for a person, minus their time off).
 *
 * Every question is O(1) or O(log H) over two typed arrays that cover a horizon of days
 * [H0, H1):
 * - `mask[i]` is 1 when day H0 + i is a working day;
 * - `prefix[i]` is the running count of working days before day H0 + i.
 *
 * The horizon starts at 400 days before and 1,100 days after the first day asked about, and
 * doubles whenever a question falls outside it. The running count starts from a fixed origin
 * that doesn't depend on the horizon (see `workedBefore`), so an ordinal never changes when the
 * horizon grows, and every answer depends only on the calendar's spec, never on the order of
 * the questions asked before it.
 */

export { isoWeek, type IsoWeek, type IsoWeekKey } from "@/lib/domain/dates";

/* ------------------------------------------------------------------
   Types
   ------------------------------------------------------------------ */

/** Days off, from `from` to `to` inclusive: a closure or a person's time off */
export interface DateRange {
  readonly from: IsoDate;
  readonly to: IsoDate;
}

export interface CalendarSpec {
  /** ISO weekdays that are worked: 1 = Monday … 7 = Sunday */
  readonly workingDays: readonly number[];
  /** Days the studio is closed */
  readonly closures: readonly DateRange[];
}

export interface WorkCalendar {
  /** O(1) */
  isWorkingDay(d: IsoDate): boolean;
  /**
   * The number of working days before `d`, counted from a fixed origin of this calendar. Only
   * differences between ordinals mean something: `ordinal(b) − ordinal(a)` is the number of
   * working days in [a, b). A non-working `d` has the ordinal of the next working day. O(1).
   */
  ordinal(d: IsoDate): number;
  /** The working day whose ordinal is `i` (an integer); O(log H) */
  dateAt(i: number): IsoDate;
  /** The first working day on or after `d` (inclusive), or strictly after it */
  nextWorkingDay(d: IsoDate, inclusive: boolean): IsoDate;
  /**
   * `dateAt(ordinal(d) + n)`: `n` working days after `d` (before it when `n` is negative). A
   * non-working `d` counts from the next working day, so `addWorkingDays(saturday, 0)` is Monday.
   */
  addWorkingDays(d: IsoDate, n: number): IsoDate;
  /** Working days from `a` to `b`, both included; 0 when `b` is before `a`. O(1). */
  workingDaysBetween(a: IsoDate, b: IsoDate): number;
  /** `calendarKey`: equal keys mean equal calendars. The planning memos key on it. */
  readonly key: string;
}

/** Ranges keyed by id, as the documents store closures and time off */
export type DateRangeRecord = { readonly [id: string]: DateRange };

/**
 * What `effectiveSpec` and `personCalendar` read from the workspace. A `WorkspaceDoc` (plan §3.3)
 * has these fields; the calendar asks for no more, so it doesn't depend on the document schema.
 */
export interface CalendarWorkspace {
  readonly workingDays: readonly number[];
  readonly closures: DateRangeRecord;
}

/** What `effectiveSpec` reads from a project: its calendar override (plan §3.4) */
export interface CalendarProject {
  readonly calendarOverride: {
    readonly workingDays: readonly number[] | null;
    readonly closures: DateRangeRecord | null;
  } | null;
}

/** What `personCalendar` reads from a person: their time off (plan §3.3) */
export interface CalendarPerson {
  readonly timeOff: DateRangeRecord;
}

/* ------------------------------------------------------------------
   Specs
   ------------------------------------------------------------------ */

const rangeLists = new WeakMap<DateRangeRecord, readonly DateRange[]>();

/**
 * The ranges of a record as a list sorted by `from`, then `to`. Only the dates are kept, so the
 * list is the same whatever the record's key order (Postgres `jsonb` reorders keys). Memoised by
 * the record's identity: an unchanged record keeps its list.
 */
export function rangesOf(record: DateRangeRecord): readonly DateRange[] {
  let list = rangeLists.get(record);
  if (!list) {
    list = Object.freeze(
      Object.values(record)
        .map((r): DateRange => Object.freeze({ from: r.from, to: r.to }))
        .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0)),
    );
    rangeLists.set(record, list);
  }
  return list;
}

const specs = new WeakMap<readonly number[], WeakMap<DateRangeRecord, CalendarSpec>>();

/** One spec object per (working days, closures) pair of references, so the memos below hit */
function specOf(workingDays: readonly number[], closures: DateRangeRecord): CalendarSpec {
  let byClosures = specs.get(workingDays);
  if (!byClosures) {
    byClosures = new WeakMap();
    specs.set(workingDays, byClosures);
  }
  let spec = byClosures.get(closures);
  if (!spec) {
    spec = Object.freeze({ workingDays, closures: rangesOf(closures) });
    byClosures.set(closures, spec);
  }
  return spec;
}

/**
 * The calendar a project plans on: the workspace's, with the project's override replacing it
 * field by field (an override's `null` field keeps the workspace's). The same documents give the
 * same spec object.
 */
export function effectiveSpec(ws: CalendarWorkspace, p?: CalendarProject): CalendarSpec {
  const override = p?.calendarOverride ?? null;
  return specOf(override?.workingDays ?? ws.workingDays, override?.closures ?? ws.closures);
}

/**
 * A person's calendar: the workspace's working days and closures, minus their time off. Used for
 * capacity only (plan §6.5); tasks are scheduled on the project's calendar.
 */
export function personCalendar(ws: CalendarWorkspace, person: CalendarPerson): WorkCalendar {
  return makeCalendar(effectiveSpec(ws), rangesOf(person.timeOff));
}

/* ------------------------------------------------------------------
   Normalised specs and keys
   ------------------------------------------------------------------ */

const WEEK = 7;

interface Normalised {
  readonly key: string;
  /** Index 0 = Monday; 1 = worked */
  readonly week: Uint8Array;
  /** Days off as sorted, disjoint, non-touching [start, end) day-number pairs, flattened */
  readonly off: Int32Array;
}

/** Monday = 0 … Sunday = 6. Day 0, 1970-01-01, was a Thursday. */
const weekdayIndex = (n: DayNum) => (((n + 3) % WEEK) + WEEK) % WEEK;

/** The days off of every list, merged: overlapping and touching ranges become one */
function mergeRanges(lists: readonly (readonly DateRange[])[]): Int32Array {
  const pairs: [number, number][] = [];
  for (const list of lists) {
    for (const r of list) {
      const start = toDayNum(r.from);
      const end = toDayNum(r.to) + 1;
      // A range that ends before it starts holds no day (the invariants forbid it anyway)
      if (start < end) pairs.push([start, end]);
    }
  }
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: number[] = [];
  for (const [start, end] of pairs) {
    const last = merged.length - 1;
    if (last > 0 && start <= merged[last]) merged[last] = Math.max(merged[last], end);
    else merged.push(start, end);
  }
  return Int32Array.from(merged);
}

function normalise(spec: CalendarSpec, extraOff: readonly DateRange[] | undefined): Normalised {
  const week = new Uint8Array(WEEK);
  for (const d of spec.workingDays) if (Number.isInteger(d) && d >= 1 && d <= WEEK) week[d - 1] = 1;
  const off = mergeRanges(extraOff ? [spec.closures, extraOff] : [spec.closures]);
  let days = "";
  for (let i = 0; i < WEEK; i++) if (week[i]) days += i + 1;
  const ranges: string[] = [];
  for (let i = 0; i < off.length; i += 2) ranges.push(`${fromDayNum(off[i])}~${fromDayNum(off[i + 1] - 1)}`);
  return { key: `${days}|${ranges.join(",")}`, week, off };
}

const normalisedBySpec = new WeakMap<CalendarSpec, Normalised>();
const normalisedByExtra = new WeakMap<CalendarSpec, WeakMap<readonly DateRange[], Normalised>>();

/** Memoised by the spec's identity, and by the extra list's */
function normalised(spec: CalendarSpec, extraOff: readonly DateRange[] | undefined): Normalised {
  if (!extraOff) {
    let n = normalisedBySpec.get(spec);
    if (!n) {
      n = normalise(spec, undefined);
      normalisedBySpec.set(spec, n);
    }
    return n;
  }
  let byExtra = normalisedByExtra.get(spec);
  if (!byExtra) {
    byExtra = new WeakMap();
    normalisedByExtra.set(spec, byExtra);
  }
  let n = byExtra.get(extraOff);
  if (!n) {
    n = normalise(spec, extraOff);
    byExtra.set(extraOff, n);
  }
  return n;
}

/**
 * The calendar's identity as a string: the worked weekdays, then every day off (closures and
 * extra ranges together), merged and sorted. "12345|2026-12-24~2027-01-06" is Monday to Friday
 * with a closure over New Year. Equal keys mean equal calendars, whatever the record key order
 * or the way the days off were split into ranges.
 */
export function calendarKey(spec: CalendarSpec, extraOff?: readonly DateRange[]): string {
  return normalised(spec, extraOff).key;
}

/* ------------------------------------------------------------------
   Calendars
   ------------------------------------------------------------------ */

/** Days covered before and after the first day asked about */
const HORIZON_BEFORE = 400;
const HORIZON_AFTER = 1_100;
/** Calendars kept by key; the oldest goes first */
const CACHE_LIMIT = 256;

const calendars = new Map<string, WorkCalendar>();

/**
 * The working-day calendar of a spec, minus the `extraOff` ranges (a person's time off).
 * Memoised by `calendarKey`, so equal specs share one calendar. Throws a RangeError when no
 * weekday is worked: such a calendar has no working day to answer with (the schema requires one).
 */
export function makeCalendar(spec: CalendarSpec, extraOff?: readonly DateRange[]): WorkCalendar {
  const n = normalised(spec, extraOff);
  let calendar = calendars.get(n.key);
  if (!calendar) {
    calendar = buildCalendar(n);
    if (calendars.size >= CACHE_LIMIT) calendars.delete(calendars.keys().next().value as string);
    calendars.set(n.key, calendar);
  }
  return calendar;
}

function buildCalendar({ key, week, off }: Normalised): WorkCalendar {
  let perWeek = 0;
  for (let i = 0; i < WEEK; i++) perWeek += week[i];
  if (perWeek === 0) throw new RangeError("A calendar needs at least one working weekday");

  // weekPrefix[r] = worked weekdays among day numbers 0 … r − 1 (day 0 is a Thursday)
  const weekPrefix = new Int32Array(WEEK + 1);
  for (let r = 0; r < WEEK; r++) weekPrefix[r + 1] = weekPrefix[r] + week[weekdayIndex(r)];

  /** Worked weekdays before day n, counted from day 0 (negative before it), closures ignored */
  const patternBefore = (n: DayNum) => {
    const weeks = Math.floor(n / WEEK);
    return weeks * perWeek + weekPrefix[n - weeks * WEEK];
  };

  /**
   * Working days before day n, from the fixed origin: the weekly pattern minus the worked
   * weekdays that fall in days off before n. O(days-off ranges); used only to seed `prefix[0]`.
   */
  const workedBefore = (n: DayNum) => {
    let count = patternBefore(n);
    for (let i = 0; i < off.length && off[i] < n; i += 2) {
      count -= patternBefore(Math.min(n, off[i + 1])) - patternBefore(off[i]);
    }
    return count;
  };

  // The horizon [h0, h1); empty until the first question
  let h0 = 0;
  let h1 = 0;
  let mask = new Uint8Array(0);
  let prefix = new Int32Array(1);

  function build(from: DayNum, to: DayNum) {
    const length = to - from;
    const m = new Uint8Array(length);
    let wd = weekdayIndex(from);
    for (let i = 0; i < length; i++) {
      m[i] = week[wd];
      wd = wd === WEEK - 1 ? 0 : wd + 1;
    }
    for (let i = 0; i < off.length; i += 2) {
      const start = Math.max(off[i], from);
      const end = Math.min(off[i + 1], to);
      if (start < end) m.fill(0, start - from, end - from);
    }
    const p = new Int32Array(length + 1);
    p[0] = workedBefore(from);
    for (let i = 0; i < length; i++) p[i + 1] = p[i] + m[i];
    h0 = from;
    h1 = to;
    mask = m;
    prefix = p;
  }

  /** Grows the horizon until it holds the days [lo, hi), doubling on the side that falls short */
  function cover(lo: DayNum, hi: DayNum) {
    if (!(lo >= DAY_NUM_MIN && hi <= DAY_NUM_MAX + 1)) {
      throw new RangeError(`Day numbers ${lo}–${hi} are outside the years 0000–9999`);
    }
    if (h0 === h1) {
      build(Math.max(DAY_NUM_MIN, lo - HORIZON_BEFORE), Math.min(DAY_NUM_MAX + 1, Math.max(hi, lo + HORIZON_AFTER)));
      return;
    }
    let from = h0;
    let to = h1;
    while (lo < from) from = Math.max(DAY_NUM_MIN, from - (to - from));
    while (hi > to) to = Math.min(DAY_NUM_MAX + 1, to + (to - from));
    if (from !== h0 || to !== h1) build(from, to);
  }

  /**
   * The horizon index of a date, growing the horizon to hold it. Growing replaces `mask` and
   * `prefix`, so callers take the index first and read the arrays after: `mask[indexOf(d)]`
   * would read the array from before the growth.
   */
  function indexOf(d: IsoDate): number {
    const n = toDayNum(d);
    if (n < h0 || n >= h1) cover(n, n + 1);
    return n - h0;
  }

  function dateAt(i: number): IsoDate {
    if (!Number.isInteger(i)) throw new RangeError(`Working-day ordinal ${i} is not an integer`);
    // An empty horizon starts where the weekly pattern alone puts ordinal i
    if (h0 === h1) {
      const guess = Math.min(Math.max(Math.floor((i * WEEK) / perWeek), DAY_NUM_MIN), DAY_NUM_MAX);
      cover(guess, guess + 1);
    }
    while (i < prefix[0]) {
      if (h0 === DAY_NUM_MIN) throw new RangeError(`Working day ${i} falls before 0000-01-01`);
      cover(h0 - 1, h1);
    }
    while (i >= prefix[h1 - h0]) {
      if (h1 === DAY_NUM_MAX + 1) throw new RangeError(`Working day ${i} falls after 9999-12-31`);
      cover(h0, h1 + 1);
    }
    // prefix[lo] ≤ i < prefix[hi]; the counts grow by 0 or 1, so day h0 + lo is the working day i
    let lo = 0;
    let hi = h1 - h0;
    while (hi - lo > 1) {
      const mid = (lo + hi) >>> 1;
      if (prefix[mid] > i) hi = mid;
      else lo = mid;
    }
    return fromDayNum(h0 + lo);
  }

  function ordinal(d: IsoDate): number {
    const i = indexOf(d);
    return prefix[i];
  }

  return Object.freeze({
    key,
    isWorkingDay(d: IsoDate): boolean {
      const i = indexOf(d);
      return mask[i] === 1;
    },
    ordinal,
    dateAt,
    nextWorkingDay(d: IsoDate, inclusive: boolean): IsoDate {
      if (inclusive) {
        const i = indexOf(d);
        return mask[i] === 1 ? d : dateAt(prefix[i]);
      }
      // The first working day after d is the one whose ordinal is the count up to and including d
      const n = toDayNum(d);
      if (n < h0 || n >= h1) cover(n, n + 1);
      return dateAt(prefix[n + 1 - h0]);
    },
    addWorkingDays(d: IsoDate, n: number): IsoDate {
      if (!Number.isInteger(n)) throw new RangeError(`Working days must be a whole number, got ${n}`);
      return dateAt(ordinal(d) + n);
    },
    workingDaysBetween(a: IsoDate, b: IsoDate): number {
      const na = toDayNum(a);
      const nb = toDayNum(b);
      if (nb < na) return 0;
      if (na < h0 || nb >= h1) cover(na, nb + 1);
      return prefix[nb + 1 - h0] - prefix[na - h0];
    },
  });
}
