// The schedule (plan §6.3, §10.3 item 10) over random projects and calendars: it is total, and it
// agrees with a naive oracle on starts, finishes, unknown causes and floats. Runs FC_RUNS times
// (10,000 in CI). The planning property of the full suite (step 16) runs on reducer states.
import fc from "fast-check";
import { describe, it } from "vitest";
import { agreesWithOracle, isTotal, scheduleCase } from "@/lib/planning/__tests__/schedule-oracle";

describe("schedule", () => {
  it("is total on random projects", () => {
    fc.assert(fc.property(scheduleCase, isTotal));
  });

  it("agrees with the naive oracle", () => {
    fc.assert(fc.property(scheduleCase, (c) => void agreesWithOracle(c)));
  });
});
