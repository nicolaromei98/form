// The /demo states every build is captured in (plan §10.8), and the inputs that reach them.
// Every build gets the same input: a v0 workspace from test/fixtures/v0 under `form.workspace.v1`,
// then commands typed into the composer and clicks. Builds on the v2 engine reach the same states
// through the real first-load migration.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { REPO } from "./env";
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
}

const demo: Seed = { doc: "docDemo" };

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
  { id: "board", title: "Board", seed: demo, reach: (app) => app.tab("board") },
  { id: "timeline", title: "Timeline", seed: demo, reach: (app) => app.tab("timeline") },
  { id: "timeline-cleared-estimate", title: "Timeline with Visual Direction's estimate cleared", seed: { doc: "clearedEstimate" }, reach: (app) => app.tab("timeline") },
  { id: "team", title: "Team", seed: demo, reach: (app) => app.tab("team") },
  {
    id: "team-balance-preview",
    title: "Team with the balance preview",
    seed: demo,
    reach: async (app) => {
      await app.tab("team");
      await app.command("Balance the workload");
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
  },
  { id: "focus", title: "Focus", seed: demo, reach: (app) => app.tab("focus") },
  { id: "brief-client", title: "Brief for the client", seed: demo, reach: (app) => app.tab("brief") },
  {
    id: "brief-team",
    title: "Brief for the team",
    seed: demo,
    reach: async (app) => {
      await app.tab("brief");
      await app.command("Now make it for the team");
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
