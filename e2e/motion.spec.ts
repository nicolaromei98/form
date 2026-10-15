// Clock-stepped motion frames (plan §10.8 "Motion"): Chromium, full motion. Each trigger is
// captured at 0, 120, 240, 480, 900 and 1,750 ms with JS timers, rAF, Motion, GSAP and every Web
// Animation on the same fake clock. A candidate may differ from its reference by ≤ 0.1% per frame,
// outside the masks of the expected differences the trigger shows (e2e/expected.ts). On a build
// with the store handle (v2), the test also asserts the fx kinds and phases the trigger produces:
// the create phase ends within CREATE_TOTAL_MS ± 100 ms, tab switches shift, undo restores.
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { CREATE_TOTAL_MS } from "@/lib/motion";
import { ENGINE } from "./env";
import { COUNTER, ENGINE_LABEL, FOCUS_WHY, HISTORY, PLAN_FIGURES, TEAM_LANES, TIMELINE_CHART, TIMELINE_FOOTER } from "./expected";
import { captureFrames } from "./frames";
import type { Mask } from "./gate";
import { open } from "./settle";

test.use({ reducedMotion: "no-preference" });

/** ED-6: the caption's wording comes from the ops that applied (plan §5.9) */
const CAPTION: Mask = { ed: "ED-6", what: "caption", target: (p) => p.getByRole("status") };
/** ED-4: Focus's decision stack, whose shorter why moves the title and the next step as it builds */
const FOCUS_STACK: Mask = { ...FOCUS_WHY, what: "focus decision stack (its why is shorter)", target: (p) => p.locator('section[aria-label="Focus"]') };
/** A tab switch: Undo and the counter (ED-11, ED-7) */
const TAB = [...HISTORY, COUNTER];

interface Step {
  t: number;
  phase: string;
  fx: string;
  seq: number;
}

/** Records the store's phase and fx on every change (v2 builds have the handle) */
async function watchStore(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __form?: { getState(): { phase: string; fx: { kind: string; seq: number } }; subscribe(fn: (s: { phase: string; fx: { kind: string; seq: number } }) => void): () => void }; __steps?: Step[] };
    w.__steps = [];
    w.__form?.subscribe((s) => {
      const last = w.__steps!.at(-1);
      if (last && last.phase === s.phase && last.fx === s.fx.kind && last.seq === s.fx.seq) return;
      w.__steps!.push({ t: performance.now(), phase: s.phase, fx: s.fx.kind, seq: s.fx.seq });
    });
  });
}

const steps = (page: Page) => page.evaluate(() => (window as unknown as { __steps?: Step[] }).__steps ?? []);

/** Frames of one trigger, then the failures of every frame at once */
async function frames(page: Page, testInfo: TestInfo, name: string, trigger: () => Promise<void>, opts: { keepPointer?: boolean; masks?: Mask[] } = {}) {
  if (ENGINE === "v2") await watchStore(page);
  const failed = await captureFrames(page, testInfo, name, trigger, { ...opts, masks: [ENGINE_LABEL, ...(opts.masks ?? [])] });
  const seen = ENGINE === "v2" ? await steps(page) : [];
  if (seen.length) testInfo.annotations.push({ type: `${name} store`, description: seen.map((s) => `${Math.round(s.t)}ms ${s.phase}/${s.fx}#${s.seq}`).join(" → ") });
  return { failed, seen };
}

