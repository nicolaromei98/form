// The planning façade's budgets (plan §6.8, §10.7), on generated(150, { stepsPerTask: 3,
// predsMean: 1.5, people: 8 }), with the growth guard t(300) / t(150) < 3:
// - planProject cold (schedule + risks + metrics) ≤ 8 ms, target about 2 ms;
// - planProject warm ≤ 0.05 ms.
// "Cold" is a project version the memos have never seen (new tasks record), on a calendar that is
// already built: calendars are shared by key and outlive document versions. Focus joins the cold
// figure in step 12.
import { describe, expect, it } from "vitest";
import type { ProjectDoc } from "@/lib/domain/schema";
import { planProject } from "@/lib/planning";
import { makeCalendar } from "@/lib/planning/calendar";
import { schedule } from "@/lib/planning/schedule";
import { activeProject, FIXTURE_TODAY, type FixtureState, generated } from "../fixtures/v2/build";
import { budget, time } from "./timing";

const PERF_FIXTURE = { stepsPerTask: 3, predsMean: 1.5, people: 8 };
const WARMUP = 5;
const RUNS = 30;

const state150 = generated(150, PERF_FIXTURE);
const state300 = generated(300, PERF_FIXTURE);

/**
 * The same project with every missing estimate set to 2 days. In the plan's fixture one task in
 * ten has no estimate and most of the graph waits on one, so few tasks get dates; this variant
 * places every task, steps included, and is the honest measure of the engine.
 */
function estimated(state: FixtureState): FixtureState {
  const project = activeProject(state);
  const tasks = Object.fromEntries(
    Object.entries(project.tasks).map(([id, t]) => [id, t.kind === "task" && t.estimateDays === null ? { ...t, estimateDays: 2 } : t]),
  ) as ProjectDoc["tasks"];
  return { ...state, projects: { ...state.projects, [project.id]: { ...project, tasks } } };
}
const full150 = estimated(state150);
const full300 = estimated(state300);

/** Versions of a project that no memo has seen: a new project object with a new tasks record */
function versions(project: ProjectDoc, count: number): ProjectDoc[] {
  return Array.from({ length: count }, () => ({ ...project, tasks: { ...project.tasks } }));
}

function touch(project: ProjectDoc, state: FixtureState) {
  const plan = planProject(project, state.workspace, FIXTURE_TODAY);
  return plan.schedule.end !== null && plan.risks.byTask.size >= 0 && plan.metrics.count > 0;
}

/** Cold plans per timed sample: one plan takes a fraction of a millisecond, below the timer's steady range */
const BATCH = 10;

/** Median ms of one cold planProject over fresh versions */
function cold(state: FixtureState) {
  const copies = versions(activeProject(state), (WARMUP + RUNS) * BATCH);
  let k = 0;
  const t = time(
    () => {
      for (let i = 0; i < BATCH; i++) touch(copies[k++], state);
    },
    { warmup: WARMUP, runs: RUNS },
  );
  return { median: t.median / BATCH, p95: t.p95 / BATCH };
}

/** Rounds of the cold measurement */
const ROUNDS = 3;

/** The round with the median median */
function medianOf(timings: { median: number; p95: number }[]) {
  return [...timings].sort((a, b) => a.median - b.median)[timings.length >> 1];
}

const placedIn = (state: FixtureState) =>
  [...planProject(activeProject(state), state.workspace, FIXTURE_TODAY).schedule.timings.values()].filter((t) => t.kind === "scheduled").length;

describe("planning perf", () => {
  // The growth guard is t(300) / t(150) < 3 where 300 tasks are twice the work of 150. In the
  // plan's fixture they aren't: 17 of 150 tasks get dates against 110 of 300, so the engine does
  // about six times the scheduling work, and the guard allows 4 there. The estimated variant is the
  // like-for-like doubling, and keeps the plan's 3.
  it.each([
    ["the plan's fixture", state150, state300, 4],
    ["every task estimated", full150, full300, 3],
  ] as const)("plans 150 tasks cold in at most 8 ms, with the growth guard (%s)", (label, s150, s300, growth) => {
    const placed = placedIn(s150);
    if (s150 === full150) {
      expect([placed, placedIn(s300)]).toEqual([150, 300]);
      expect(planProject(activeProject(s150), s150.workspace, FIXTURE_TODAY).schedule.critical.length).toBeGreaterThan(0);
    } else {
      expect([placed, placedIn(s300)]).toEqual([17, 110]);
    }

    // Rounds alternate the sizes, so a burst of load elsewhere on the machine hits both sides
    const rounds = Array.from({ length: ROUNDS }, () => [cold(s150), cold(s300)] as const);
    const t150 = medianOf(rounds.map(([a]) => a));
    const t300 = medianOf(rounds.map(([, b]) => b));
    console.info(
      `planProject cold (${label}, ${placed}/150 placed): 150 tasks median ${t150.median.toFixed(3)} ms ` +
        `(p95 ${t150.p95.toFixed(3)}), 300 tasks median ${t300.median.toFixed(3)} ms; ratio ${(t300.median / t150.median).toFixed(2)}`,
    );
    expect(t150.median).toBeLessThan(budget(8));
    expect(t300.median / t150.median).toBeLessThan(growth);
  });

  it("answers a warm planProject at 150 tasks in at most 0.05 ms", () => {
    const CALLS = 1_000;
    const warm = (state: FixtureState) => {
      const project = activeProject(state);
      touch(project, state);
      const t = time(
        () => {
          for (let i = 0; i < CALLS; i++) touch(project, state);
        },
        { warmup: WARMUP, runs: RUNS },
      );
      return t.median / CALLS;
    };
    const per150 = warm(full150);
    const per300 = warm(full300);
    console.info(`planProject warm: 150 tasks ${(per150 * 1000).toFixed(2)} µs, 300 tasks ${(per300 * 1000).toFixed(2)} µs per call`);
    expect(per150).toBeLessThan(budget(0.05));
    // A memo hit doesn't depend on the project's size
    expect(per300 / per150).toBeLessThan(3);
  });

  it("schedules 150 estimated tasks well inside the cold budget", () => {
    const p = activeProject(full150);
    const cal = makeCalendar({ workingDays: full150.workspace.workingDays, closures: [] });
    const t = time(() => schedule(p, cal), { warmup: WARMUP, runs: RUNS });
    console.info(`schedule: 150 estimated tasks median ${t.median.toFixed(3)} ms`);
    expect(t.median).toBeLessThan(budget(4));
  });
});
