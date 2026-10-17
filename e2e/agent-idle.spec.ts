// The agent at rest (plan §9.1, AUDIT §11.2a): how much the fluid loop writes when nothing happens.
// Real time, real rAF (no fake clock), Chromium for the CDP main-thread figures.
//
// E2E_AGENT_EXPECT=settled (the default from the agent fix on, plan step 5) asserts the §9.1
// criteria: once the agent has settled, its SVG shows 0 mutations per second 1 s later in every
// idle state, with and without reduced motion; a pointer moving near it wakes it within 50 ms, and
// it settles again; a hidden tab writes nothing and resumes when shown.
// E2E_AGENT_EXPECT=record is for builds without the settling loop (v0 up to T; compare.mjs picks it
// per commit): the probe records v0's endless loop, about 3,000 attribute mutations per second
// (10 ellipses × 5 attributes × 60 fps) in every state, and asserts only that it sees it.
// Results go to agent-idle.json in the run's artifacts folder.
import { expect, test, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP_PATH, ARTIFACTS_DIR } from "./env";
import { prepare, type Seed } from "./settle";

const EXPECT = process.env.E2E_AGENT_EXPECT ?? "settled";
if (EXPECT !== "settled" && EXPECT !== "record") throw new Error(`E2E_AGENT_EXPECT is "settled" or "record", not "${EXPECT}"`);
const SETTLED = EXPECT === "settled";

/** Record mode: how long the agent gets before a window is measured (v0 never comes to rest). */
const REST_MS = 4000;
const WINDOW_MS = 2000;

/**
 * Settled mode: the longest the agent may take to settle after the app mounts. Its birth lasts
 * about 2.1 s, the breath 4 s more, its fade 0.8 s and the stillness check 0.5 s.
 */
const SETTLE_TIMEOUT_MS = 15_000;
/** A window with no agent mutation at all: the loop sleeps. */
const QUIET_MS = 500;
/** §9.1: the stillness is measured 1 s after settling. */
const AFTER_SETTLE_MS = 1000;

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
  /** Settled mode: from the app's mount to the first window without agent mutations, ms */
  settledAfterMs?: number;
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

/** Opens the app on real time; resolves once it has mounted. */
async function openReal(page: Page, seed: Seed, reducedMotion: boolean) {
  await prepare(page, seed);
  await page.addInitScript(countRaf);
  await page.emulateMedia({ reducedMotion: reducedMotion ? "reduce" : "no-preference" });
  await page.goto(APP_PATH, { waitUntil: "load" });
  await page.locator("main h1").waitFor({ state: "attached" });
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

/** Waits for the first window of QUIET_MS without an agent mutation; resolves to when it began (ms from `since`). */
async function untilSettled(page: Page, since = Date.now()): Promise<number> {
  while (Date.now() - since < SETTLE_TIMEOUT_MS) {
    const start = Date.now();
    if ((await measure(page, QUIET_MS)).mutationsPerSecond === 0) return start - since;
  }
  throw new Error(`The agent never settled within ${SETTLE_TIMEOUT_MS} ms`);
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

/** Simulates the tab being hidden or shown, the way the page sees it (see the hidden-tab test). */
async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate((hidden) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

// One worker, in order; a failing probe doesn't skip the others
test.describe.configure({ mode: "default" });

/** Adds a probe to agent-idle.json (one file per run; a worker restarted after a failure keeps it). */
function record(project: string, probe: Probe) {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const file = join(ARTIFACTS_DIR, "agent-idle.json");
  const prev = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : { project, expect: EXPECT, ...(SETTLED ? { afterSettleMs: AFTER_SETTLE_MS } : { restMs: REST_MS }), windowMs: WINDOW_MS, probes: [] };
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
    let settledAfterMs: number | undefined;
    if (SETTLED) {
      settledAfterMs = await untilSettled(page);
      await page.waitForTimeout(AFTER_SETTLE_MS);
    } else await page.waitForTimeout(REST_MS);
    const probe: Probe = { state: c.state, reducedMotion: c.reducedMotion, ...(settledAfterMs === undefined ? {} : { settledAfterMs }), ...(await measure(page)) };
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
// The tab is hidden 2 s after mount, while the agent still breathes, so the loop is running.
test("hidden tab (simulated)", async ({ page }, testInfo) => {
  await openReal(page, { doc: "docDemo" }, false);
  await page.waitForTimeout(SETTLED ? 2000 : REST_MS);
  if (SETTLED) expect((await measure(page, 300)).mutationsPerSecond, "the loop runs before the tab is hidden").toBeGreaterThan(0);
  await setHidden(page, true);
  await page.waitForTimeout(1000);
  const probe: Probe = { state: "demo project, tab hidden (simulated visibilitychange)", reducedMotion: false, hidden: true, ...(await measure(page)) };
  record(testInfo.project.name, probe);
  testInfo.annotations.push({ type: "agent", description: JSON.stringify(probe) });
  if (!SETTLED) {
    expect(probe.mutationsPerSecond, "v0 has no visibilitychange handling (AUDIT §11.2a)").toBeGreaterThan(0);
    return;
  }
  expect(probe.mutationsPerSecond, "§9.1: a hidden tab gives 0").toBe(0);
  // Shown again, the loop picks up where it stopped, then settles
  await setHidden(page, false);
  expect((await measure(page, 300)).mutationsPerSecond, "§9.1: the loop resumes when the tab is visible").toBeGreaterThan(0);
  await untilSettled(page);
});

// A pointer moving near the settled agent, but outside any control, wakes it: the ring is pulled
// toward the hand and the docked pill breathes again (Q29). With the pointer left there, the agent
// settles again: the ring where the hand's pull balances its springs.
const wakes: { state: string; seed: Seed; near: (page: Page) => Promise<{ x: number; y: number }> }[] = [
  {
    state: "idle ring",
    seed: {},
    near: async (page) => {
      // Left of the ring's hit area (radius 120 × scale), well inside the wake radius (330 × scale)
      const box = await page.getByRole("button", { name: "Open FORM — describe what you need" }).boundingBox();
      if (!box) throw new Error("No idle agent");
      return { x: box.x - box.width / 4, y: box.y + box.height / 2 };
    },
  },
  {
    state: "agent docked",
    seed: { doc: "docDemo" },
    near: async (page) => {
      const box = await page.getByRole("button", { name: /^Ask FORM/ }).boundingBox();
      if (!box) throw new Error("No docked agent");
      return { x: box.x + box.width / 2, y: box.y - 60 };
    },
  },
];

for (const w of wakes) {
  test(`a pointer near the settled agent wakes it: ${w.state}`, async ({ page }, testInfo) => {
    test.skip(!SETTLED, "v0 never sleeps; the wake criterion applies once the loop settles (§9.1)");
    await openReal(page, w.seed, false);
    const at = await w.near(page);
    await untilSettled(page);
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
    await page.mouse.move(at.x, at.y);
    const ms = await woke;
    // §9.1: the loop resumes within one frame of a pointer moving near the agent
    expect(ms).toBeLessThan(50);
    // …and once the pointer rests, the agent settles again
    const settledAgainMs = await untilSettled(page);
    testInfo.annotations.push({ type: "agent", description: JSON.stringify({ state: w.state, wokeAfterMs: Math.round(ms * 10) / 10, settledAgainMs }) });
  });
}
