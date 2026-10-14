// Smoke test for the property project: the global settings apply and a property runs.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

describe("property harness", () => {
  it("applies the global fast-check settings", () => {
    const config = fc.readConfigureGlobal();
    expect(config.numRuns).toBe(Number(process.env.FC_RUNS ?? 500));
    expect(config.endOnFailure).toBe(true);
  });

  it("runs a property", () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), (xs) => {
        const sorted = [...xs].sort((a, b) => a - b);
        expect([...sorted].sort((a, b) => a - b)).toEqual(sorted);
      }),
    );
  });
});
