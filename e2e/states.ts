// The /demo states every build is captured in (plan §10.8), and the inputs that reach them.
// Every build gets the same input: a v0 workspace from test/fixtures/v0 under `form.workspace.v1`,
// then commands typed into the composer and clicks. Builds on the v2 engine reach the same states
// through the real first-load migration. Each state also names its expected differences against
// baseline B (`gate`, from e2e/expected.ts; the list and reasons are in e2e/expected-diffs.md).
import { expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { REPO } from "./env";
import {
  BRIEF_END,
  BRIEF_RISKS,
  FOCUS_WHY,
  MOOD_BOARD,
  PALETTE_CAPACITY,
  PLAN_FIGURES,
  TEAM_LANES,
  TIMELINE_CHART,
  TIMELINE_FOOTER,
  textOf,
  v2,
} from "./expected";
import type { Mask } from "./gate";
import type { App, Seed } from "./settle";

export type FixtureName = "docDemo" | "docTracker" | "doc60" | "moodImage" | "clearedEstimate";

/** A fixture as v0 stores it: the minified JSON of its envelope. */
export function fixtureText(name: FixtureName): string {
  return JSON.stringify(JSON.parse(readFileSync(join(REPO, "test/fixtures/v0", `${name}.json`), "utf8")));
}

/**
 * The moodboard's IndexedDB image (asset `img-fixture1` in the moodImage fixture): a 480×360 PNG
 * drawn here, so no binary sits in the repository and every run stores the same bytes.
 */
export function moodImageBase64(): string {
  const w = 480;
  const h = 360;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      // A warm paper gradient with an ink disc and a terracotta band
      const dx = x - 300;
      const dy = y - 150;
      const disc = dx * dx + dy * dy < 90 * 90;
      const band = y > 250 && y < 290;
      const t = (x + y) / (w + h);
      const rgb = disc ? [22, 22, 22] : band ? [200, 85, 61] : [Math.round(236 - 40 * t), Math.round(232 - 46 * t), Math.round(224 - 60 * t)];
      raw.set(rgb, row + 1 + x * 3);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return png.toString("base64");
}

export interface State {
  id: string;
  /** What the state shows, for the manifest and the report */
  title: string;
  seed: Seed;
  /** Commands and clicks from the seeded load to the state */
  reach: (app: App) => Promise<void>;
  /** The expected differences against B in this state; none beyond the engine label when absent */
  gate?: StateGate;
}

export interface StateGate {
  /**
   * What the reach does to history on v2 (Q6, ED-7 and ED-11), when it switches tabs:
   *   - "tab-only": only tab switches, which v0 recorded and v2 doesn't. Undo and Redo stay
   *     disabled (B: Undo enabled) and the corner counter doesn't move (B: one more per switch);
   *   - "tab+commands": tab switches and `commits` history steps. Undo is enabled in both, and the
   *     counter grows by `commits` only.
   */
  history?: { kind: "tab-only" } | { kind: "tab+commands"; commits: number };
  masks?: readonly Mask[];
  /**
   * Expected differences whose size differs between the builds (ED-2, ED-4, ED-5, ED-12): taken
   * out of the layout in both before the capture, so what follows them is compared in place
   */
  collapse?: readonly Mask[];
  /** The v2 values of what the masks hide, asserted on v2 builds before the capture */
  check?: (app: App) => Promise<void>;
  /** Checks that change the state, run on v2 builds after the capture (ED-12's determinism) */
  after?: (app: App, again: () => Promise<App>) => Promise<void>;
}

const demo: Seed = { doc: "docDemo" };

/** ED-5 (plan §8.5): the brief's lines that v2 composes from the working-day schedule */
async function briefChecks(app: App, risks: string[]) {
  const article = app.page.locator('article[aria-label="Status brief"]');
  const line = (text: string) => article.locator("div.relative[data-interactive]").filter({ hasText: text });
  expect(await textOf(line("the last task ends")), "ED-5 next:end").toBe("On the sample schedule, the last task ends 26 Oct.");
  const section = article.locator("section").filter({ has: app.page.getByText("Risks", { exact: true }) });
  const lines = await section.locator("div.relative[data-interactive]").allInnerTexts();
  expect(
    lines.map((l) => l.replace(/\s+/g, " ").trim()),
    "ED-5 risks",
  ).toEqual(risks);
}

/** ED-12: the collage's tiles, as laid out (unrotated box in board pixels, and the rotation) */
async function collage(app: App) {
  return app.page.evaluate(() => {
    const board = document.querySelector("main section.mt-20 > div:last-child > div.glass") ?? document.querySelector("main section.mt-20 > div:last-child");
    if (!board) throw new Error("No moodboard");
    const tiles = [...board.querySelectorAll<HTMLElement>("[data-mood-id]")].map((el) => {
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      return { id: el.dataset.moodId!, x: Math.round(m.e * 10) / 10, y: Math.round(m.f * 10) / 10, w: el.offsetWidth, h: el.offsetHeight, r: Math.round((Math.atan2(m.b, m.a) * 1800) / Math.PI) / 10 };
    });
    return { width: (board as HTMLElement).clientWidth, height: (board as HTMLElement).clientHeight, tiles: tiles.sort((a, b) => a.id.localeCompare(b.id)) };
  });
}

/** ED-12: every tile inside the board, and the same layout after re-arranging and after a reload */
async function collageChecks(app: App, again: () => Promise<App>) {
  // The gate took the board out of the layout for its capture: the board measures itself again first
  await app.readyForStill();
  const first = await collage(app);
  expect(first.tiles.length, "ED-12: the five references are on the board").toBe(5);
  for (const t of first.tiles) {
    const inside = t.x >= -0.5 && t.y >= -0.5 && t.x + t.w <= first.width + 0.5 && t.y + t.h <= first.height + 0.5;
    expect(inside, `ED-12: ${t.id} at ${t.x},${t.y} ${t.w}×${t.h} inside the ${first.width}×${first.height} board`).toBe(true);
  }
  // The same document loaded again, in a fresh browser context, and arranged the same way: the
  // same collage, so nothing but the document decides it…
  const second = await again();
  expect(await collage(second), "ED-12: a second load of the same document arranges the same collage").toEqual(first);
  // …and a reload shows the collage as it was saved
  await app.reload();
  await app.readyForStill();
  expect(await collage(app), "ED-12: the saved collage after a reload").toEqual(first);
}

const TEAM_FIGURES = { Marta: "10/6d +4d over", Sara: "0/4d 4d free", Luca: "8/15d 7d free" };

/** The stills (§10.8 "States"), captured with reduced motion. */
export const STATES: State[] = [
  { id: "intro", title: "First-visit intro over the empty workspace", seed: { intro: true }, reach: async () => {} },
  { id: "empty", title: "Empty workspace, idle ring", seed: {}, reach: async () => {} },
  {
    id: "composer",
    title: "Composer open on the empty workspace, with suggestions",
    seed: {},
    reach: async (app) => {
      await app.page.keyboard.press("/");
      await app.settle();
    },
  },
  {
    id: "palette",
    title: "Command palette over the demo project",
    seed: demo,
    reach: async (app) => {
      await app.page.keyboard.press("/");
      await app.settle();
      await app.click("Show commands");
    },
    gate: {
      masks: [PALETTE_CAPACITY],
      check: async (app) => {
        const phrase = app.page.locator("li button > span").filter({ hasText: /^Set Marta's capacity/ });
        expect(await textOf(phrase), "ED-8").toBe("Set Marta's capacity to 4 days a week");
      },
    },
  },
  { id: "tracker", title: "Tracker, comfortable grid", seed: demo, reach: async () => {} },
  { id: "tracker-compact", title: "Tracker, compact", seed: demo, reach: (app) => app.command("Make the cards more compact") },
  { id: "tracker-list", title: "Tracker as a list", seed: demo, reach: (app) => app.command("Show it as a list") },
  {
    id: "tracker-hide-done-empty",
    title: "Tracker with completed tasks hidden and every task done: the filtered-out state",
    seed: demo,
    reach: async (app) => {
      await app.command("Hide completed tasks");
      for (const t of ["Visual Direction", "UI Design", "Development"]) await app.command(`Mark ${t} done`);
    },
  },
  { id: "tracker-urgent", title: "Tracker with the urgent ones highlighted", seed: demo, reach: (app) => app.command("Highlight the urgent ones") },
  { id: "board", title: "Board", seed: demo, reach: (app) => app.tab("board"), gate: { history: { kind: "tab-only" } } },
  {
    id: "timeline",
    title: "Timeline",
    seed: demo,
    reach: (app) => app.tab("timeline"),
    gate: {
      history: { kind: "tab-only" },
      masks: [TIMELINE_CHART],
      collapse: [TIMELINE_FOOTER],
      check: async (app) => {
        await v2.timelineRanges(app.page, ["28.09–30.09", "01.10–06.10", "07.10–14.10", "15.10–26.10"]);
        await v2.timelineFooter(app.page);
      },
    },
  },
  {
    id: "timeline-cleared-estimate",
    title: "Timeline with Visual Direction's estimate cleared",
    seed: { doc: "clearedEstimate" },
    reach: (app) => app.tab("timeline"),
    gate: {
      history: { kind: "tab-only" },
      masks: [TIMELINE_CHART],
      collapse: [TIMELINE_FOOTER],
      check: async (app) => {
        await v2.timelineRanges(app.page, ["28.09–30.09"]);
        // Visual Direction has no estimate: its successors can't be dated, and say whose estimate they need
        await expect(app.page.getByText("Needs Visual Direction's estimate", { exact: true }), "ED-1").toHaveCount(2);
        // Visual Direction (no estimate) and the two tasks that wait on it
        await v2.timelineFooter(app.page, " · 3 without dates");
      },
    },
  },
  {
    id: "team",
    title: "Team",
    seed: demo,
    reach: (app) => app.tab("team"),
    gate: { history: { kind: "tab-only" }, masks: TEAM_LANES, check: (app) => v2.teamFigures(app.page, TEAM_FIGURES) },
  },
  {
    id: "team-balance-preview",
    title: "Team with the balance preview",
    seed: demo,
    reach: async (app) => {
      await app.tab("team");
      await app.command("Balance the workload");
    },
    gate: {
      history: { kind: "tab+commands", commits: 1 },
      masks: [...TEAM_LANES, PLAN_FIGURES],
      check: async (app) => {
        expect(await textOf(app.page.locator("p", { hasText: /over capacity\. .+ has room/ })), "ED-3 plan card").toBe("Marta is 4d over capacity. Sara has room for its 6d.");
      },
    },
  },
  {
    id: "team-balance-accepted",
    title: "Team after accepting the balance",
    seed: demo,
    reach: async (app) => {
      await app.tab("team");
      await app.command("Balance the workload");
      await app.click(/^Accept/);
      await app.dismissCaption();
    },
    gate: {
      history: { kind: "tab+commands", commits: 2 },
      masks: TEAM_LANES,
      check: (app) => v2.teamFigures(app.page, { Marta: "4/4d 0d free", Sara: "6/8d 2d free", Luca: "8/15d 7d free" }),
    },
  },
  {
    id: "focus",
    title: "Focus",
    seed: demo,
    reach: (app) => app.tab("focus"),
    gate: {
      history: { kind: "tab-only" },
      // The decision stack is centred: one line less of why moves the title and the next step
      collapse: [FOCUS_WHY],
      check: async (app) => {
        const why = app.page.locator('section[aria-label="Focus"] > p[data-r="body"]');
        expect(await textOf(why), "ED-4").toBe("In progress, 30% done. Urgent and on the critical path.");
      },
    },
  },
  {
    id: "brief-client",
    title: "Brief for the client",
    seed: demo,
    reach: (app) => app.tab("brief"),
    gate: {
      history: { kind: "tab-only" },
      collapse: [BRIEF_END, BRIEF_RISKS],
      check: (app) => briefChecks(app, ["UI Design is urgent."]),
    },
  },
  {
    id: "brief-team",
    title: "Brief for the team",
    seed: demo,
    reach: async (app) => {
      await app.tab("brief");
      await app.command("Now make it for the team");
    },
    gate: {
      history: { kind: "tab+commands", commits: 1 },
      collapse: [BRIEF_END, BRIEF_RISKS],
      check: (app) => briefChecks(app, ["UI Design is urgent.", "Marta is 4 days over capacity."]),
    },
  },
  {
    id: "brief-short",
    title: "Brief, short version",
    seed: demo,
    reach: async (app) => {
      await app.tab("brief");
      await app.command("Make the brief shorter");
    },
    gate: {
      history: { kind: "tab+commands", commits: 1 },
      collapse: [BRIEF_END, BRIEF_RISKS],
      check: (app) => briefChecks(app, ["UI Design is urgent."]),
    },
  },
  {
    id: "moodboard",
    title: "Moodboard with an IndexedDB image, colours and a note, arranged as a collage",
    seed: { doc: "moodImage", image: true },
    reach: async (app) => {
      await app.command("Add the colours #0C0C0C, off-white and terracotta");
      await app.command("Add a note: warm, tactile, editorial");
      await app.command("Arrange the moodboard as a collage");
    },
    gate: { collapse: [MOOD_BOARD], after: collageChecks },
  },
  {
    id: "caption-undo",
    title: "A caption with Undo",
    seed: demo,
    reach: (app) => app.command("Highlight the urgent ones", { keepCaption: true }),
  },
  {
    id: "proposal",
    title: "Subtasks proposal on UI Design",
    seed: demo,
    reach: async (app) => {
      await app.select("UI Design");
      await app.command("Break this task into smaller steps");
    },
  },
  {
    id: "proposal-accepted",
    title: "UI Design after accepting the proposed steps",
    seed: demo,
    reach: async (app) => {
      await app.select("UI Design");
      await app.command("Break this task into smaller steps");
      await app.click(/^Accept \d+ steps$/);
      await app.dismissCaption();
    },
  },
];
