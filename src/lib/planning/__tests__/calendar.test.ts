import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { addDays, fromDayNum, toDayNum } from "@/lib/domain/dates";
import { ClosureId, TimeOffId } from "@/lib/domain/schema/ids";
import { IsoDate, Line, WorkingDays } from "@/lib/domain/schema/primitives";
import {
  calendarKey,
  effectiveSpec,
  isoWeek,
  makeCalendar,
  personCalendar,
  rangesOf,
  type CalendarSpec,
  type DateRange,
} from "@/lib/planning/calendar";
import { agreesWithDayWalk, calendarCase, dayWalk, questions } from "./calendar-oracle";

const d = (s: string) => IsoDate.parse(s);
/** A date outside the stored window, which planning may still compute */
const far = (s: string) => s as IsoDate;
const range = (from: string, to: string): DateRange => ({ from: d(from), to: d(to) });
const MON_FRI = [1, 2, 3, 4, 5] as const;
const monFri = (closures: DateRange[] = []): CalendarSpec => ({ workingDays: MON_FRI, closures });

/**
 * The shapes the step 7 documents give these fields (plan §3.3, §3.4). Built from the domain
 * primitives here, so the type checker proves a parsed WorkspaceDoc, ProjectDoc and Person can be
 * handed to the calendar as they are.
 */
const Closure = z.object({ id: ClosureId, from: IsoDate, to: IsoDate, label: Line(60) }).strict();
const TimeOff = z.object({ id: TimeOffId, from: IsoDate, to: IsoDate, label: Line(60).nullable() }).strict();
const WorkspaceFields = z.object({ workingDays: WorkingDays, closures: z.record(ClosureId, Closure) });
const ProjectFields = z.object({
  calendarOverride: z
    .object({ workingDays: WorkingDays.nullable(), closures: z.record(ClosureId, Closure).nullable() })
    .strict()
    .nullable(),
});
const PersonFields = z.object({ timeOff: z.record(TimeOffId, TimeOff) });

const NEW_YEAR = { id: "cls_newyear00000000", from: "2026-12-24", to: "2027-01-06", label: "Studio closed" };
const AUGUST = { id: "cls_august000000000", from: "2026-08-10", to: "2026-08-21", label: "Summer" };
const workspace = WorkspaceFields.parse({
  workingDays: [1, 2, 3, 4, 5],
  closures: { [NEW_YEAR.id]: NEW_YEAR, [AUGUST.id]: AUGUST },
});

