// Budgets of load, focus, balance and leveling (plan §6.8, §10.7), with the growth guard
// t(300) / t(150) < 3:
// - weeklyLoad, 10 projects × 150 tasks ≤ 15 ms;
// - focus ≤ 2 ms, balance ≤ 5 ms, level ≤ 5 ms, at 150 tasks.
// Fixtures are generated(…, { stepsPerTask: 3, predsMean: 1.5, people: 8 }) with every missing
// estimate set to 2 days: in the plan's fixture most tasks wait on an unknown one and get no dates,
// which would leave load, balance and leveling almost nothing to do. Schedules are computed before
// timing; each timed call recomputes its own function from scratch (none of them is memoised).
import { describe, expect, it } from "vitest";
import type { ProjectDoc } from "@/lib/domain/schema";
import { planProject, type ProjectPlan } from "@/lib/planning";
import { balance } from "@/lib/planning/balance";
import { focus } from "@/lib/planning/focus";
import { level } from "@/lib/planning/level";
import { weeklyLoad } from "@/lib/planning/load";
import { activeProject, FIXTURE_TODAY, type FixtureState, generated, multiProject } from "../fixtures/v2/build";
import { budget, time } from "./timing";

const PERF_FIXTURE = { stepsPerTask: 3, predsMean: 1.5, people: 8 };
const WARMUP = 5;
const RUNS = 30;

/** Every task estimated, so the whole graph is on the calendar */
function estimated(project: ProjectDoc): ProjectDoc {
  const tasks = Object.fromEntries(
    Object.entries(project.tasks).map(([id, t]) => [id, t.kind === "task" && t.estimateDays === null ? { ...t, estimateDays: 2 } : t]),
  ) as ProjectDoc["tasks"];
  return { ...project, tasks };
}

function plansOf(state: FixtureState): ProjectPlan[] {
  return Object.values(state.projects).map((p) => {
    const plan = planProject(estimated(p), state.workspace, FIXTURE_TODAY);
    // Schedules and risks are measured elsewhere: compute them before timing
    void plan.schedule;
    void plan.risks;
    return plan;
  });
}

function single(n: number) {
  const state = generated(n, PERF_FIXTURE);
  const plans = plansOf(state);
  return { state, plan: plans[0], plans, scope: activeProject(state).id };
}

function many(tasksPerProject: number) {
  const state = multiProject({ projects: 10, tasksPerProject, ...PERF_FIXTURE });
  return { state, plans: plansOf(state) };
}

/** Median ms of `fn` over three rounds that alternate the two sizes, so a burst elsewhere hits both */
function compare(at150: () => unknown, at300: () => unknown) {
  const rounds = Array.from({ length: 3 }, () => [time(at150, { warmup: WARMUP, runs: RUNS }), time(at300, { warmup: WARMUP, runs: RUNS })] as const);
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[1];
  return { t150: median(rounds.map(([a]) => a.median)), t300: median(rounds.map(([, b]) => b.median)) };
}

const report = (label: string, t150: number, t300: number) =>
  console.info(`${label}: 150 median ${t150.toFixed(3)} ms, 300 median ${t300.toFixed(3)} ms; ratio ${(t300 / t150).toFixed(2)}`);

describe("team and focus perf", () => {
  it("computes weeklyLoad over 10 projects × 150 tasks in at most 15 ms", () => {
    const a = many(150);
    const b = many(300);
    const r = weeklyLoad(a.state.workspace, a.plans);
    // Every project counts and the team carries real load
    expect(r.people.size).toBeGreaterThan(4);
    const { t150, t300 } = compare(
      () => weeklyLoad(a.state.workspace, a.plans),
      () => weeklyLoad(b.state.workspace, b.plans),
    );
    report("weeklyLoad 10 projects", t150, t300);
    expect(t150).toBeLessThan(budget(15));
    expect(t300 / t150).toBeLessThan(3);
  });

  it("scores and ranks focus at 150 tasks in at most 2 ms", () => {
    const a = single(150);
    const b = single(300);
    expect(focus([a.plan], { today: FIXTURE_TODAY }).ranked.length).toBeGreaterThan(10);
    const { t150, t300 } = compare(
      () => focus([a.plan], { today: FIXTURE_TODAY }),
      () => focus([b.plan], { today: FIXTURE_TODAY }),
    );
    report("focus", t150, t300);
    expect(t150).toBeLessThan(budget(2));
    expect(t300 / t150).toBeLessThan(3);
  });

  it("balances 150 tasks in at most 5 ms", () => {
    const a = single(150);
    const b = single(300);
    // The generated team is over capacity, so balance has real work to do
    expect(balance(a.state.workspace, a.plans, a.scope).moves.length).toBeGreaterThan(0);
    const { t150, t300 } = compare(
      () => balance(a.state.workspace, a.plans, a.scope),
      () => balance(b.state.workspace, b.plans, b.scope),
    );
    report("balance", t150, t300);
    expect(t150).toBeLessThan(budget(5));
    expect(t300 / t150).toBeLessThan(3);
  });

  it("levels 150 tasks in at most 5 ms", () => {
    const a = single(150);
    const b = single(300);
    expect(level(a.state.workspace, a.plan).length).toBeGreaterThan(10);
    const { t150, t300 } = compare(
      () => level(a.state.workspace, a.plan),
      () => level(b.state.workspace, b.plan),
    );
    report("level", t150, t300);
    expect(t150).toBeLessThan(budget(5));
    expect(t300 / t150).toBeLessThan(3);
  });
});
