// Smoke test for the perf project: the timing helpers measure and the budget scales.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PERF_SCALE, budget, time } from "./timing";

describe("perf harness", () => {
  it("scales budgets by PERF_SCALE", () => {
    expect(budget(2)).toBe(2 * PERF_SCALE);
  });

  it("times a call within its budget", () => {
    const text = readFileSync(new URL("../fixtures/v0/doc150.json", import.meta.url), "utf8");
    const timing = time(() => JSON.parse(text));
    expect(timing.min).toBeLessThanOrEqual(timing.median);
    expect(timing.median).toBeLessThanOrEqual(timing.p95);
    expect(timing.median).toBeLessThan(budget(5));
  });
});
