import { DATE_MAX, DATE_MIN, TIMEZONE_LENGTH } from "@/lib/domain/limits";
import type { IsoDate } from "@/lib/domain/schema/primitives";

/**
 * Calendar dates without `Date` (plan §1.2, §6). A date is an `IsoDate` string ("YYYY-MM-DD"),
 * read in the workspace time zone; arithmetic runs on `DayNum`, the number of days since
 * 1970-01-01 in the proleptic Gregorian calendar. Day numbers are civil and time-zone free, so a
 * DST change can never add or lose a day. The conversions are Howard Hinnant's integer
 * `days_from_civil` and `civil_from_days` algorithms.
 *
 * Only `todayIn` touches a time zone: it turns an instant into the civil date in a named zone.
 */

/** Days since 1970-01-01 (civil, time-zone free) */
export type DayNum = number;

export interface CivilDate {
  readonly year: number;
  /** 1 = January */
  readonly month: number;
  readonly day: number;
}

/** "YYYY-Www": the ISO 8601 week, with the ISO week-numbering year */
export type IsoWeekKey = `${number}-W${string}`;

export interface IsoWeek {
  /** The ISO week-numbering year: the year of the week's Thursday */
  readonly year: number;
  /** 1 to 53 */
  readonly week: number;
  readonly key: IsoWeekKey;
  readonly monday: IsoDate;
  readonly sunday: IsoDate;
}

/** The first and last day numbers an `IsoDate` string can hold: 0000-01-01 and 9999-12-31 */
export const DAY_NUM_MIN: DayNum = -719528;
export const DAY_NUM_MAX: DayNum = 2932896;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function daysInMonth(year: number, month: number): number {
  return month === 2 && isLeapYear(year) ? 29 : MONTH_DAYS[month - 1];
}