describe("a Monday-to-Friday calendar", () => {
  const cal = makeCalendar(monFri());

  it("works on weekdays only", () => {
    expect(cal.isWorkingDay(d("2026-10-16"))).toBe(true); // Friday
    expect(cal.isWorkingDay(d("2026-10-17"))).toBe(false); // Saturday
    expect(cal.isWorkingDay(d("2026-10-18"))).toBe(false); // Sunday
    expect(cal.isWorkingDay(d("2026-10-19"))).toBe(true); // Monday
  });

  it("gives a weekend day the ordinal of the next Monday", () => {
    const monday = cal.ordinal(d("2026-10-19"));
    expect(cal.ordinal(d("2026-10-17"))).toBe(monday);
    expect(cal.ordinal(d("2026-10-18"))).toBe(monday);
    expect(cal.ordinal(d("2026-10-16"))).toBe(monday - 1);
    expect(cal.ordinal(d("2026-10-26")) - monday).toBe(5);
  });

  it("finds the next working day, inclusive or not", () => {
    expect(cal.nextWorkingDay(d("2026-10-17"), true)).toBe("2026-10-19");
    expect(cal.nextWorkingDay(d("2026-10-17"), false)).toBe("2026-10-19");
    expect(cal.nextWorkingDay(d("2026-10-16"), true)).toBe("2026-10-16");
    expect(cal.nextWorkingDay(d("2026-10-16"), false)).toBe("2026-10-19");
    expect(cal.nextWorkingDay(d("2026-10-14"), false)).toBe("2026-10-15");
  });

  it("adds working days across weekends, forwards and back", () => {
    expect(cal.addWorkingDays(d("2026-10-16"), 1)).toBe("2026-10-19");
    expect(cal.addWorkingDays(d("2026-10-14"), 0)).toBe("2026-10-14");
    expect(cal.addWorkingDays(d("2026-10-17"), 0)).toBe("2026-10-19");
    expect(cal.addWorkingDays(d("2026-10-17"), 1)).toBe("2026-10-20");
    expect(cal.addWorkingDays(d("2026-10-19"), -1)).toBe("2026-10-16");
    expect(cal.addWorkingDays(d("2026-10-18"), -1)).toBe("2026-10-16");
    expect(cal.addWorkingDays(d("2026-10-14"), 10)).toBe("2026-10-28");
  });

  it("counts working days between two dates, both included", () => {
    expect(cal.workingDaysBetween(d("2026-10-12"), d("2026-10-18"))).toBe(5);
    expect(cal.workingDaysBetween(d("2026-10-14"), d("2026-10-14"))).toBe(1);
    expect(cal.workingDaysBetween(d("2026-10-17"), d("2026-10-17"))).toBe(0);
    expect(cal.workingDaysBetween(d("2026-10-17"), d("2026-10-18"))).toBe(0);
    expect(cal.workingDaysBetween(d("2026-10-01"), d("2026-10-31"))).toBe(22);
    expect(cal.workingDaysBetween(d("2026-10-15"), d("2026-10-14"))).toBe(0);
  });

  it("maps ordinals back to working days", () => {
    const i = cal.ordinal(d("2026-10-14"));
    expect(cal.dateAt(i)).toBe("2026-10-14");
    expect(cal.dateAt(i + 3)).toBe("2026-10-19");
    expect(cal.dateAt(i - 3)).toBe("2026-10-09");
  });

  it("lays out the demo chain from Monday 28 September 2026 (plan §6.3)", () => {
    // Research 3 days, Visual Direction 4, UI Design 6, Development 8, back to back
    const start = cal.ordinal(d("2026-09-28"));
    const spans: [string, string][] = [];
    let es = start;
    for (const days of [3, 4, 6, 8]) {
      spans.push([cal.dateAt(es), cal.dateAt(es + days - 1)]);
      es += days;
    }
    expect(spans).toEqual([
      ["2026-09-28", "2026-09-30"],
      ["2026-10-01", "2026-10-06"],
      ["2026-10-07", "2026-10-14"],
      ["2026-10-15", "2026-10-26"],
    ]);
    for (const [from, to] of spans) {
      for (let n = toDayNum(d(from)); n <= toDayNum(d(to)); n++) {
        if (cal.isWorkingDay(fromDayNum(n))) continue;
        // Only weekends inside a span, and never at its ends
        expect(fromDayNum(n)).not.toBe(from);
        expect(fromDayNum(n)).not.toBe(to);
      }
    }
  });
});