test("agent: hover, press, input, then processing and emit as a timeline is created", async ({ page }, testInfo) => {
  const app = await open(page, {});
  const hit = await page.getByRole("button", { name: "Open FORM — describe what you need" }).boundingBox();
  if (!hit) throw new Error("No agent hit area");
  const centre = { x: hit.x + hit.width / 2, y: hit.y + hit.height / 2 };

  const failed: string[] = [];
  failed.push(...(await frames(page, testInfo, "agent-hover", () => page.mouse.move(centre.x, centre.y), { keepPointer: true })).failed);
  failed.push(...(await frames(page, testInfo, "agent-press", () => page.mouse.down(), { keepPointer: true })).failed);
  failed.push(...(await frames(page, testInfo, "agent-input", () => page.mouse.up())).failed);
  const input = page.getByRole("textbox", { name: "Command" });
  await input.fill("Create a timeline for my project");
  const created = await frames(page, testInfo, "create-from-empty", () => input.press("Enter"), { masks: [TIMELINE_CHART, TIMELINE_FOOTER, CAPTION] });
  failed.push(...created.failed);
  await app.settle();
  if (ENGINE === "v2") {
    // processing (the 340 ms beat), then creating with a "create" fx, then rest once the choreography ends
    const all = [...created.seen, ...(await steps(page))];
    const creating = all.find((s) => s.phase === "creating");
    const rest = creating && all.find((s) => s.t > creating.t && s.phase === "rest");
    expect(all.some((s) => s.phase === "processing"), "the processing beat").toBe(true);
    expect(creating?.fx, "creation is a create fx").toBe("create");
    expect(rest, "the create phase ends").toBeTruthy();
    expect(Math.abs(rest!.t - creating!.t - CREATE_TOTAL_MS), `the create phase lasts CREATE_TOTAL_MS (${CREATE_TOTAL_MS} ms) ± 100 ms`).toBeLessThanOrEqual(100);
  }
  expect(failed).toEqual([]);
});

test("add a view: the + Timeline node on a new tracker", async ({ page }, testInfo) => {
  await open(page, { doc: "docTracker" });
  const { failed } = await frames(page, testInfo, "add-view", () => page.getByRole("button", { name: "Add the Timeline view" }).click(), { masks: [TIMELINE_CHART, TIMELINE_FOOTER, CAPTION] });
  expect(failed).toEqual([]);
});

test("tracker → board morph", async ({ page }, testInfo) => {
  await open(page, { doc: "docDemo" });
  const { failed, seen } = await frames(page, testInfo, "tracker-board-morph", () => page.locator('[data-rep-tab="board"]').click(), { masks: TAB });
  if (ENGINE === "v2") expect(seen.map((s) => s.fx), "a tab switch is a shift").toContain("shift");
  expect(failed).toEqual([]);
});

test("compact toggle", async ({ page }, testInfo) => {
  await open(page, { doc: "docDemo" });
  const { failed } = await frames(page, testInfo, "compact-toggle", () => page.getByRole("switch", { name: "Compact" }).click());
  expect(failed).toEqual([]);
});

test("focus enter", async ({ page }, testInfo) => {
  await open(page, { doc: "docDemo" });
  const { failed, seen } = await frames(page, testInfo, "focus-enter", () => page.locator('[data-rep-tab="focus"]').click(), { masks: [...TAB, FOCUS_STACK] });
  if (ENGINE === "v2") expect(seen.map((s) => s.fx), "a tab switch is a shift").toContain("shift");
  expect(failed).toEqual([]);
});

test("team handover", async ({ page }, testInfo) => {
  await open(page, { doc: "docDemo" });
  const { failed } = await frames(page, testInfo, "team-handover", () => page.locator('[data-rep-tab="team"]').click(), { masks: [...TAB, ...TEAM_LANES] });
  expect(failed).toEqual([]);
});

test("caption: accepting the balance", async ({ page }, testInfo) => {
  const app = await open(page, { doc: "docDemo" });
  await app.tab("team");
  await app.command("Balance the workload");
  const { failed } = await frames(page, testInfo, "caption", () => page.getByRole("button", { name: /^Accept/ }).first().click(), {
    masks: [COUNTER, ...TEAM_LANES, PLAN_FIGURES, CAPTION],
  });
  if (ENGINE === "v2") {
    // ED-6: the accept caption is composed from the ops that applied, on the weekly figures (ED-3)
    const caption = await page.getByRole("status").locator("[aria-label]").first().getAttribute("aria-label");
    testInfo.annotations.push({ type: "caption", description: caption ?? "" });
    expect(caption, "ED-6: the accept caption").toBe("UI Design → Sara");
    // Undo hands the documents back with a restore fx
    await page.keyboard.press("ControlOrMeta+z");
    await app.settle();
    expect((await steps(page)).at(-1)?.fx, "undo restores").toBe("restore");
  }
  expect(failed).toEqual([]);
});

test("agent processing at the dock", async ({ page }, testInfo) => {
  const app = await open(page, { doc: "docDemo" });
  await page.keyboard.press("/");
  await app.settle();
  const input = page.getByRole("textbox", { name: "Command" });
  await input.fill("Make the cards more compact");
  const { failed } = await frames(page, testInfo, "agent-processing", () => input.press("Enter"));
  expect(failed).toEqual([]);
});
