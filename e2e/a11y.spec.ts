// Accessibility of every /demo state (plan §9.2, §10.8): axe-core with the Phase 0 audit's tags,
// run once the state has settled (reduced motion, stepped clock: the DOM the stills show).
//
// Two passes per state:
//   - "rendered": the page as it is. Over the ground's radial gradient axe can't decide most text
//     (AUDIT §11.4: "bgGradient"), so this pass alone would pass silently on contrast;
//   - "flat ground": the same page with the ground painted flat at its darkest end (--paper-lo, the
//     edge of the gradient), so axe can resolve the text it couldn't, against the worst ground.
//
// On a build with the Q14 tokens (plan step 4 on) every state must show:
//   - no color-contrast violation in either pass;
//   - no rule that baseline A doesn't already break in that state (e2e/baselines/a11y-A.json; for a
//     state it lacks, the rules A breaks anywhere). A breaks aria-prohibited-attr (the animated
//     texts' labels), region (agent and chrome outside the landmarks), target-size (the priority
//     dots) and, in the palette, landmark-no-duplicate-banner and landmark-unique: the Phase 3
//     ARIA and keyboard work and Phase 6 (AUDIT §11.4, §12.2), not Phase 1.
// Earlier builds (A, R) record without asserting. Every result goes to <artifacts>/a11y/<state>.json;
// scripts/e2e/a11y-baseline.mjs turns a run of A into the baseline file.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ARTIFACTS_DIR, REPO } from "./env";
import { open } from "./settle";
import { STATES } from "./states";

/** The tags of the Phase 0 scan (AUDIT §11.4) */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

const BASELINE = join(REPO, "e2e/baselines/a11y-A.json");

test.use({ reducedMotion: "reduce" });

interface NodeResult {
  target: string;
  /** color-contrast only: what axe measured */
  fg?: string;
  bg?: string;
  ratio?: number;
  expected?: string;
  fontSize?: string;
}

interface Pass {
  /** Violated rules: impact and the nodes */
  violations: Record<string, { impact: string | null; nodes: NodeResult[] }>;
  /** Text whose contrast axe couldn't decide, by reason (bgGradient, bgOverlap, imgNode…) */
  contrastUndecided: Record<string, number>;
}

interface A11yResult {
  state: string;
  title: string;
  /** The build carries the Q14 tokens (--line-strong exists) */
  q14: boolean;
  rendered: Pass;
  flatGround: Pass;
}

/**
 * axe schedules its work on timers, and the stepped clock is paused: the clock moves a frame at a
 * time until the scan returns. The settled page doesn't change meanwhile (reduced motion, no input).
 */
async function onClock<T>(page: Page, work: Promise<T>): Promise<T> {
  let done = false;
  work.then(
    () => (done = true),
    () => (done = true),
  );
  while (!done) {
    await page.clock.runFor(16);
    await new Promise((r) => setTimeout(r, 5));
  }
  return work;
}

async function scan(page: Page): Promise<Pass> {
  const res = await onClock(page, new AxeBuilder({ page }).withTags(TAGS).analyze());
  const violations: Pass["violations"] = {};
  for (const v of res.violations) {
    violations[v.id] = {
      impact: v.impact ?? null,
      nodes: v.nodes.map((n) => {
        const data = (n.any[0]?.data ?? {}) as { fgColor?: string; bgColor?: string; contrastRatio?: number; expectedContrastRatio?: string; fontSize?: string };
        return {
          target: n.target.join(" "),
          ...(v.id === "color-contrast" && { fg: data.fgColor, bg: data.bgColor, ratio: data.contrastRatio, expected: data.expectedContrastRatio, fontSize: data.fontSize }),
        };
      }),
    };
  }
  const contrastUndecided: Record<string, number> = {};
  for (const n of res.incomplete.find((r) => r.id === "color-contrast")?.nodes ?? []) {
    const key = (n.any[0]?.data as { messageKey?: string } | undefined)?.messageKey ?? "other";
    contrastUndecided[key] = (contrastUndecided[key] ?? 0) + 1;
  }
  return { violations, contrastUndecided };
}

/** The rules A breaks in this state, colour contrast aside */
function baselineRules(state: string): string[] {
  const states = (JSON.parse(readFileSync(BASELINE, "utf8")) as { states: Record<string, string[]> }).states;
  return states[state] ?? [...new Set(Object.values(states).flat())];
}

const describe = (pass: Pass) =>
  Object.entries(pass.violations)
    .map(([id, v]) => `${id} (${v.impact}): ${v.nodes.map((n) => (n.ratio ? `${n.target} ${n.fg} on ${n.bg} = ${n.ratio}:1, needs ${n.expected}` : n.target)).join("; ")}`)
    .join("\n");

for (const state of STATES) {
  test(`${state.id}: ${state.title}`, async ({ page }, testInfo) => {
    const app = await open(page, state.seed);
    await state.reach(app);
    await app.readyForStill();
    const q14 = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--line-strong").trim() !== "");

    const rendered = await scan(page);
    await page.addStyleTag({ content: ".ground { background: var(--paper-lo) !important; }" });
    const flatGround = await scan(page);

    const result: A11yResult = { state: state.id, title: state.title, q14, rendered, flatGround };
    const dir = join(ARTIFACTS_DIR, "a11y");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${state.id}.json`), JSON.stringify(result, null, 2) + "\n");
    testInfo.annotations.push({ type: "axe", description: `rendered: ${Object.keys(rendered.violations).join(", ") || "none"}; flat ground: ${Object.keys(flatGround.violations).join(", ") || "none"}` });

    if (!q14) {
      testInfo.annotations.push({ type: "a11y", description: "Recorded only: this build predates the Q14 tokens (plan step 4)" });
      return;
    }
    expect(rendered.violations["color-contrast"], `Q14: no contrast violation as rendered\n${describe(rendered)}`).toBeUndefined();
    expect(flatGround.violations["color-contrast"], `Q14: no contrast violation on the darkest ground\n${describe(flatGround)}`).toBeUndefined();
    const known = baselineRules(state.id);
    const fresh = [...new Set([...Object.keys(rendered.violations), ...Object.keys(flatGround.violations)])].filter((id) => !known.includes(id));
    expect(fresh, `rules baseline A doesn't break in this state\n${describe(rendered)}`).toEqual([]);
  });
}
