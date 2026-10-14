// The v0 §15 demo path, recorded as a video in Chromium and WebKit (plan §10.8 "Videos"), in real
// time with full motion. The videos of a reference and a candidate go side by side in the PR.
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ARTIFACTS_DIR } from "./env";
import { open, type App } from "./settle";

test.use({ reducedMotion: "no-preference", video: { mode: "on", size: { width: 1440, height: 900 } } });

/** Types a command at a readable pace and leaves the result on screen for `hold` ms. */
async function say(app: App, text: string, hold = 2500) {
  const input = app.page.getByRole("textbox", { name: "Command" });
  if (!(await input.count())) await app.page.keyboard.press("/");
  await input.waitFor();
  await app.wait(250);
  await input.pressSequentially(text, { delay: 18 });
  await input.press("Enter");
  await expect(input, `"${text}" should be accepted`).toHaveCount(0, { timeout: 10_000 });
  await app.wait(hold);
}

async function click(page: Page, name: string | RegExp, hold = 2000) {
  await page.getByRole("button", { name, exact: typeof name === "string" }).first().click();
  await page.waitForTimeout(hold);
}

test("v0 §15 path", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const app = await open(page, { intro: true }, "natural");

  // 1 · Intro
  await app.wait(2500);
  await click(page, "Enter FORM", 1500);

  // 2 · The idle ring: hover gathers the material, a click opens the composer
  const hit = await page.getByRole("button", { name: "Open FORM — describe what you need" }).boundingBox();
  if (!hit) throw new Error("No agent hit area");
  await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2, { steps: 12 });
  await app.wait(1200);
  await page.mouse.click(hit.x + hit.width / 2, hit.y + hit.height / 2);
  await app.wait(800);

  // 3 · Create a timeline
  await say(app, "Create a timeline for my project", 3500);

  // 4 · + Team, balance, accept
  await click(page, "Add the Team view", 2500);
  await say(app, "Balance the workload", 2500);
  await click(page, /^Accept/, 2500);

  // 5 · + Board, compact and by priority
  await say(app, "Add a board", 2500);
  await say(app, "Make the cards more compact and sort them by priority", 2500);

  // 6 · Point & Ask: break UI Design into steps, accept
  await click(page, "Select UI Design to ask FORM about it", 1000);
  await say(app, "Break this task into smaller steps", 2500);
  await click(page, /^Accept \d+ steps$/, 2500);
  await page.keyboard.press("Escape");

  // 7 · Focus
  await say(app, "What should I work on now?", 3500);

  // 8 · Brief for the client, then the team; rewrite a line
  await say(app, "Write a status update for the client", 3000);
  await say(app, "Now make it for the team", 2500);
  // The line's tools show on hover; clicking moves the pointer there, as a hand would
  await page.getByRole("button", { name: "Rewrite this line" }).first().click();
  const editor = page.getByRole("textbox", { name: "Edit line" });
  await editor.press("ControlOrMeta+a");
  await editor.pressSequentially("The homepage preview goes to the client on Friday.", { delay: 18 });
  await editor.press("Enter");
  await app.wait(2000);

  // 9 · Moodboard: colours, a note, a collage
  await say(app, "Add a moodboard for the project", 2500);
  await say(app, "Add the colours #0C0C0C, off-white and terracotta", 2500);
  await say(app, "Add a note: warm, tactile, editorial", 2500);
  await say(app, "Arrange the moodboard as a collage", 3000);

  // 10 · Undo chain, then a reload: everything is still there
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("ControlOrMeta+z");
    await app.wait(900);
  }
  await page.reload();
  await page.locator("main h1").waitFor({ state: "attached" });
  await app.wait(3000);

  // Keep the video next to the run's other artifacts
  const video = page.video();
  await page.close();
  if (video) {
    const dir = join(ARTIFACTS_DIR, "videos");
    mkdirSync(dir, { recursive: true });
    await video.saveAs(join(dir, `${testInfo.project.name}-v0-path.webm`));
  }
});
