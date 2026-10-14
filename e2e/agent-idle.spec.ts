// The agent at rest (plan §9.1, AUDIT §11.2a): how much the fluid loop writes when nothing happens.
// Real time, real rAF (no fake clock), Chromium for the CDP main-thread figures.
//
// By default the probe records: v0's loop never stops, so baseline A shows about 3,000 attribute
// mutations per second (10 ellipses × 5 attributes × 60 fps) in every state. Results go to
// agent-idle.json in the run's artifacts folder.
// With E2E_AGENT_EXPECT=settled the §9.1 criteria are asserted instead (step 5's settling loop).
import { expect, test, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP_PATH, ARTIFACTS_DIR } from "./env";
import { prepare, type Seed } from "./settle";

const SETTLED = process.env.E2E_AGENT_EXPECT === "settled";

/** How long the agent gets to come to rest before a window is measured (§9.1: 1 s after settling). */
const REST_MS = 4000;
const WINDOW_MS = 2000;

interface Rates {
  /** Attribute (and child) mutations inside the agent SVG, per second */
  mutationsPerSecond: number;
  /** App requestAnimationFrame callbacks per second */
  rafPerSecond: number;
}

interface Probe extends Rates {
  state: string;
  reducedMotion: boolean;
  hidden?: boolean;
  /** Renderer main thread, ms per second (CDP Performance metrics) */
  mainThreadMsPerSecond?: { task: number; script: number; layout: number; style: number };
}

/** Counts every rAF callback the page schedules (installed before any page script). */
function countRaf() {
  const w = window as unknown as { __rafCalls: number };
  w.__rafCalls = 0;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      w.__rafCalls++;
      cb(t);
    });
}

async function openReal(page: Page, seed: Seed, reducedMotion: boolean) {
  await prepare(page, seed);
  await page.addInitScript(countRaf);
  await page.emulateMedia({ reducedMotion: reducedMotion ? "reduce" : "no-preference" });
  await page.goto(APP_PATH, { waitUntil: "load" });
  await page.locator("main h1").waitFor({ state: "attached" });
  await page.waitForTimeout(REST_MS);
}

/** Mutations and rAF callbacks over `ms` of real time. */
async function measure(page: Page, ms = WINDOW_MS): Promise<Rates> {
  return page.evaluate(
    (ms) =>
      new Promise<Rates>((resolve) => {
        const svg = [...document.querySelectorAll("svg")].find((s) => s.querySelector("filter#form-goo"));
        if (!svg) throw new Error("No agent SVG");
        let n = 0;
        const mo = new MutationObserver((records) => (n += records.length));
        mo.observe(svg, { attributes: true, childList: true, characterData: true, subtree: true });
        const w = window as unknown as { __rafCalls: number };
        const r0 = w.__rafCalls;
        const t0 = performance.now();
        setTimeout(() => {
          mo.disconnect();
          const s = (performance.now() - t0) / 1000;
          resolve({ mutationsPerSecond: Math.round(n / s), rafPerSecond: Math.round((w.__rafCalls - r0) / s) });
        }, ms);
      }),
    ms,
  );
}

async function mainThread(page: Page, ms = 5000) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const read = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const a = await read();
  await page.waitForTimeout(ms);
  const b = await read();
  const secs = b.Timestamp - a.Timestamp;
  const per = (k: string) => Math.round(((b[k] - a[k]) * 1000 * 10) / secs) / 10;
  return { task: per("TaskDuration"), script: per("ScriptDuration"), layout: per("LayoutDuration"), style: per("RecalcStyleDuration") };
}

// One worker, in order; a failing probe doesn't skip the others
test.describe.configure({ mode: "default" });

/** Adds a probe to agent-idle.json (one file per run; a worker restarted after a failure keeps it). */
function record(project: string, probe: Probe) {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const file = join(ARTIFACTS_DIR, "agent-idle.json");
  const prev = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { project, restMs: REST_MS, windowMs: WINDOW_MS, probes: [] };
  prev.probes.push(probe);
  writeFileSync(file, JSON.stringify(prev, null, 2) + "\n");
}

const cases: { state: string; seed: Seed; reducedMotion: boolean; cdp?: boolean }[] = [
  { state: "empty workspace, idle ring", seed: {}, reducedMotion: false },
  { state: "empty workspace, idle ring", seed: {}, reducedMotion: true },
  { state: "demo project, agent docked", seed: { doc: "docDemo" }, reducedMotion: false },
  { state: "60-task tracker, agent docked", seed: { doc: "doc60" }, reducedMotion: false, cdp: true },
  { state: "60-task tracker, agent docked", seed: { doc: "doc60" }, reducedMotion: true },
];

for (const c of cases) {
  test(`${c.state}${c.reducedMotion ? ", reduced motion" : ""}`, async ({ page }, testInfo) => {
    await openReal(page, c.seed, c.reducedMotion);
    const probe: Probe = { state: c.state, reducedMotion: c.reducedMotion, ...(await measure(page)) };
    if (c.cdp) probe.mainThreadMsPerSecond = await mainThread(page);
    record(testInfo.project.name, probe);
    testInfo.annotations.push({ type: "agent", description: JSON.stringify(probe) });
    if (SETTLED) expect(probe.mutationsPerSecond, "§9.1: the agent SVG is still 1 s after settling").toBe(0);
    else expect(probe.mutationsPerSecond, "the probe sees the agent's loop").toBeGreaterThan(0);
  });
}

// Headless Chromium keeps every tab visible (bringToFront changes nothing), so the hidden state is
// simulated the way the page sees it: visibilityState "hidden" and a visibilitychange event. That
// tests the app's own reaction (§9.1: the loop stops on visibilitychange); it can't show the
// browser suspending rAF in a real background tab, which the Phase 0 audit measured (0 per second).
test("hidden tab (simulated)", async ({ page }, testInfo) => {
  await openReal(page, { doc: "docDemo" }, false);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(1000);
  const probe: Probe = { state: "demo project, tab hidden (simulated visibilitychange)", reducedMotion: false, hidden: true, ...(await measure(page)) };
  record(testInfo.project.name, probe);
  testInfo.annotations.push({ type: "agent", description: JSON.stringify(probe) });
  if (SETTLED) expect(probe.mutationsPerSecond, "§9.1: a hidden tab gives 0").toBe(0);
  else expect(probe.mutationsPerSecond, "v0 has no visibilitychange handling (AUDIT §11.2a)").toBeGreaterThan(0);
});

test("a pointer near the settled agent wakes it", async ({ page }) => {
  test.skip(!SETTLED, "v0 never sleeps; the wake criterion applies once the loop settles (§9.1)");
  await openReal(page, { doc: "docDemo" }, false);
  const box = await page.getByRole("button", { name: /^Ask FORM/ }).boundingBox();
  if (!box) throw new Error("No docked agent");
  expect((await measure(page, 500)).mutationsPerSecond).toBe(0);
  // Time from the pointer event to the agent's first write
  const woke = page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const svg = [...document.querySelectorAll("svg")].find((s) => s.querySelector("filter#form-goo"))!;
        let moved = 0;
        window.addEventListener("pointermove", () => (moved ||= performance.now()), { capture: true });
        const mo = new MutationObserver(() => {
          if (!moved) return;
          mo.disconnect();
          resolve(performance.now() - moved);
        });
        mo.observe(svg, { attributes: true, subtree: true });
      }),
  );
  await page.mouse.move(box.x + box.width / 2, box.y - 60);
  // §9.1: the loop resumes within one frame of a pointer moving near the agent
  expect(await woke).toBeLessThan(50);
});