/** Days since 1970-01-01 of a civil date. Expects a real date; see `isCivilDate`. */
export function dayNumFromCivil(year: number, month: number, day: number): DayNum {
  // Years start in March, so the leap day is the last day of the year
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400; // [0, 399]
  const monthFromMarch = (month + 9) % 12; // March = 0
  const dayOfYear = Math.floor((153 * monthFromMarch + 2) / 5) + day - 1; // [0, 365]
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** The civil date of a day number */
export function civilFromDayNum(n: DayNum): CivilDate {
  const z = n + 719468; // days since 0000-03-01
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097; // [0, 146096]
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365,
  ); // [0, 399]
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100)); // [0, 365]
  const monthFromMarch = Math.floor((5 * dayOfYear + 2) / 153); // [0, 11]
  const day = dayOfYear - Math.floor((153 * monthFromMarch + 2) / 5) + 1;
  const month = monthFromMarch < 10 ? monthFromMarch + 3 : monthFromMarch - 9;
  return { year: yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

const digit = (s: string, i: number) => s.charCodeAt(i) - 48;

/** Day number of an `IsoDate`. The string is trusted: the brand says it was validated. */
export function toDayNum(date: IsoDate): DayNum {
  const year = digit(date, 0) * 1000 + digit(date, 1) * 100 + digit(date, 2) * 10 + digit(date, 3);
  const month = digit(date, 5) * 10 + digit(date, 6);
  const day = digit(date, 8) * 10 + digit(date, 9);
  return dayNumFromCivil(year, month, day);
}

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

/** The civil date as "YYYY-MM-DD" (a real date in years 0–9999, unchecked) */
function format(year: number, month: number, day: number): IsoDate {
  return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}` as IsoDate;
}

/**
 * The `IsoDate` of a day number. Planning may compute dates past the stored window
 * (`DATE_MIN`–`DATE_MAX`), so this accepts any year an `IsoDate` string can hold, and throws a
 * RangeError outside 0000–9999 or for a fractional day: both are bugs in the caller.
 */
export function fromDayNum(n: DayNum): IsoDate {
  if (!Number.isInteger(n) || n < DAY_NUM_MIN || n > DAY_NUM_MAX) {
    throw new RangeError(`Day number ${n} is outside the years 0000–9999`);
  }
  const { year, month, day } = civilFromDayNum(n);
  return format(year, month, day);
}

const SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" naming a real day (leap years included), in any year 0000–9999 */
export function isCivilDate(s: string): boolean {
  if (!SHAPE.test(s)) return false;
  const year = digit(s, 0) * 1000 + digit(s, 1) * 100 + digit(s, 2) * 10 + digit(s, 3);
  const month = digit(s, 5) * 10 + digit(s, 6);
  const day = digit(s, 8) * 10 + digit(s, 9);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/** Inside the stored window, `DATE_MIN` to `DATE_MAX` (plain string order works for "YYYY-MM-DD") */
export function isStorableDate(s: string): boolean {
  return s >= DATE_MIN && s <= DATE_MAX;
}

/** A real, storable date, or null. The same rule as the `IsoDate` schema. */
export function parseIsoDate(s: string): IsoDate | null {
  return isCivilDate(s) && isStorableDate(s) ? (s as IsoDate) : null;
}

/** The `IsoDate` of a civil date; throws a RangeError when the date doesn't exist */
export function isoDate(year: number, month: number, day: number): IsoDate {
  if (!Number.isInteger(year) || year < 0 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`No such date: ${year}-${month}-${day}`);
  }
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`No such date: ${year}-${month}-${day}`);
  }
  return format(year, month, day);
}

/** The date `n` calendar days later (earlier when negative) */
export function addDays(date: IsoDate, n: number): IsoDate {
  return fromDayNum(toDayNum(date) + n);
}

/** Calendar days from `a` to `b`: positive when `b` is later */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return toDayNum(b) - toDayNum(a);
}

/** -1, 0 or 1; "YYYY-MM-DD" strings sort like their days */
export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 1 = Monday … 7 = Sunday (ISO 8601). 1970-01-01 was a Thursday. */
export function isoWeekday(date: IsoDate | DayNum): number {
  const n = typeof date === "number" ? date : toDayNum(date);
  return ((((n + 3) % 7) + 7) % 7) + 1;
}

/**
 * The ISO 8601 week of a date, O(1): the week belongs to the year of its Thursday, and week 1 is
 * the week holding that year's first Thursday. So 2026-12-31 and 2027-01-01 are 2026-W53,
 * 2027-01-04 is 2027-W01, and 2021-01-03 is 2020-W53.
 */
export function isoWeek(date: IsoDate): IsoWeek {
  const n = toDayNum(date);
  const monday = n - isoWeekday(n) + 1;
  const thursday = monday + 3;
  const { year } = civilFromDayNum(thursday);
  const week = Math.floor((thursday - dayNumFromCivil(year, 1, 1)) / 7) + 1;
  return { year, week, key: isoWeekKey(year, week), monday: fromDayNum(monday), sunday: fromDayNum(monday + 6) };
}

export function isoWeekKey(year: number, week: number): IsoWeekKey {
  return `${year}-W${pad2(week)}`;
}

/** 53 when the year starts on a Thursday, or is a leap year starting on a Wednesday; else 52 */
export function isoWeeksInYear(year: number): 52 | 53 {
  const jan1 = isoWeekday(dayNumFromCivil(year, 1, 1));
  return jan1 === 4 || (jan1 === 3 && isLeapYear(year)) ? 53 : 52;
}

/** The Monday of an ISO week; throws a RangeError for a week the year doesn't have */
export function isoWeekMonday(year: number, week: number): IsoDate {
  if (!Number.isInteger(week) || week < 1 || week > isoWeeksInYear(year)) {
    throw new RangeError(`${year} has no ISO week ${week}`);
  }
  // 4 January is always in week 1
  const jan4 = dayNumFromCivil(year, 1, 4);
  return fromDayNum(jan4 - isoWeekday(jan4) + 1 + (week - 1) * 7);
}

/* ------------------------------------------------------------------
   Time zones
   ------------------------------------------------------------------ */

// IANA names: segments that start with a capital letter ("Europe/Rome", "Etc/GMT+1", "UTC").
// This also refuses lowercase spellings and UTC offsets, which Intl accepts but IANA doesn't name.
const IANA_NAME = /^[A-Z][A-Za-z0-9_+-]*(?:\/[A-Z][A-Za-z0-9_+-]*)*$/;
const dayFormatters = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) {
    // A fixed locale and numeric parts: the output never depends on the host's locale
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" });
    dayFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** An IANA time zone name that this runtime's Intl knows ("Europe/Rome", "UTC", "America/New_York") */
export function isIanaZone(tz: string): boolean {
  if (tz.length === 0 || tz.length > TIMEZONE_LENGTH || !IANA_NAME.test(tz)) return false;
  if (dayFormatters.has(tz)) return true;
  try {
    dayFormatter(tz);
    return true;
  } catch {
    return false;
  }
}

/**
 * The civil date in time zone `tz` at the instant `nowMs` (milliseconds since the Unix epoch). The
 * caller passes the clock (`Date.now()` in the store), so this stays pure. Throws a RangeError for
 * a zone Intl doesn't know; workspace zones pass `isIanaZone` before they are stored.
 */
export function todayIn(tz: string, nowMs: number): IsoDate {
  let year = 0;
  let month = 0;
  let day = 0;
  for (const part of dayFormatter(tz).formatToParts(nowMs)) {
    if (part.type === "year") year = Number(part.value);
    else if (part.type === "month") month = Number(part.value);
    else if (part.type === "day") day = Number(part.value);
  }
  return isoDate(year, month, day);
}
