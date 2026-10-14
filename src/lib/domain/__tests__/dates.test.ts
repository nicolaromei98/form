import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  addDays,
  civilFromDayNum,
  compareDates,
  DAY_NUM_MAX,
  DAY_NUM_MIN,
  dayNumFromCivil,
  daysBetween,
  daysInMonth,
  fromDayNum,
  isCivilDate,
  isIanaZone,
  isLeapYear,
  isoDate,
  isoWeek,
  isoWeekday,
  isoWeekMonday,
  isoWeeksInYear,
  isStorableDate,
  parseIsoDate,
  todayIn,
  toDayNum,
} from "@/lib/domain/dates";
import { DATE_MAX, DATE_MIN } from "@/lib/domain/limits";
import { IsoDate } from "@/lib/domain/schema/primitives";

// Oracles built on Date (tests only: the module itself never touches Date)
const DAY_MS = 86_400_000;
const oracleIso = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
function oracleDayNum(year: number, month: number, day: number): number {
  const t = new Date(0);
  t.setUTCFullYear(year, month - 1, day); // setUTCFullYear keeps years 0–99 literal
  return t.getTime() / DAY_MS;
}
function oracleIsoWeek(iso: string): { year: number; week: number } {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  return { year, week: Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / DAY_MS + 1) / 7) };
}

const d = (s: string) => IsoDate.parse(s);
const dayNum = fc.integer({ min: DAY_NUM_MIN, max: DAY_NUM_MAX });
const utc = (iso: string) => Date.parse(iso);

describe("day numbers", () => {
  it("count days since 1970-01-01", () => {
    expect(toDayNum(d("1970-01-01"))).toBe(0);
    expect(toDayNum(d("1970-01-02"))).toBe(1);
    expect(fromDayNum(-1)).toBe("1969-12-31");
    expect(toDayNum(d("2000-03-01"))).toBe(11017);
    expect(toDayNum(d("2026-10-14"))).toBe(20740);
  });

  it("span the years an IsoDate string can hold", () => {
    expect(fromDayNum(DAY_NUM_MIN)).toBe("0000-01-01");
    expect(fromDayNum(DAY_NUM_MAX)).toBe("9999-12-31");
    expect(dayNumFromCivil(0, 1, 1)).toBe(DAY_NUM_MIN);
    expect(dayNumFromCivil(9999, 12, 31)).toBe(DAY_NUM_MAX);
  });

  it("throw outside 0000–9999 and for fractional days", () => {
    expect(() => fromDayNum(DAY_NUM_MIN - 1)).toThrow(RangeError);
    expect(() => fromDayNum(DAY_NUM_MAX + 1)).toThrow(RangeError);
    expect(() => fromDayNum(0.5)).toThrow(RangeError);
    expect(() => fromDayNum(Number.NaN)).toThrow(RangeError);
  });

  it("match the Date oracle on every year 0000–9999", () => {
    fc.assert(
      fc.property(dayNum, (n) => {
        const iso = fromDayNum(n);
        expect(iso).toBe(oracleIso(n));
        expect(toDayNum(iso)).toBe(n);
        const { year, month, day } = civilFromDayNum(n);
        expect(dayNumFromCivil(year, month, day)).toBe(oracleDayNum(year, month, day));
      }),
      { numRuns: 5_000 },
    );
  });

  it("round-trip every day of four centuries", () => {
    const from = dayNumFromCivil(1900, 1, 1);
    const to = dayNumFromCivil(2300, 12, 31);
    let previous = fromDayNum(from - 1);
    for (let n = from; n <= to; n++) {
      const iso = fromDayNum(n);
      expect(iso > previous).toBe(true);
      if (toDayNum(iso) !== n) expect.fail(`${iso} round-trips to ${toDayNum(iso)}, not ${n}`);
      previous = iso;
    }
  });
});

