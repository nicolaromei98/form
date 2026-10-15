// Stills of every /demo state (plan §10.8), with reduced motion, on the stepped clock.
// Run against a reference build with --update-snapshots, then against the candidate: the gate is
// 0 differing pixels (R vs A), or 0 outside the expected-difference masks (C vs B, step 19:
// e2e/gate.ts, e2e/expected.ts, e2e/expected-diffs.md). On a v2 build, every masked region's value
// is asserted as text or state.
import { expect, test, type BrowserContext } from "@playwright/test";
import { BASE_URL, ENGINE } from "./env";
import { changeCount, COUNTER, ENGINE_LABEL, HISTORY } from "./expected";
import { gate, type Mask } from "./gate";
import { open } from "./settle";
import { STATES } from "./states";

test.use({ reducedMotion: "reduce" });

/** ED-10: the one-off caption a migrated v0 save shows on its first load (every fixture has a dated, estimated schedule) */
const WEEKENDS = "Schedule now skips weekends.";

for (const state of STATES) {
  test(`${state.id}: ${state.title}`, async ({ page, browser }, testInfo) => {
    const app = await open(page, state.seed);
    if (app.notice) testInfo.annotations.push({ type: "first-load notice", description: app.notice });
    if (ENGINE === "v2") expect(app.notice, "ED-10: the first-load caption").toBe(state.seed.doc ? WEEKENDS : null);
    const loaded = await changeCount(page);
    await state.reach(app);
    await app.readyForStill();

    const g = state.gate ?? {};
    // The chrome's expected differences (ED-7, ED-11), from what the reach did to history
    const masks: Mask[] = [ENGINE_LABEL, ...(g.history?.kind === "tab-only" ? HISTORY : []), ...(g.history ? [COUNTER] : []), ...(g.masks ?? [])];
    if (ENGINE === "v2") {
      // The DOM text (the label is set in small caps by CSS)
      expect((await page.locator("body > header span.t-micro").textContent())?.trim(), "ED-7: the engine label").toBe("Demo parser · no AI model");
      if (g.history?.kind === "tab-only") {
        await expect(page.getByRole("button", { name: "Undo (⌘Z)" }), "ED-11: a tab switch leaves nothing to undo (Q6)").toBeDisabled();
        await expect(page.getByRole("button", { name: "Redo (⇧⌘Z)" }), "ED-11").toBeDisabled();
        expect(await changeCount(page), "ED-7: tab switches aren't counted").toBe(loaded);
      }
      if (g.history?.kind === "tab+commands") {
        await expect(page.getByRole("button", { name: "Undo (⌘Z)" })).toBeEnabled();
        expect(await changeCount(page), "ED-7: only the commands are counted, not the tab switch").toBe(loaded + g.history.commits);
      }
      await g.check?.(app);
    }

    // The whole page: on a phone most of a view sits below the fold
    const rec = await gate(page, testInfo, `${state.id}.png`, { masks, collapse: g.collapse });
    testInfo.annotations.push({ type: "gate", description: `${rec.mode}: ${rec.differing} differing of ${rec.compared} compared pixels; masked ${Object.keys(rec.masked).join(", ")}` });
    expect(rec.failures, `${state.id}: pixels outside the expected differences`).toEqual([]);

    if (ENGINE === "v2" && g.after) {
      // The same state reached again from the same seed, in a fresh context with this project's device
      const contexts: BrowserContext[] = [];
      const again = async () => {
        const u = testInfo.project.use;
        const context = await browser.newContext({
          viewport: u.viewport,
          deviceScaleFactor: u.deviceScaleFactor,
          isMobile: u.isMobile,
          hasTouch: u.hasTouch,
          userAgent: u.userAgent,
          locale: "en-US",
          timezoneId: "Europe/Rome",
          colorScheme: "light",
          reducedMotion: "reduce",
          baseURL: BASE_URL,
        });
        contexts.push(context);
        const second = await open(await context.newPage(), state.seed);
        await state.reach(second);
        await second.readyForStill();
        return second;
      };
      try {
        await g.after(app, again);
      } finally {
        for (const c of contexts) await c.close();
      }
    }
  });
}
