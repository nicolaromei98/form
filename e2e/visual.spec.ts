// Stills of every /demo state (plan §10.8), with reduced motion, on the stepped clock.
// Run against a reference build with --update-snapshots, then against the candidate: the gate is
// 0 differing pixels (R vs A), or 0 outside the expected-diff masks (C vs B, step 19).
import { expect, test } from "@playwright/test";
import { open } from "./settle";
import { STATES } from "./states";

test.use({ reducedMotion: "reduce" });

for (const state of STATES) {
  test(`${state.id}: ${state.title}`, async ({ page }, testInfo) => {
    const app = await open(page, state.seed);
    if (app.notice) testInfo.annotations.push({ type: "first-load notice", description: app.notice });
    await state.reach(app);
    await app.readyForStill();
    // The whole page: on a phone most of a view sits below the fold
    await expect(page).toHaveScreenshot(`${state.id}.png`, { fullPage: true });
  });
}
