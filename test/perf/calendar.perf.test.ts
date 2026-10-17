// The working-day calendar's budget (plan §11 step 8): 10,000 addWorkingDays calls in < 5 ms.
import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/domain/dates";
import { IsoDate } from "@/lib/domain/schema/primitives";
import { makeCalendar } from "@/lib/planning/calendar";
import { budget, time } from "./timing";

const d = (s: string) => IsoDate.parse(s);
const CALLS = 10_000;

describe("calendar perf", () => {
  // Monday to Friday with a summer closure and one over New Year, like a studio's settings
  const cal = makeCalendar({
    workingDays: [1, 2, 3, 4, 5],
    closures: [
      { from: d("2026-08-10"), to: d("2026-08-21") },
      { from: d("2026-12-24"), to: d("2027-01-06") },
    ],
  });
  // Two years of start days, weekends included, and spans of 0–59 working days
  const starts = Array.from({ length: 730 }, (_, i) => addDays(d("2026-01-01"), i));

  it(`runs ${CALLS.toLocaleString("en-US")} addWorkingDays calls in under 5 ms`, () => {
    let last = starts[0];
    const timing = time(
      () => {
        for (let k = 0; k < CALLS; k++) last = cal.addWorkingDays(starts[k % starts.length], k % 60);
      },
      { warmup: 5, runs: 30 },
    );
    expect(last).toBe(cal.addWorkingDays(starts[(CALLS - 1) % starts.length], (CALLS - 1) % 60));
    console.info(`calendar: ${CALLS} addWorkingDays: median ${timing.median.toFixed(3)} ms, p95 ${timing.p95.toFixed(3)} ms`);
    expect(timing.median).toBeLessThan(budget(5));
  });

  it(`runs ${CALLS.toLocaleString("en-US")} workingDaysBetween calls in under 5 ms`, () => {
    let total = 0;
    const timing = time(
      () => {
        total = 0;
        for (let k = 0; k < CALLS; k++) total += cal.workingDaysBetween(starts[k % starts.length], starts[(k * 7 + 13) % starts.length]);
      },
      { warmup: 5, runs: 30 },
    );
    expect(total).toBeGreaterThan(0);
    expect(timing.median).toBeLessThan(budget(5));
  });
});
