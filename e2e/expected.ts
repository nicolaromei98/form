// The expected differences against baseline B (plan §8.5, ED-1 to ED-12; e2e/expected-diffs.md):
// for each one, the regions the pixel gate masks (gate.ts) and the v2 value asserted in their place.
// The masks are measured in both builds and painted as a union; the assertions run on v2 builds
// only (B shows v0's values).
import { expect, type Locator, type Page } from "@playwright/test";
import type { Mask } from "./gate";

/* ------------------------------------------------------------------ */
/* Text helpers                                                        */
/* ------------------------------------------------------------------ */

/** Rendered text with whitespace collapsed (mentions, figures and decoded words read as one line) */
export async function textOf(locator: Locator): Promise<string> {
  return (await locator.innerText()).replace(/\s+/g, " ").trim();
}

/** The change counter in the corner: "Saved locally" is 0, "N changes · saved locally" is N */
export async function changeCount(page: Page): Promise<number> {
  const text = (await page.locator("body > div.fixed span.tabular-nums").textContent()) ?? "";
  return Number(/^(\d+) changes/.exec(text.trim())?.[1] ?? 0);
}

/* ------------------------------------------------------------------ */
/* The chrome: ED-7 and ED-11                                          */
/* ------------------------------------------------------------------ */

/** ED-7: "Demo parser · no AI model" where v0 said "no API key" (Claude removed, plan §13 item 3) */
export const ENGINE_LABEL: Mask = { ed: "ED-7", what: "engine label", target: (p) => p.locator("body > header span.t-micro") };
/** ED-7: the corner counter no longer counts tab switches (Q6) */
export const COUNTER: Mask = { ed: "ED-7", what: "change counter", target: (p) => p.locator("body > div.fixed span.tabular-nums") };
/** ED-11: a tab switch is no longer a history step (Q6), so Undo stays disabled after one */
export const HISTORY: Mask[] = [
  { ed: "ED-11", what: "Undo", target: (p) => p.locator('body > header button[aria-label^="Undo"]') },
  { ed: "ED-11", what: "Redo", target: (p) => p.locator('body > header button[aria-label^="Redo"]') },
];

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

/** ED-1: the timeline's chart right of the task labels: day grid, ticks, today line, bars, ranges */
export const TIMELINE_CHART: Mask = {
  ed: "ED-1",
  what: "timeline chart (grid, bars, ranges)",
  target: (p) => p.locator("main .overflow-x-auto:has(> div.relative > div.pointer-events-none.absolute)"),
  // Only the part right of the labels: the columns layer starts where the labels end
  region: (p) =>
    p.evaluate(() => {
      const scroller = document.querySelector("main .overflow-x-auto:has(> div.relative > div.pointer-events-none.absolute)");
      const columns = scroller?.querySelector(":scope > div.relative > div.pointer-events-none.absolute");
      if (!scroller || !columns) return [];
      const s = scroller.getBoundingClientRect();
      const c = columns.getBoundingClientRect();
      return [{ x: c.left + scrollX, y: s.top + scrollY, w: s.right - c.left, h: s.height }];
    }),
};
/** ED-2: the timeline footer says where the dates come from */
export const TIMELINE_FOOTER: Mask = { ed: "ED-2", what: "timeline footer", target: (p) => p.locator("main .overflow-x-auto + div.mt-4 > span.t-data") };

/** ED-3: each Team row's figure and its lane (weekly capacities 2/4/5, plan §6.5) */
export const TEAM_LANES: Mask[] = [
  { ed: "ED-3", what: "load figures", target: (p) => p.locator("[data-team-row] div.flex-col.items-end") },
  // The capacity line overhangs the lane by 4 px and the segments cast a shadow below it
  { ed: "ED-3", what: "lanes", target: (p) => p.locator("[data-team-row] > div.relative:last-child"), pad: 12 },
];
/** ED-3: the balance plan card's figure sentence */
export const PLAN_FIGURES: Mask = { ed: "ED-3", what: "plan card figures", target: (p) => p.locator("p", { hasText: /over capacity\. .+ has room/ }) };

/** ED-4: Focus's lead and point */
export const FOCUS_WHY: Mask = { ed: "ED-4", what: "focus lead and point", target: (p) => p.locator('section[aria-label="Focus"] > p[data-r="body"]') };

/** ED-5: the brief's last-end line (Next) and the Risks section (client risks, team load) */
export const BRIEF_END: Mask = { ed: "ED-5", what: "Next: the last task's end", target: (p) => briefLines(p).filter({ hasText: "the last task ends" }) };
export const BRIEF_RISKS: Mask = { ed: "ED-5", what: "Risks section", target: (p) => briefSection(p, "Risks") };

/** ED-8: the palette's capacity example */
export const PALETTE_CAPACITY: Mask = { ed: "ED-8", what: "palette capacity phrase", target: (p) => p.locator("li button > span").filter({ hasText: /^Set Marta's capacity/ }) };

/** ED-12: the moodboard's collage (positions hash the item ids, which v2 mints differently) */
export const MOOD_BOARD: Mask = { ed: "ED-12", what: "moodboard board (collage tiles)", target: (p) => p.locator("main section.mt-20 > div:last-child") };

const brief = (p: Page) => p.locator('article[aria-label="Status brief"]');
/** The brief's lines (headline, sections) */
export const briefLines = (p: Page) => brief(p).locator("div.relative[data-interactive]");
/** A brief section by its label ("Done", "Next"…) */
export const briefSection = (p: Page, label: string) => brief(p).locator("section").filter({ has: p.getByText(label, { exact: true }) });

/* ------------------------------------------------------------------ */
/* Assertions                                                          */
/* ------------------------------------------------------------------ */

export const v2 = {
  /** ED-1: the working-day ranges on the bars */
  async timelineRanges(page: Page, ranges: string[]) {
    const chart = page.locator("main .overflow-x-auto").filter({ has: page.locator("button[data-task-id]") });
    const text = (await chart.innerText()).replace(/\s+/g, "");
    for (const r of ranges) expect(text, `ED-1: the timeline shows ${r}`).toContain(r);
  },
  async timelineFooter(page: Page, suffix = "") {
    expect(await textOf(page.locator("main .overflow-x-auto + div.mt-4 > span.t-data")), "ED-2").toBe(`Sample schedule · working days, from estimates and dependencies${suffix}`);
  },
  /** ED-3: name → figure, as the row reads it ("10/6d +4d over") */
  async teamFigures(page: Page, expected: Record<string, string>) {
    for (const [name, figure] of Object.entries(expected)) {
      const row = page.locator("[data-team-row]").filter({ has: page.getByRole("textbox", { name: "Name" }).filter({ hasText: name }) });
      expect(await textOf(row.locator("div.flex-col.items-end")), `ED-3: ${name}'s figure`).toBe(figure);
    }
  },
};
