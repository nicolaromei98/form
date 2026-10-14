// The working-day calendar (plan §6.1, §10.3): it agrees with a naive day walk over random specs,
// closures, time off and questions, and keeps its two laws. Runs FC_RUNS times (10,000 in CI).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fromDayNum } from "@/lib/domain/dates";
import { makeCalendar } from "@/lib/planning/calendar";
import { agreesWithDayWalk, calendarCase, questions } from "@/lib/planning/__tests__/calendar-oracle";

describe("working-day calendar", () => {
  it("agrees with the day-walk oracle", () => {
    fc.assert(fc.property(calendarCase, questions, (c, qs) => agreesWithDayWalk(c, qs)));
  });

  it("counts n + 1 working days from d to addWorkingDays(d, n)", () => {
    fc.assert(
      fc.property(calendarCase, fc.integer({ min: -400, max: 400 }), fc.integer({ min: 0, max: 600 }), ({ base, spec, extraOff }, day, n) => {
        const cal = makeCalendar(spec, extraOff);
        const d = fromDayNum(base + day);
        expect(cal.workingDaysBetween(d, cal.addWorkingDays(d, n))).toBe(n + 1);
      }),
    );
  });

  it("has a monotone ordinal that steps by one on working days only", () => {
    fc.assert(
      fc.property(calendarCase, fc.integer({ min: -400, max: 400 }), fc.integer({ min: 0, max: 60 }), ({ base, spec, extraOff }, day, span) => {
        const cal = makeCalendar(spec, extraOff);
        let previous = cal.ordinal(fromDayNum(base + day));
        for (let k = 0; k < span; k++) {
          const d = fromDayNum(base + day + k);
          const next = cal.ordinal(fromDayNum(base + day + k + 1));
          expect(next - previous).toBe(cal.isWorkingDay(d) ? 1 : 0);
          previous = next;
        }
      }),
    );
  });
});