describe("leap years", () => {
  it.each([
    [2024, true],
    [2025, false],
    [2000, true],
    [1900, false],
    [2100, false],
    [2400, true],
    [0, true],
  ])("%i is leap: %s", (year, leap) => {
    expect(isLeapYear(year)).toBe(leap);
    expect(daysInMonth(year, 2)).toBe(leap ? 29 : 28);
  });

  it("put 29 February only in leap years", () => {
    expect(addDays(d("2024-02-28"), 1)).toBe("2024-02-29");
    expect(addDays(d("2024-02-29"), 1)).toBe("2024-03-01");
    expect(addDays(d("2023-02-28"), 1)).toBe("2023-03-01");
    expect(addDays(d("2100-02-28"), 1)).toBe("2100-03-01");
    expect(addDays(d("2000-02-28"), 1)).toBe("2000-02-29");
    expect(daysBetween(d("2024-01-01"), d("2025-01-01"))).toBe(366);
    expect(daysBetween(d("2025-01-01"), d("2026-01-01"))).toBe(365);
    expect(isCivilDate("2024-02-29")).toBe(true);
    expect(isCivilDate("2025-02-29")).toBe(false);
    expect(isCivilDate("1900-02-29")).toBe(false);
    expect(isCivilDate("2000-02-29")).toBe(true);
  });
});

describe("DST borders", () => {
  // Europe/Rome: 29 Mar and 25 Oct 2026; US: 8 Mar and 1 Nov 2026; New Zealand: 5 Apr and 27 Sep 2026
  it.each([
    ["2026-03-28", "2026-03-29", "2026-03-30"],
    ["2026-10-24", "2026-10-25", "2026-10-26"],
    ["2026-03-07", "2026-03-08", "2026-03-09"],
    ["2026-10-31", "2026-11-01", "2026-11-02"],
    ["2026-04-04", "2026-04-05", "2026-04-06"],
    ["2026-09-26", "2026-09-27", "2026-09-28"],
  ])("step one civil day at a time across %s → %s → %s", (before, change, after) => {
    expect(addDays(d(before), 1)).toBe(change);
    expect(addDays(d(change), 1)).toBe(after);
    expect(addDays(d(after), -2)).toBe(before);
    expect(daysBetween(d(before), d(after))).toBe(2);
  });

  describe("whatever the host time zone", () => {
    const original = process.env.TZ;
    afterEach(() => {
      process.env.TZ = original;
    });

    it("gives the same answers", () => {
      const run = () => [
        addDays(d("2026-03-28"), 2),
        daysBetween(d("2026-10-24"), d("2026-10-26")),
        isoWeek(d("2026-10-25")).key,
        isoWeekday(d("2026-03-29")),
        todayIn("Europe/Rome", utc("2026-03-28T23:30:00Z")),
      ];
      const results = ["UTC", "Europe/Rome", "Pacific/Auckland", "America/Los_Angeles"].map((tz) => {
        process.env.TZ = tz;
        return run();
      });
      for (const r of results) expect(r).toEqual(results[0]);
    });
  });
});

describe("date strings", () => {
  it("agree with zod's z.iso.date() on what is a real date", () => {
    const zodDate = z.iso.date();
    const candidate = fc
      .tuple(fc.integer({ min: 0, max: 9999 }), fc.integer({ min: 0, max: 13 }), fc.integer({ min: 0, max: 32 }))
      .map(([y, m, day]) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
    fc.assert(
      fc.property(fc.oneof(candidate, fc.string({ maxLength: 12 })), (s) => {
        expect(isCivilDate(s)).toBe(zodDate.safeParse(s).success);
      }),
      { numRuns: 5_000 },
    );
  });

  it.each(["2026-02-30", "2026-13-01", "2026-00-10", "2026-1-01", "26-01-01", " 2026-01-01", "2026-01-01T00:00", "2026/01/01", ""])(
    "rejects %j",
    (s) => {
      expect(isCivilDate(s)).toBe(false);
      expect(parseIsoDate(s)).toBeNull();
    },
  );

  it("store only dates inside the window", () => {
    expect(DATE_MIN).toBe("1970-01-01");
    expect(DATE_MAX).toBe("2199-12-31");
    expect(parseIsoDate("1970-01-01")).toBe("1970-01-01");
    expect(parseIsoDate("2199-12-31")).toBe("2199-12-31");
    expect(parseIsoDate("1969-12-31")).toBeNull();
    expect(parseIsoDate("2200-01-01")).toBeNull();
    expect(isStorableDate("2026-10-14")).toBe(true);
  });

  it("builds dates from parts and refuses days that don't exist", () => {
    expect(isoDate(2026, 10, 14)).toBe("2026-10-14");
    expect(isoDate(5, 1, 2)).toBe("0005-01-02");
    expect(() => isoDate(2025, 2, 29)).toThrow(RangeError);
    expect(() => isoDate(2026, 13, 1)).toThrow(RangeError);
    expect(() => isoDate(2026, 4, 31)).toThrow(RangeError);
    expect(() => isoDate(10000, 1, 1)).toThrow(RangeError);
    expect(() => isoDate(2026, 1, 1.5)).toThrow(RangeError);
  });

  it("compare like their days", () => {
    expect(compareDates(d("2026-09-30"), d("2026-10-01"))).toBe(-1);
    expect(compareDates(d("2026-10-01"), d("2026-10-01"))).toBe(0);
    expect(compareDates(d("2027-01-01"), d("2026-12-31"))).toBe(1);
  });

  it("add and subtract consistently", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 80_000 }), fc.integer({ min: -20_000, max: 20_000 }), (n, k) => {
        const a = fromDayNum(n);
        const b = addDays(a, k);
        expect(daysBetween(a, b)).toBe(k);
        expect(addDays(b, -k)).toBe(a);
        expect(compareDates(a, b)).toBe(k > 0 ? -1 : k < 0 ? 1 : 0);
      }),
    );
  });
});