describe("closures", () => {
  const cal = makeCalendar(monFri([range("2026-12-24", "2027-01-06")]));

  it("keep every day of a closure across New Year off", () => {
    for (let n = toDayNum(d("2026-12-24")); n <= toDayNum(d("2027-01-06")); n++) {
      expect(cal.isWorkingDay(fromDayNum(n))).toBe(false);
    }
    expect(cal.isWorkingDay(d("2026-12-23"))).toBe(true);
    expect(cal.isWorkingDay(d("2027-01-07"))).toBe(true);
  });

  it("are skipped when adding and counting working days", () => {
    expect(cal.addWorkingDays(d("2026-12-23"), 1)).toBe("2027-01-07");
    expect(cal.addWorkingDays(d("2027-01-07"), -1)).toBe("2026-12-23");
    expect(cal.nextWorkingDay(d("2026-12-24"), true)).toBe("2027-01-07");
    expect(cal.ordinal(d("2026-12-25"))).toBe(cal.ordinal(d("2027-01-07")));
    // Mon 21, Tue 22, Wed 23, then Thu 7 and Fri 8
    expect(cal.workingDaysBetween(d("2026-12-21"), d("2027-01-08"))).toBe(5);
  });

  it("put no task day inside the closure", () => {
    // A 10-day task starting Monday 21 December runs 21–23 Dec, then 7–15 Jan
    const es = cal.ordinal(d("2026-12-21"));
    const days = Array.from({ length: 10 }, (_, k) => cal.dateAt(es + k));
    expect(days).toEqual([
      "2026-12-21",
      "2026-12-22",
      "2026-12-23",
      "2027-01-07",
      "2027-01-08",
      "2027-01-11",
      "2027-01-12",
      "2027-01-13",
      "2027-01-14",
      "2027-01-15",
    ]);
  });

  it("may overlap, touch, nest or fall on weekends", () => {
    const pieces = makeCalendar(
      monFri([
        range("2026-12-24", "2026-12-28"),
        range("2026-12-29", "2027-01-01"),
        range("2026-12-26", "2026-12-27"),
        range("2027-01-02", "2027-01-06"),
      ]),
    );
    expect(pieces).toBe(cal);
    expect(pieces.addWorkingDays(d("2026-12-23"), 1)).toBe("2027-01-07");
  });

  it("ignore a range that ends before it starts", () => {
    const cal2 = makeCalendar(monFri([range("2026-10-16", "2026-10-14")]));
    expect(cal2.isWorkingDay(d("2026-10-15"))).toBe(true);
    expect(cal2.key).toBe(makeCalendar(monFri()).key);
  });
});

describe("working weekdays", () => {
  it("follow the spec, whatever its order or repeats", () => {
    const monThu = makeCalendar({ workingDays: [4, 1, 3, 2, 2], closures: [] });
    expect(monThu.key).toBe("1234|");
    expect(monThu.isWorkingDay(d("2026-10-16"))).toBe(false); // Friday
    expect(monThu.addWorkingDays(d("2026-10-15"), 1)).toBe("2026-10-19");
    expect(monThu.workingDaysBetween(d("2026-10-12"), d("2026-10-18"))).toBe(4);
  });

  it("can be weekends only", () => {
    const weekends = makeCalendar({ workingDays: [6, 7], closures: [] });
    expect(weekends.nextWorkingDay(d("2026-10-14"), true)).toBe("2026-10-17");
    expect(weekends.addWorkingDays(d("2026-10-17"), 2)).toBe("2026-10-24");
    expect(weekends.workingDaysBetween(d("2026-10-12"), d("2026-10-25"))).toBe(4);
  });

  it("can be every day", () => {
    const all = makeCalendar({ workingDays: [1, 2, 3, 4, 5, 6, 7], closures: [] });
    expect(all.addWorkingDays(d("2026-10-14"), 7)).toBe("2026-10-21");
    expect(all.ordinal(d("2026-10-21")) - all.ordinal(d("2026-10-14"))).toBe(7);
  });

  it("must include at least one valid weekday", () => {
    expect(() => makeCalendar({ workingDays: [], closures: [] })).toThrow(RangeError);
    expect(() => makeCalendar({ workingDays: [0, 8, 2.5], closures: [] })).toThrow(RangeError);
  });
});

