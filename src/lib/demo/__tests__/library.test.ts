// The /demo breakdown library (plan §8.4, Q20): v0's steps, shared out by largest remainder in
// half days, so a proposal's steps add up to the task's estimate exactly, or carry none.
import { describe, expect, it } from "vitest";
import { allocateUnits, BREAKDOWN_LIBRARY, breakdownFor, GENERIC_STEPS } from "@/lib/demo/library";

const sum = (xs: readonly (number | null)[]) => xs.reduce<number>((s, x) => s + (x ?? 0), 0);

describe("allocateUnits", () => {
  it("gives one unit each, then the rest by weight with the largest remainder", () => {
    expect(allocateUnits(12, [1.5, 2, 1.5, 1])).toEqual([3, 4, 3, 2]);
    expect(allocateUnits(10, [1, 1, 1, 1])).toEqual([3, 3, 2, 2]);
    expect(allocateUnits(4, [1, 1, 1, 1])).toEqual([1, 1, 1, 1]);
    expect(allocateUnits(7, [2, 4, 2])).toEqual([2, 3, 2]);
  });

  it("breaks ties toward the earlier step", () => {
    expect(allocateUnits(5, [1, 1])).toEqual([3, 2]);
    expect(allocateUnits(6, [1, 1, 1, 1])).toEqual([2, 2, 1, 1]);
  });

  it("refuses fewer units than steps, and no steps", () => {
    expect(allocateUnits(3, [1, 1, 1, 1])).toBeNull();
    expect(allocateUnits(0, [1])).toBeNull();
    expect(allocateUnits(4, [])).toBeNull();
  });

  it("always sums to the units, with at least one each", () => {
    for (const weights of [...BREAKDOWN_LIBRARY.map((e) => e.steps.map(([, w]) => w)), GENERIC_STEPS.map(([, w]) => w), [0, 0, 0], [5, 0.1]]) {
      for (let units = weights.length; units <= 500; units++) {
        const out = allocateUnits(units, weights)!;
        expect(sum(out)).toBe(units);
        expect(Math.min(...out)).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe("breakdownFor", () => {
  it("keeps v0's steps for the demo tasks, which already added up", () => {
    expect(breakdownFor({ title: "UI Design", estimateDays: 6 })).toEqual([
      { title: "Wireframes & flows", estimateDays: 1.5 },
      { title: "Key screens", estimateDays: 2 },
      { title: "Component library", estimateDays: 1.5 },
      { title: "Prototype & handoff", estimateDays: 1 },
    ]);
    expect(breakdownFor({ title: "Research", estimateDays: 3 }).map((s) => s.estimateDays)).toEqual([1, 1, 1]);
    expect(breakdownFor({ title: "Visual Direction", estimateDays: 4 }).map((s) => s.estimateDays)).toEqual([1, 1.5, 1.5]);
    expect(breakdownFor({ title: "Development", estimateDays: 8 }).map((s) => s.estimateDays)).toEqual([2, 4, 2]);
  });

  it("adds up where v0 didn't: a 5-day task gets 5 days of steps, not 6", () => {
    const steps = breakdownFor({ title: "Copywriting", estimateDays: 5 });
    expect(steps.map((s) => s.title)).toEqual(["Define scope", "First pass", "Review", "Finalise"]);
    expect(steps.map((s) => s.estimateDays)).toEqual([1.5, 1.5, 1, 1]);
  });

  it("carries no estimates without one, or with fewer half days than steps", () => {
    expect(breakdownFor({ title: "UI Design", estimateDays: null }).every((s) => s.estimateDays === null)).toBe(true);
    expect(breakdownFor({ title: "UI Design", estimateDays: 1.5 }).every((s) => s.estimateDays === null)).toBe(true);
    expect(breakdownFor({ title: "UI Design", estimateDays: 2 }).map((s) => s.estimateDays)).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it("picks the first entry whose words the title holds, as v0 did", () => {
    expect(breakdownFor({ title: "Brand audit", estimateDays: 3 })[0].title).toBe("Stakeholder interviews");
    expect(breakdownFor({ title: "Front-end build", estimateDays: 8 })[0].title).toBe("Setup & CMS");
  });

  it("sums to the estimate for every entry and every estimate up to 60 days", () => {
    for (const title of ["Research", "Visual Direction", "UI Design", "Development", "Copywriting"]) {
      for (let e = 0.5; e <= 60; e += 0.5) {
        const steps = breakdownFor({ title, estimateDays: e });
        const known = steps.map((s) => s.estimateDays);
        if (known.every((d) => d === null)) expect(e * 2).toBeLessThan(steps.length);
        else {
          expect(sum(known)).toBe(e);
          for (const d of known) expect(d! * 2).toBe(Math.round(d! * 2));
        }
      }
    }
  });
});