describe("isoWeekday", () => {
  it.each([
    ["1970-01-01", 4],
    ["2026-09-28", 1],
    ["2026-10-14", 3],
    ["2026-10-18", 7],
    ["2000-01-01", 6],
  ])("%s is weekday %i", (iso, weekday) => {
    expect(isoWeekday(d(iso))).toBe(weekday);
    expect(isoWeekday(toDayNum(d(iso)))).toBe(weekday);
  });

  it("matches Date#getUTCDay before and after the epoch", () => {
    fc.assert(
      fc.property(dayNum, (n) => {
        expect(isoWeekday(n)).toBe(new Date(n * DAY_MS).getUTCDay() || 7);
      }),
    );
  });
});

describe("isoWeek", () => {
  it.each([
    ["2026-12-31", "2026-W53", "2026-12-28", "2027-01-03"],
    ["2027-01-01", "2026-W53", "2026-12-28", "2027-01-03"],
    ["2027-01-03", "2026-W53", "2026-12-28", "2027-01-03"],
    ["2027-01-04", "2027-W01", "2027-01-04", "2027-01-10"],
    ["2021-01-03", "2020-W53", "2020-12-28", "2021-01-03"],
    ["2021-01-04", "2021-W01", "2021-01-04", "2021-01-10"],
    ["2008-12-29", "2009-W01", "2008-12-29", "2009-01-04"],
    ["2010-01-03", "2009-W53", "2009-12-28", "2010-01-03"],
    ["2026-01-01", "2026-W01", "2025-12-29", "2026-01-04"],
    ["2026-10-14", "2026-W42", "2026-10-12", "2026-10-18"],
    ["2024-02-29", "2024-W09", "2024-02-26", "2024-03-03"],
  ])("%s is in %s (%s to %s)", (iso, key, monday, sunday) => {
    const w = isoWeek(d(iso));
    expect(w.key).toBe(key);
    expect(`${w.year}-W${String(w.week).padStart(2, "0")}`).toBe(key);
    expect(w.monday).toBe(monday);
    expect(w.sunday).toBe(sunday);
  });

  it("matches the Date oracle and holds its own laws", () => {
    fc.assert(
      fc.property(fc.integer({ min: dayNumFromCivil(1900, 1, 1), max: dayNumFromCivil(2300, 12, 31) }), (n) => {
        const iso = fromDayNum(n);
        const w = isoWeek(iso);
        expect({ year: w.year, week: w.week }).toEqual(oracleIsoWeek(iso));
        expect(isoWeekday(w.monday)).toBe(1);
        expect(daysBetween(w.monday, w.sunday)).toBe(6);
        expect(w.monday <= iso && iso <= w.sunday).toBe(true);
        expect(w.week).toBeLessThanOrEqual(isoWeeksInYear(w.year));
        expect(isoWeekMonday(w.year, w.week)).toBe(w.monday);
      }),
      { numRuns: 5_000 },
    );
  });

  it("counts 53 weeks in the long years", () => {
    const long = [2004, 2009, 2015, 2020, 2026, 2032, 2037];
    for (let year = 2000; year <= 2040; year++) expect(isoWeeksInYear(year)).toBe(long.includes(year) ? 53 : 52);
    expect(isoWeek(d("2026-12-28")).week).toBe(53);
    expect(isoWeek(d("2025-12-28")).week).toBe(52);
  });

  it("finds the Monday of a week, and refuses a week the year doesn't have", () => {
    expect(isoWeekMonday(2026, 1)).toBe("2025-12-29");
    expect(isoWeekMonday(2026, 53)).toBe("2026-12-28");
    expect(() => isoWeekMonday(2025, 53)).toThrow(RangeError);
    expect(() => isoWeekMonday(2026, 0)).toThrow(RangeError);
  });
});

