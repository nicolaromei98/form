// Budget of the brief composer (plan §6.8, §10.7): composeBrief ≤ 4 ms at 150 tasks, with the
// growth guard t(300) / t(150) < 3. v0 took about 300 ms at 150 tasks (audit §1 item 13).
//
// Fixtures are generated(…, { stepsPerTask: 3, predsMean: 1.5, people: 8 }) with 20 added lines and
// an edit on every composed line, so the edits path runs for every sentence. The plan's stages
// (schedule, risks, metrics, focus) and the Team lanes are computed before timing: they are
// measured in planning.perf and team.perf, and the composer reads them from the memoised plan.
// Each timed call composes the whole brief from scratch.
import { describe, expect, it } from "vitest";
import { composeBrief, type BriefInput } from "@/lib/compose/brief";
import type { Audience, ProjectDoc, WorkspaceDoc } from "@/lib/domain/schema";
import { laneLoads, planProject, weeklyLoad } from "@/lib/planning";
import { activeProject, FIXTURE_TODAY, generated } from "../fixtures/v2/build";
import { budget, time } from "./timing";

const PERF_FIXTURE = { stepsPerTask: 3, predsMean: 1.5, people: 8, briefLines: 20 };
const WARMUP = 5;
const RUNS = 30;
/** Compositions per timed sample: one takes well under a tenth of a millisecond, near the timer's resolution */
const BATCH = 10;

interface Fixture {
  input: BriefInput;
  project: ProjectDoc;
  ws: WorkspaceDoc;
}

function inputOf(project: ProjectDoc, ws: WorkspaceDoc, audience: Audience, short: boolean): BriefInput {
  const plan = planProject(project, ws, FIXTURE_TODAY);
  // Warm the plan's stages, so the timing is the composer's own
  void plan.schedule;
  void plan.risks;
  void plan.metrics;
  void plan.focus;
  const lanes = laneLoads(plan, weeklyLoad(ws, [plan]), ws);
  return { plan, ws, audience, short, today: FIXTURE_TODAY, lanes };
}

/** A generated project, with an edit (a rewrite) on every line FORM composes for both audiences */
function fixture(n: number, audience: Audience, short: boolean): Fixture {
  const state = generated(n, PERF_FIXTURE);
  const ws = state.workspace;
  let project = activeProject(state);
  const edits: ProjectDoc["brief"]["edits"] = {};
  for (const a of ["client", "team"] as const) {
    const brief = composeBrief(inputOf(project, ws, a, false))!;
    for (const line of [...brief.headline, ...brief.sections.flatMap((s) => s.lines)]) {
      if (line.kind === "composed") edits[line.key] = { text: `Rewritten: ${line.composed.slice(0, 40)}`, basis: line.composed };
    }
  }
  project = { ...project, brief: { ...project.brief, edits } };
  return { input: inputOf(project, ws, audience, short), project, ws };
}

/** `fn` BATCH times in a row */
const batched = (fn: () => unknown) => () => {
  for (let i = 0; i < BATCH; i++) fn();
};

/**
 * Median ms per call of `fn` over three rounds that alternate the two sizes, so a burst elsewhere
 * hits both
 */
function compare(at150: () => unknown, at300: () => unknown) {
  const opts = { warmup: WARMUP, runs: RUNS };
  const rounds = Array.from({ length: 3 }, () => [time(batched(at150), opts), time(batched(at300), opts)] as const);
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[1] / BATCH;
  return { t150: median(rounds.map(([a]) => a.median)), t300: median(rounds.map(([, b]) => b.median)) };
}

const report = (label: string, t150: number, t300: number) =>
  console.info(`${label}: 150 median ${t150.toFixed(3)} ms, 300 median ${t300.toFixed(3)} ms; ratio ${(t300 / t150).toFixed(2)}`);

describe("brief perf", () => {
  it.each([
    ["team", false],
    ["client", false],
    ["team", true],
  ] as const)("composes the %s brief (short: %s) at 150 tasks in at most 4 ms", (audience, short) => {
    const a = fixture(150, audience, short).input;
    const b = fixture(300, audience, short).input;
    // Real work: many sentences, every one of them edited
    const brief = composeBrief(a)!;
    const lines = brief.sections.flatMap((s) => s.lines);
    expect(lines.length).toBeGreaterThan(short ? 8 : 20);
    expect(lines.filter((l) => l.edited !== null).length).toBeGreaterThan(short ? 4 : 10);

    const { t150, t300 } = compare(
      () => composeBrief(a),
      () => composeBrief(b),
    );
    report(`composeBrief ${audience}${short ? " short" : ""}`, t150, t300);
    expect(t150).toBeLessThan(budget(4));
    expect(t300 / t150).toBeLessThan(3);
  });

  // What an edit costs the brief view end to end: a new tasks record, so every stage recomputes.
  // Step 19 measures the same path in the browser (< 8 ms at 4× CPU); here it is reported, and held
  // to the sum of the cold plan's and the composer's budgets.
  it("reports the cold path: plan, Team lanes and the team brief after an edit", () => {
    const at = (n: number) => {
      const { project, ws } = fixture(n, "team", false);
      return () => {
        const edited = { ...project, tasks: { ...project.tasks } };
        const fresh = planProject(edited, ws, FIXTURE_TODAY);
        const lanes = laneLoads(fresh, weeklyLoad(ws, [fresh]), ws);
        return composeBrief({ plan: fresh, ws, audience: "team", short: false, today: FIXTURE_TODAY, lanes });
      };
    };
    const { t150, t300 } = compare(at(150), at(300));
    report("plan + lanes + composeBrief, cold", t150, t300);
    expect(t150).toBeLessThan(budget(8 + 4));
  });
});
