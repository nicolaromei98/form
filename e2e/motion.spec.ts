// Clock-stepped motion frames (plan §10.8 "Motion"): Chromium, full motion. Each trigger is
// captured at 0, 120, 240, 480, 900 and 1,750 ms with JS timers, rAF, Motion, GSAP and every Web
// Animation on the same fake clock. A candidate may differ from its reference by ≤ 0.1% per frame.
import { test } from "@playwright/test";
import { captureFrames } from "./frames";
import { open } from "./settle";

test.use({ reducedMotion: "no-preference" });

test("agent: hover, press, input, then processing and emit as a timeline is created", async ({ page }) => {
  const app = await open(page, {});
  const hit = await page.getByRole("button", { name: "Open FORM — describe what you need" }).boundingBox();
  if (!hit) throw new Error("No agent hit area");
  const centre = { x: hit.x + hit.width / 2, y: hit.y + hit.height / 2 };

  await captureFrames(page, "agent-hover", () => page.mouse.move(centre.x, centre.y), { keepPointer: true });
  await captureFrames(page, "agent-press", () => page.mouse.down(), { keepPointer: true });
  await captureFrames(page, "agent-input", () => page.mouse.up());
  const input = page.getByRole("textbox", { name: "Command" });
  await input.fill("Create a timeline for my project");
  await captureFrames(page, "create-from-empty", () => input.press("Enter"));
  await app.settle();
});

test("add a view: the + Timeline node on a new tracker", async ({ page }) => {
  await open(page, { doc: "docTracker" });
  await captureFrames(page, "add-view", () => page.getByRole("button", { name: "Add the Timeline view" }).click());
});

test("tracker → board morph", async ({ page }) => {
  await open(page, { doc: "docDemo" });
  await captureFrames(page, "tracker-board-morph", () => page.locator('[data-rep-tab="board"]').click());
});

test("compact toggle", async ({ page }) => {
  await open(page, { doc: "docDemo" });
  await captureFrames(page, "compact-toggle", () => page.getByRole("switch", { name: "Compact" }).click());
});

test("focus enter", async ({ page }) => {
  await open(page, { doc: "docDemo" });
  await captureFrames(page, "focus-enter", () => page.locator('[data-rep-tab="focus"]').click());
});

test("team handover", async ({ page }) => {
  await open(page, { doc: "docDemo" });
  await captureFrames(page, "team-handover", () => page.locator('[data-rep-tab="team"]').click());
});

test("caption: accepting the balance", async ({ page }) => {
  const app = await open(page, { doc: "docDemo" });
  await app.tab("team");
  await app.command("Balance the workload");
  await captureFrames(page, "caption", () => page.getByRole("button", { name: /^Accept/ }).first().click());
});

test("agent processing at the dock", async ({ page }) => {
  const app = await open(page, { doc: "docDemo" });
  await page.keyboard.press("/");
  await app.settle();
  const input = page.getByRole("textbox", { name: "Command" });
  await input.fill("Make the cards more compact");
  await captureFrames(page, "agent-processing", () => input.press("Enter"));
});
