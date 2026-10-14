// Test helper (not a test file): a naive day-walk calendar, the reference the fast calendar must
// match, and fast-check arbitraries for random specs, days off and questions. The unit test and
// the property suite (test/property/calendar.property.test.ts) both use it.
import fc from "fast-check";
import { expect } from "vitest";
import { fromDayNum, isoWeekday, toDayNum } from "@/lib/domain/dates";
import { DATE_MAX, DATE_MIN } from "@/lib/domain/limits";
import type { IsoDate } from "@/lib/domain/schema/primitives";
import { makeCalendar, type CalendarSpec, type DateRange, type WorkCalendar } from "@/lib/planning/calendar";

/** A calendar that answers by walking one day at a time; obviously right, and slow */
export function dayWalk(spec: CalendarSpec, extraOff: readonly DateRange[] = []) {
  const off = new Set<number>();
  for (const r of [...spec.closures, ...extraOff]) {
    for (let n = toDayNum(r.from); n <= toDayNum(r.to); n++) off.add(n);
  }
  const works = (n: number) => spec.workingDays.includes(isoWeekday(n)) && !off.has(n);
  /** The first working day on or after n */
  const onOrAfter = (n: number) => {
    let m = n;
    while (!works(m)) m++;
    return m;
  };
  return {
    isWorkingDay: (d: IsoDate) => works(toDayNum(d)),
    nextWorkingDay: (d: IsoDate, inclusive: boolean) => fromDayNum(onOrAfter(toDayNum(d) + (inclusive ? 0 : 1))),
    addWorkingDays(d: IsoDate, n: number): IsoDate {
      let m = onOrAfter(toDayNum(d));
      for (let k = 0; k < n; k++) m = onOrAfter(m + 1);
      for (let k = 0; k > n; k--) {
        m--;
        while (!works(m)) m--;
      }
      return fromDayNum(m);
    },
    /** Working days from a to b, both included */
    workingDaysBetween(a: IsoDate, b: IsoDate): number {
      let count = 0;
      for (let n = toDayNum(a); n <= toDayNum(b); n++) if (works(n)) count++;
      return count;
    },
    /** Working days in [a, b), negated when b is before a: what ordinal(b) − ordinal(a) must be */
    workedFromTo(a: IsoDate, b: IsoDate): number {
      const [lo, hi, sign] = a <= b ? [toDayNum(a), toDayNum(b), 1] : [toDayNum(b), toDayNum(a), -1];
      let count = 0;
      for (let n = lo; n < hi; n++) if (works(n)) count++;
      return sign * count + 0; // never -0
    },
  };
}

/* ------------------------------------------------------------------
   Arbitraries
   ------------------------------------------------------------------ */

const DAY_FIRST = toDayNum(DATE_MIN as IsoDate);
const DAY_LAST = toDayNum(DATE_MAX as IsoDate);

/**
 * A random calendar around a random base day in the stored window: its worked weekdays (some
 * duplicated or unsorted, which the calendar must ignore), its closures and a person's time off.
 * Ranges overlap, touch, nest and sit on weekends; a few are long enough to hide whole weeks.
 */
export const calendarCase = fc
  .record({
    base: fc.integer({ min: DAY_FIRST + 2_000, max: DAY_LAST - 4_000 }),
    workingDays: fc.oneof(
      { weight: 3, arbitrary: fc.constant([1, 2, 3, 4, 5]) },
      { weight: 6, arbitrary: fc.uniqueArray(fc.integer({ min: 1, max: 7 }), { minLength: 1, maxLength: 7 }) },
      { weight: 1, arbitrary: fc.array(fc.integer({ min: 1, max: 7 }), { minLength: 1, maxLength: 9 }) },
    ),
    closures: fc.array(rangeAt(), { maxLength: 6 }),
    extraOff: fc.option(fc.array(rangeAt(), { maxLength: 4 }), { nil: undefined }),
  })
  .map(({ base, workingDays, closures, extraOff }) => {
    const toRanges = (list: readonly [number, number][]): DateRange[] =>
      list.map(([start, length]) => ({ from: fromDayNum(base + start), to: fromDayNum(base + start + length) }));
    const spec: CalendarSpec = { workingDays, closures: toRanges(closures) };
    return { base, spec, extraOff: extraOff && toRanges(extraOff) };
  });

/** [start offset from the base, length − 1] */
function rangeAt() {
  return fc.tuple(
    fc.integer({ min: -600, max: 1_800 }),
    fc.oneof({ weight: 4, arbitrary: fc.integer({ min: 0, max: 12 }) }, { weight: 1, arbitrary: fc.integer({ min: 13, max: 150 }) }),
  );
}

/**
 * Questions as offsets from the base and working-day counts. Days reach far on both sides, so
 * later questions grow the horizon that the first one set.
 */
export const questions = fc.array(
  fc.record({
    day: fc.oneof({ weight: 4, arbitrary: fc.integer({ min: -60, max: 400 }) }, { weight: 1, arbitrary: fc.integer({ min: -1_900, max: 3_800 }) }),
    other: fc.integer({ min: -400, max: 400 }),
    n: fc.oneof({ weight: 4, arbitrary: fc.integer({ min: -30, max: 60 }) }, { weight: 1, arbitrary: fc.integer({ min: -400, max: 400 }) }),
  }),
  { minLength: 1, maxLength: 6 },
);

/** Every method of the fast calendar agrees with the day walk, for each question in turn */
export function agreesWithDayWalk(
  { base, spec, extraOff }: { base: number; spec: CalendarSpec; extraOff: readonly DateRange[] | undefined },
  qs: readonly { day: number; other: number; n: number }[],
  calendar: WorkCalendar = makeCalendar(spec, extraOff),
): void {
  const oracle = dayWalk(spec, extraOff);
  for (const { day, other, n } of qs) {
    const d = fromDayNum(base + day);
    const e = fromDayNum(base + day + other);
    expect(calendar.isWorkingDay(d), `isWorkingDay(${d})`).toBe(oracle.isWorkingDay(d));
    expect(calendar.nextWorkingDay(d, true), `nextWorkingDay(${d}, true)`).toBe(oracle.nextWorkingDay(d, true));
    expect(calendar.nextWorkingDay(d, false), `nextWorkingDay(${d}, false)`).toBe(oracle.nextWorkingDay(d, false));
    expect(calendar.addWorkingDays(d, n), `addWorkingDays(${d}, ${n})`).toBe(oracle.addWorkingDays(d, n));
    expect(calendar.workingDaysBetween(d, e), `workingDaysBetween(${d}, ${e})`).toBe(oracle.workingDaysBetween(d, e));
    expect(calendar.ordinal(e) - calendar.ordinal(d), `ordinal(${e}) − ordinal(${d})`).toBe(oracle.workedFromTo(d, e));
    expect(calendar.dateAt(calendar.ordinal(d)), `dateAt(ordinal(${d}))`).toBe(oracle.nextWorkingDay(d, true));
  }
}
