// The planning engine, Focus and the brief composer at 150 tasks, measured in the browser (plan
// §11 step 19: < 8 ms at 4× CPU). scripts/e2e/perf-bundle.mjs bundles this file with the engine's
// own sources and minifies it with Next's SWC minifier, as the production build ships them;
// e2e/perf.spec.ts loads it into a page with Chromium's CPU throttled 4× and calls `__bench.run()`.
//
// The fixture and the cases mirror test/perf (planning.perf, compose.perf): generated(150,
// { stepsPerTask: 3, predsMean: 1.5, people: 8 }) and the variant with every estimate set, and
// "cold" means a project version no memo has seen (a new tasks record), as after an edit.
import { composeBrief, type BriefInput } from "@/lib/compose/brief";
import type { Audience, ProjectDoc } from "@/lib/domain/schema";
import { laneLoads, planProject, weeklyLoad } from "@/lib/planning";
import { activeProject, FIXTURE_TODAY, type FixtureState, generated } from "../../test/fixtures/v2/build";

const PERF_FIXTURE = { stepsPerTask: 3, predsMean: 1.5, people: 8, briefLines: 20 };

export interface CaseResult {
  name: string;
  /** ms per call: median and 95th percentile of the timed samples */
  median: number;
  p95: number;
  samples: number;
}

/** Every missing estimate set to 2 days, so every task gets dates (planning.perf's honest variant) */
function estimated(state: FixtureState): FixtureState {
  const project = activeProject(state);
  const tasks = Object.fromEntries(
    Object.entries(project.tasks).map(([id, t]) => [id, t.kind === "task" && t.estimateDays === null ? { ...t, estimateDays: 2 } : t]),
  ) as ProjectDoc["tasks"];
  return { ...state, projects: { ...state.projects, [project.id]: { ...project, tasks } } };
}

/** A version of the project no memo has seen */
const fresh = (project: ProjectDoc): ProjectDoc => ({ ...project, tasks: { ...project.tasks } });

/**
 * Times `fn` per call: `batch` calls per sample, so a sample is well above the browser's timer
 * resolution (100 µs without cross-origin isolation). `prepare` builds each sample's inputs untimed.
 */
function measure<T>(name: string, prepare: () => T, fn: (input: T) => unknown, { warmup = 5, runs = 30, batch = 5 } = {}): CaseResult {
  const sample = () => {
    const inputs = Array.from({ length: batch }, prepare);
    const start = performance.now();
    for (const input of inputs) fn(input);
    return (performance.now() - start) / batch;
  };
  for (let i = 0; i < warmup; i++) sample();
  const samples = Array.from({ length: runs }, sample).sort((a, b) => a - b);
  const at = (q: number) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))];
  return { name, median: at(0.5), p95: at(0.95), samples: runs };
}

function briefInput(project: ProjectDoc, state: FixtureState, audience: Audience): BriefInput {
  const plan = planProject(project, state.workspace, FIXTURE_TODAY);
  void plan.schedule;
  void plan.risks;
  void plan.metrics;
  void plan.focus;
  const lanes = laneLoads(plan, weeklyLoad(state.workspace, [plan]), state.workspace);
  return { plan, ws: state.workspace, audience, short: false, today: FIXTURE_TODAY, lanes };
}

/** The project with an edit (a rewrite) on every line FORM composes, so the edits path runs too */
function withEdits(state: FixtureState): ProjectDoc {
  const project = activeProject(state);
  const edits: ProjectDoc["brief"]["edits"] = {};
  for (const a of ["client", "team"] as const) {
    const brief = composeBrief(briefInput(project, state, a))!;
    for (const line of [...brief.headline, ...brief.sections.flatMap((s) => s.lines)]) {
      if (line.kind === "composed") edits[line.key] = { text: `Rewritten: ${line.composed.slice(0, 40)}`, basis: line.composed };
    }
  }
  return { ...project, brief: { ...project.brief, edits } };
}

export function run(): { tasks: number; scheduled: Record<string, number>; cases: CaseResult[] } {
  const plain = generated(150, PERF_FIXTURE);
  const full = estimated(plain);
  const ws = plain.workspace;
  const cases: CaseResult[] = [];
  const placed = (state: FixtureState) =>
    [...planProject(activeProject(state), state.workspace, FIXTURE_TODAY).schedule.timings.values()].filter((t) => t.kind === "scheduled").length;

  for (const [label, state] of [
    ["plan's fixture", plain],
    ["every estimate set", full],
  ] as const) {
    const project = activeProject(state);
    // Planning: schedule, risks and metrics of a version no memo has seen
    cases.push(
      measure(`planning (schedule + risks + metrics), cold, ${label}`, () => fresh(project), (p) => {
        const plan = planProject(p, ws, FIXTURE_TODAY);
        return [plan.schedule.end, plan.risks.byTask.size, plan.metrics.count];
      }),
    );
    // Focus alone: the plan's other stages already computed, as when the Focus view reads it
    cases.push(
      measure(
        `focus, ${label}`,
        () => {
          const plan = planProject(fresh(project), ws, FIXTURE_TODAY);
          void plan.schedule;
          void plan.risks;
          void plan.metrics;
          return plan;
        },
        (plan) => plan.focus.ranked.length,
      ),
    );
    // The whole cold path behind the Focus view after an edit
    cases.push(measure(`plan + focus, cold, ${label}`, () => fresh(project), (p) => planProject(p, ws, FIXTURE_TODAY).focus.ranked.length));
  }

  // Brief: the composer on a computed plan and Team lanes, every line edited; then the whole cold
  // path behind the brief view after an edit (plan, lanes, composer)
  const edited = withEdits(plain);
  const editedState = { ...plain, projects: { ...plain.projects, [edited.id]: edited } };
  for (const audience of ["client", "team"] as const) {
    const input = briefInput(edited, editedState, audience);
    cases.push(measure(`brief (${audience}), composer`, () => input, (i) => composeBrief(i)));
  }
  cases.push(
    measure(`plan + lanes + brief (team), cold`, () => fresh(edited), (p) => {
      const plan = planProject(p, ws, FIXTURE_TODAY);
      const lanes = laneLoads(plan, weeklyLoad(ws, [plan]), ws);
      return composeBrief({ plan, ws, audience: "team", short: false, today: FIXTURE_TODAY, lanes });
    }),
  );
  return { tasks: Object.keys(activeProject(plain).tasks).length, scheduled: { "plan's fixture": placed(plain), "every estimate set": placed(full) }, cases };
}
