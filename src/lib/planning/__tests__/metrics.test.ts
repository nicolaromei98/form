// Project metrics (plan §6.4): estimate-weighted complete %, counts, the planned end and its gap
// to the deadline, and the budget with derived costs.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IsoDate, type ProjectDoc, TaskId } from "@/lib/domain/schema";
import { makeCalendar } from "@/lib/planning/calendar";
import { metrics } from "@/lib/planning/metrics";
import { schedule } from "@/lib/planning/schedule";
import { DocSchema } from "../../../../test/legacy/v0/lib/schema";
import { metrics as legacyMetrics } from "../../../../test/legacy/v0/lib/selectors";
import { activeProject, DEMO_PEOPLE, demoState, makeTask, taskByTitle } from "../../../../test/fixtures/v2/build";

const d = (s: string) => IsoDate.parse(s);
const cal = makeCalendar({ workingDays: [1, 2, 3, 4, 5], closures: [] });

function withTask(p: ProjectDoc, title: string, patch: Partial<ProjectDoc["tasks"][TaskId]>): ProjectDoc {
  const t = taskByTitle(p, title);
  return { ...p, tasks: { ...p.tasks, [t.id]: { ...t, ...patch } } };
}

const state = demoState();
const demo = activeProject(state);
const ws = state.workspace;
const of = (p: ProjectDoc, w = ws) => metrics(p, schedule(p, cal), w, cal);

describe("counts and progress", () => {
  it("match v0 on the demo", () => {
    const m = of(demo);
    expect(m).toMatchObject({
      count: 4,
      done: 1,
      byStatus: { todo: 1, active: 1, review: 1, done: 1 },
      totalEstimate: 21,
      missingEstimates: 0,
      urgentOpen: 1,
      steps: 0,
      stepsDone: 0,
      // (100 × 3 + 85 × 4 + 30 × 6 + 0 × 8) / 21 = 39.05
      completePct: 39,
      uncounted: [],
      plannedEnd: "2026-10-26",
      endIsLowerBound: false,
      deadlineGap: null,
    });
    // The same figures as v0 on the frozen demo document
    const docDemo = DocSchema.parse(JSON.parse(readFileSync(new URL("../../../../test/fixtures/v0/docDemo.json", import.meta.url), "utf8")).state.doc);
    const legacy = legacyMetrics(docDemo);
    expect([m.completePct, m.count, m.done, m.totalEstimate, m.missingEstimates, m.urgentOpen]).toEqual([
      legacy.progress,
      legacy.count,
      legacy.done,
      legacy.totalEstimate,
      legacy.missingEstimates,
      legacy.urgent,
    ]);
  });

  it("leave tasks without an estimate out of complete %, and say which", () => {
    const p = withTask(demo, "UI Design", { estimateDays: null });
    const m = of(p);
    // (100 × 3 + 85 × 4 + 0 × 8) / 15 = 42.67
    expect(m.completePct).toBe(43);
    expect(m.uncounted).toEqual([taskByTitle(p, "UI Design").id]);
    expect(m.missingEstimates).toBe(1);
    expect(m.endIsLowerBound).toBe(true);
    expect(m.plannedEnd).toBe("2026-10-06");
  });

  it("fall back to the plain average of progress when nothing has an estimate", () => {
    let p = demo;
    for (const title of ["Research", "Visual Direction", "UI Design", "Development"]) p = withTask(p, title, { estimateDays: null });
    // (100 + 85 + 30 + 0) / 4 = 53.75
    expect(of(p).completePct).toBe(54);
    expect(of(p).plannedEnd).toBeNull();
  });

  it("count milestones as tasks but leave them out of progress and estimates", () => {
    const m0 = makeTask({ id: TaskId.parse("tsk_launchmilestone"), title: "Launch", kind: "milestone", estimateDays: 0, order: "a9" });
    const p = { ...demo, tasks: { ...demo.tasks, [m0.id]: m0 } };
    const m = of(p);
    expect(m.count).toBe(5);
    expect(m.byStatus.todo).toBe(2);
    expect(m.completePct).toBe(39);
    expect(m.missingEstimates).toBe(0);
    expect(m.budget.withoutCost).not.toContain(m0.id);
  });

  it("count steps and done steps", () => {
    const p = withTask(demo, "UI Design", {
      steps: [
        { id: "stp_wireframes0" as never, title: "Wireframes", done: true, ownerId: null, estimateDays: 2 },
        { id: "stp_hifidesign0" as never, title: "Hi-fi", done: false, ownerId: null, estimateDays: null },
      ],
    });
    expect(of(p)).toMatchObject({ steps: 2, stepsDone: 1 });
  });
});

describe("the deadline gap", () => {
  it("is positive after the deadline, 0 on it and negative before it", () => {
    expect(of({ ...demo, deadline: d("2026-10-14") }).deadlineGap).toBe(8);
    expect(of({ ...demo, deadline: d("2026-10-26") }).deadlineGap).toBe(0);
    // 27, 28, 29 and 30 Oct to spare
    expect(of({ ...demo, deadline: d("2026-10-30") }).deadlineGap).toBe(-4);
    expect(of({ ...demo, deadline: d("2026-10-31") }).deadlineGap).toBe(-4);
  });

  it("is null without dates", () => {
    expect(of({ ...demo, startDate: null, deadline: d("2026-10-14") }).deadlineGap).toBeNull();
  });
});

describe("the budget", () => {
  const people = {
    ...ws.people,
    [DEMO_PEOPLE.marta]: { ...ws.people[DEMO_PEOPLE.marta], dayRateCents: 40_000 },
    [DEMO_PEOPLE.sara]: { ...ws.people[DEMO_PEOPLE.sara], dayRateCents: 35_050, archived: true },
  };
  const rated = { ...ws, people };

  it("adds manual costs, derives the rest from day rates and lists what has no cost", () => {
    const p = { ...withTask(demo, "Research", { costCents: 120_000 }), budgetCents: 1_000_000 };
    const m = of(p, rated);
    expect(m.budget).toEqual({
      currency: "EUR",
      budgetCents: 1_000_000,
      knownCents: 120_000,
      // Visual Direction 4d and UI Design 6d at Marta's 400.00
      derivedCents: 400_000,
      derived: [taskByTitle(p, "Visual Direction").id, taskByTitle(p, "UI Design").id],
      // Luca has no day rate
      withoutCost: [taskByTitle(p, "Development").id],
    });
  });

  it("never derives from an archived owner or overwrites a manual cost", () => {
    const p = withTask(withTask(demo, "Visual Direction", { costCents: 1 }), "Development", { ownerId: DEMO_PEOPLE.sara });
    const m = of(p, rated);
    expect(m.budget.knownCents).toBe(1);
    expect(m.budget.derived).toEqual([taskByTitle(p, "UI Design").id]);
    expect(m.budget.withoutCost).toEqual([taskByTitle(p, "Research").id, taskByTitle(p, "Development").id]);
  });

  it("rounds half-day derived costs to the cent", () => {
    const p = withTask(demo, "UI Design", { estimateDays: 0.5, ownerId: DEMO_PEOPLE.marta });
    const odd = { ...ws, people: { ...ws.people, [DEMO_PEOPLE.marta]: { ...ws.people[DEMO_PEOPLE.marta], dayRateCents: 333 } } };
    expect(of(p, odd).budget.derivedCents).toBe(Math.round(4 * 333) + Math.round(0.5 * 333));
  });
});