describe("the horizon", () => {
  // A closure no other test uses, so this calendar starts with an empty horizon
  const spec = monFri([range("2031-03-03", "2031-03-04")]);

  it("grows on both sides without moving any ordinal", () => {
    const cal = makeCalendar(spec);
    const today = cal.ordinal(d("2026-10-14"));
    const monday = cal.ordinal(d("2026-10-19"));
    expect(cal.isWorkingDay(d("2199-12-31"))).toBe(true); // a Tuesday
    expect(cal.isWorkingDay(d("1970-01-01"))).toBe(true); // a Thursday
    expect(cal.ordinal(d("2026-10-14"))).toBe(today);
    expect(cal.ordinal(d("2026-10-19"))).toBe(monday);
    expect(cal.dateAt(today)).toBe("2026-10-14");
  });

  it("covers questions far apart, with answers that match the day walk", () => {
    const cal = makeCalendar(spec);
    const oracle = dayWalk(spec);
    expect(cal.workingDaysBetween(d("2001-01-01"), d("2040-12-31"))).toBe(oracle.workingDaysBetween(d("2001-01-01"), d("2040-12-31")));
    expect(cal.addWorkingDays(d("2026-10-14"), 5_000)).toBe(oracle.addWorkingDays(d("2026-10-14"), 5_000));
    expect(cal.addWorkingDays(d("2026-10-14"), -5_000)).toBe(oracle.addWorkingDays(d("2026-10-14"), -5_000));
  });

  it("starts where the first question is, even when that is dateAt", () => {
    const fresh = monFri([range("2032-05-05", "2032-05-05")]);
    const a = makeCalendar(fresh);
    const ordinal = makeCalendar(monFri([range("2032-05-05", "2032-05-06")])).ordinal(d("2032-05-04"));
    // Same weekly pattern and days off up to 4 May, so the same ordinal names 4 May in both
    expect(a.dateAt(ordinal)).toBe("2032-05-04");
  });

  it("reaches the first and last representable days, and no further", () => {
    const cal = makeCalendar({ workingDays: [1, 2, 3, 4, 5, 6, 7], closures: [range("2050-01-01", "2050-01-01")] });
    expect(cal.addWorkingDays(far("9999-12-30"), 1)).toBe("9999-12-31");
    expect(() => cal.addWorkingDays(far("9999-12-31"), 1)).toThrow(RangeError);
    expect(() => cal.nextWorkingDay(far("9999-12-31"), false)).toThrow(RangeError);
    expect(cal.addWorkingDays(far("0000-01-02"), -1)).toBe("0000-01-01");
    expect(() => cal.addWorkingDays(far("0000-01-01"), -1)).toThrow(RangeError);
    expect(cal.workingDaysBetween(far("9999-12-01"), far("9999-12-31"))).toBe(31);
  });

  it("refuses fractional working days: a bug in the caller", () => {
    const cal = makeCalendar(monFri());
    expect(() => cal.addWorkingDays(d("2026-10-14"), 1.5)).toThrow(RangeError);
    expect(() => cal.dateAt(0.5)).toThrow(RangeError);
    expect(() => cal.dateAt(Number.NaN)).toThrow(RangeError);
  });
});

describe("keys and memos", () => {
  it("name the weekdays and the merged days off", () => {
    expect(calendarKey(monFri())).toBe("12345|");
    expect(calendarKey(monFri([range("2027-01-02", "2027-01-06"), range("2026-12-24", "2027-01-01")]))).toBe(
      "12345|2026-12-24~2027-01-06",
    );
    expect(calendarKey(monFri([range("2026-12-24", "2026-12-24")]), [range("2026-12-28", "2026-12-28")])).toBe(
      "12345|2026-12-24~2026-12-24,2026-12-28~2026-12-28",
    );
  });

  it("share one calendar per key", () => {
    const a = makeCalendar(monFri([range("2026-12-24", "2027-01-06")]));
    const b = makeCalendar({ workingDays: [5, 4, 3, 2, 1], closures: [range("2026-12-24", "2026-12-31"), range("2027-01-01", "2027-01-06")] });
    expect(b).toBe(a);
    const c = makeCalendar(monFri(), [range("2026-12-24", "2027-01-06")]);
    expect(c).toBe(a);
    expect(makeCalendar(monFri())).not.toBe(a);
  });

  it("are frozen", () => {
    const cal = makeCalendar(monFri());
    expect(Object.isFrozen(cal)).toBe(true);
  });
});

