// Budget of the fast parser (plan §10.7): fastParse ≤ 1 ms per command at 150 tasks, with the
// growth guard t(300) / t(150) < 3.
//
// Every command of the golden corpus is parsed on a generated project (generated(…, { stepsPerTask:
// 3, predsMean: 1.5, people: 8 }), the demo's views and a selected task), so each family runs,
// matching or not, over 150 titles and their 450 steps. The plans balance reads are memoised by
// document identity, as in the store, and warmed before timing. The budget holds for the slowest
// command (median of its samples), not for the average.
import { describe, expect, it } from "vitest";
import { breakdownFor } from "@/lib/demo/library";
import { addSampleTeam, createDemoProject } from "@/lib/demo/seed";
import { seededMinter } from "@/lib/domain/ids";
import { sortedByOrder } from "@/lib/domain/order";
import { type FastContext, fastParse, paletteKey } from "@/lib/interpret/fast";
import { paletteEntries } from "@/lib/ops/palette";
import { activeProject, FIXTURE_TODAY, generated } from "../fixtures/v2/build";
import { CORPUS } from "../golden/corpus";
import { budget, time } from "./timing";

const PALETTE = new Set(paletteEntries().map((e) => paletteKey(e.phrase)));
const COMMANDS = [...new Set(CORPUS.map((c) => c.say))];
/** Parses per timed sample: one takes a few microseconds, near the timer's resolution */
const BATCH = 10;

function contextFor(n: number): FastContext {
  const state = generated(n, { stepsPerTask: 3, predsMean: 1.5, people: 8 });
  const project = activeProject(state);
  const selected = sortedByOrder(project.tasks)[Math.floor(n / 2)];
  return {
    ws: state.workspace,
    project,
    projects: [project],
    local: { activeView: "cards", selectedTaskId: selected.id, timelineZoom: "day" },
    selectedTaskId: selected.id,
    mint: seededMinter(n),
    today: FIXTURE_TODAY,
    palette: PALETTE,
    breakdown: breakdownFor,
    demo: { createProject: createDemoProject, sampleTeam: addSampleTeam },
  };
}

/** The slowest command's median time per parse, in milliseconds */
function slowest(ctx: FastContext): { say: string; ms: number } {
  let worst = { say: "", ms: 0 };
  for (const say of COMMANDS) {
    const t = time(
      () => {
        for (let i = 0; i < BATCH; i++) fastParse(say, ctx);
      },
      { warmup: 2, runs: 9 },
    );
    const ms = t.median / BATCH;
    if (ms > worst.ms) worst = { say, ms };
  }
  return worst;
}

describe("fastParse", () => {
  const at150 = contextFor(150);
  const at300 = contextFor(300);

  it("parses every corpus command in ≤ 1 ms at 150 tasks", () => {
    const worst = slowest(at150);
    console.info(`fastParse: ${COMMANDS.length} commands at 150 tasks, slowest "${worst.say}" median ${(worst.ms * 1000).toFixed(1)} µs`);
    expect(worst.ms, `slowest: "${worst.say}" at ${worst.ms.toFixed(3)} ms`).toBeLessThanOrEqual(budget(1));
  });

  it("grows less than 3× from 150 to 300 tasks", () => {
    const a = slowest(at150);
    const b = slowest(at300);
    // Microsecond timings are noisy: compare the slowest commands with a floor of 0.05 ms
    expect(Math.max(b.ms, 0.05) / Math.max(a.ms, 0.05), `150: ${a.ms.toFixed(3)} ms ("${a.say}"), 300: ${b.ms.toFixed(3)} ms ("${b.say}")`).toBeLessThan(3);
  });
});
