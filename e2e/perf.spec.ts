// Planning, Focus and the brief at 150 tasks in the browser, with the CPU throttled 4× (plan §11
// step 19: < 8 ms; the mid-range phone profile of DECISIONS Q23). The engine runs as /demo ships it:
// scripts/e2e/perf-bundle.mjs bundles e2e/perf/bench.ts with the engine's sources and minifies it
// with Next's SWC minifier. The served build is not involved, so this spec runs once per run
// (Chromium, desktop project) and only on a v2 build; results go to <artifacts>/perf.json.
import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ARTIFACTS_DIR, ENGINE, OUT_DIR, REPO } from "./env";
import type { CaseResult } from "./perf/bench";

/** Plan §11 step 19 */
const BUDGET_MS = 8;
const THROTTLE = 4;

test.skip(ENGINE !== "v2", "The v0 build has no v2 engine to measure");

test("planning, focus and brief at 150 tasks under 8 ms at 4× CPU", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "CPU throttling is a Chromium (CDP) feature; measured once per run");
  const file = join(OUT_DIR, "perf", "bench.js");
  const built = spawnSync(process.execPath, [join(REPO, "scripts/e2e/perf-bundle.mjs"), file], { cwd: REPO, encoding: "utf8" });
  if (built.status !== 0) throw new Error(`perf-bundle.mjs failed:\n${built.stdout}${built.stderr}`);

  await page.setContent("<!doctype html><html><head><meta charset=utf-8></head><body></body></html>");
  await page.addScriptTag({ content: readFileSync(file, "utf8") });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  const result = await page.evaluate(() => (window as unknown as { __bench: { run: () => { tasks: number; scheduled: Record<string, number>; cases: CaseResult[] } } }).__bench.run());
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });

  const report = { throttle: THROTTLE, budgetMs: BUDGET_MS, browser: page.context().browser()?.version(), ...result };
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  writeFileSync(join(ARTIFACTS_DIR, "perf.json"), JSON.stringify(report, null, 2) + "\n");
  for (const c of result.cases) testInfo.annotations.push({ type: "perf", description: `${c.name}: median ${c.median.toFixed(2)} ms, p95 ${c.p95.toFixed(2)} ms` });

  expect(result.tasks).toBe(150);
  for (const c of result.cases) {
    expect(c.median, `${c.name}: median at ${THROTTLE}× CPU`).toBeLessThan(BUDGET_MS);
    expect(c.p95, `${c.name}: 95th percentile at ${THROTTLE}× CPU`).toBeLessThan(BUDGET_MS);
  }
});