describe("effectiveSpec and personCalendar", () => {
  it("use the workspace calendar when the project has no override", () => {
    const spec = effectiveSpec(workspace);
    expect(spec.workingDays).toBe(workspace.workingDays);
    expect(spec.closures).toEqual([range("2026-08-10", "2026-08-21"), range("2026-12-24", "2027-01-06")]);
    expect(effectiveSpec(workspace, ProjectFields.parse({ calendarOverride: null }))).toBe(spec);
    expect(effectiveSpec(workspace)).toBe(spec);
  });

  it("replace the workspace calendar field by field", () => {
    const days = ProjectFields.parse({ calendarOverride: { workingDays: [1, 2, 3, 4], closures: null } });
    const daysSpec = effectiveSpec(workspace, days);
    expect(daysSpec.workingDays).toEqual([1, 2, 3, 4]);
    expect(daysSpec.closures).toBe(effectiveSpec(workspace).closures);

    const closures = ProjectFields.parse({ calendarOverride: { workingDays: null, closures: {} } });
    const closuresSpec = effectiveSpec(workspace, closures);
    expect(closuresSpec.workingDays).toBe(workspace.workingDays);
    expect(closuresSpec.closures).toEqual([]);
    expect(makeCalendar(closuresSpec).isWorkingDay(d("2026-12-28"))).toBe(true);
    expect(makeCalendar(effectiveSpec(workspace)).isWorkingDay(d("2026-12-28"))).toBe(false);
  });

  it("read closures the same whatever the record key order", () => {
    const reversed = WorkspaceFields.parse({
      workingDays: [1, 2, 3, 4, 5],
      closures: { [AUGUST.id]: AUGUST, [NEW_YEAR.id]: NEW_YEAR },
    });
    expect(effectiveSpec(reversed)).toEqual(effectiveSpec(workspace));
    expect(calendarKey(effectiveSpec(reversed))).toBe(calendarKey(effectiveSpec(workspace)));
    expect(rangesOf(reversed.closures)).toEqual(rangesOf(workspace.closures));
  });

  it("take a person's time off away from the workspace calendar", () => {
    const person = PersonFields.parse({
      timeOff: {
        off_marta0000000000: { id: "off_marta0000000000", from: "2026-10-19", to: "2026-10-23", label: null },
      },
    });
    const cal = personCalendar(workspace, person);
    expect(cal.workingDaysBetween(d("2026-10-19"), d("2026-10-25"))).toBe(0);
    expect(cal.workingDaysBetween(d("2026-10-12"), d("2026-10-18"))).toBe(5);
    expect(cal.isWorkingDay(d("2026-12-28"))).toBe(false); // the workspace closure still applies
    expect(cal.key).toBe("12345|2026-08-10~2026-08-21,2026-10-19~2026-10-23,2026-12-24~2027-01-06");
    expect(personCalendar(workspace, person)).toBe(cal);
    expect(personCalendar(workspace, PersonFields.parse({ timeOff: {} }))).toBe(makeCalendar(effectiveSpec(workspace)));
  });
});

describe("isoWeek", () => {
  it.each([
    ["2026-12-31", "2026-W53"],
    ["2027-01-01", "2026-W53"],
    ["2027-01-04", "2027-W01"],
    ["2021-01-03", "2020-W53"],
    ["2026-10-14", "2026-W42"],
  ])("puts %s in %s", (date, key) => {
    expect(isoWeek(d(date)).key).toBe(key);
  });

  it("spans Monday to Sunday", () => {
    expect(isoWeek(d("2026-10-14"))).toMatchObject({ year: 2026, week: 42, monday: "2026-10-12", sunday: "2026-10-18" });
  });
});

describe("against a day-walk oracle", () => {
  it("agrees on random specs, days off and questions", () => {
    fc.assert(fc.property(calendarCase, questions, (c, qs) => agreesWithDayWalk(c, qs)));
  });

  it("agrees on a whole year of Monday-to-Friday with closures, day by day", () => {
    const spec = monFri([range("2026-12-24", "2027-01-06"), range("2026-08-10", "2026-08-21"), range("2026-04-06", "2026-04-06")]);
    const cal = makeCalendar(spec);
    const oracle = dayWalk(spec);
    for (let n = toDayNum(d("2026-01-01")); n <= toDayNum(d("2027-01-31")); n++) {
      const day = fromDayNum(n);
      expect(cal.isWorkingDay(day)).toBe(oracle.isWorkingDay(day));
      expect(cal.addWorkingDays(day, 7)).toBe(oracle.addWorkingDays(day, 7));
      expect(cal.workingDaysBetween(day, addDays(day, 30))).toBe(oracle.workingDaysBetween(day, addDays(day, 30)));
    }
  });
});