describe("todayIn", () => {
  it.each([
    // 23:30 UTC: Rome is already tomorrow (CEST +2, CET +1), Auckland is tomorrow noon (NZDT +13)
    ["Europe/Rome", "2026-10-14T23:30:00Z", "2026-10-15"],
    ["Pacific/Auckland", "2026-10-14T23:30:00Z", "2026-10-15"],
    ["Europe/Rome", "2026-01-14T23:30:00Z", "2026-01-15"],
    ["Pacific/Auckland", "2026-01-14T23:30:00Z", "2026-01-15"],
    ["UTC", "2026-10-14T23:30:00Z", "2026-10-14"],
    ["America/Los_Angeles", "2026-10-15T06:59:00Z", "2026-10-14"],
    ["America/Los_Angeles", "2026-10-15T07:00:00Z", "2026-10-15"],
    // Rome's spring change (01:00 UTC, 29 Mar): 22:59 UTC is still the 28th at 23:59 CET
    ["Europe/Rome", "2026-03-28T22:59:00Z", "2026-03-28"],
    ["Europe/Rome", "2026-03-28T23:00:00Z", "2026-03-29"],
    // Rome's autumn change (01:00 UTC, 25 Oct): 21:59 UTC is 23:59 CEST on the 24th
    ["Europe/Rome", "2026-10-24T21:59:00Z", "2026-10-24"],
    ["Europe/Rome", "2026-10-24T22:00:00Z", "2026-10-25"],
    ["Europe/Rome", "2026-10-25T22:59:00Z", "2026-10-25"],
    ["Europe/Rome", "2026-10-25T23:00:00Z", "2026-10-26"],
    // Auckland's spring change (27 Sep 2026, 02:00 NZST = 14:00 UTC on the 26th)
    ["Pacific/Auckland", "2026-09-26T11:59:00Z", "2026-09-26"],
    ["Pacific/Auckland", "2026-09-26T12:00:00Z", "2026-09-27"],
    ["Pacific/Auckland", "2026-09-27T10:59:00Z", "2026-09-27"],
    ["Pacific/Auckland", "2026-09-27T11:00:00Z", "2026-09-28"],
    // Leap day
    ["Pacific/Auckland", "2028-02-28T11:00:00Z", "2028-02-29"],
  ])("%s at %s is %s", (tz, instant, expected) => {
    expect(todayIn(tz, utc(instant))).toBe(expected);
  });

  it("throws for a zone Intl doesn't know", () => {
    expect(() => todayIn("Mars/Olympus_Mons", 0)).toThrow(RangeError);
  });
});

describe("isIanaZone", () => {
  it.each(["Europe/Rome", "Pacific/Auckland", "UTC", "Etc/GMT+1", "America/Argentina/Buenos_Aires", "Africa/Dar_es_Salaam", "America/Port-au-Prince", "US/Eastern"])(
    "accepts %s",
    (tz) => {
      expect(isIanaZone(tz)).toBe(true);
    },
  );

  it.each(["", "europe/rome", "+01:00", "-05:00", "Z", "local", "Foo/Bar", "Europe/", "/Europe", "Europe//Rome", `Europe/${"A".repeat(60)}`])(
    "rejects %j",
    (tz) => {
      expect(isIanaZone(tz)).toBe(false);
    },
  );

  it("accepts every zone this runtime lists", () => {
    for (const tz of Intl.supportedValuesOf("timeZone")) expect(isIanaZone(tz), tz).toBe(true);
  });
});
