// Generates the v0 migration fixtures (plan §10.6) through the frozen v0 code in test/legacy/v0.
//
//   npm run fixtures:v0             writes test/fixtures/v0/<name>.json, manifest.json and README.md
//   npm run fixtures:v0 -- --check  regenerates in memory and fails if a committed file differs
//
// Every fixture is what v0 would hold in localStorage, built with the frozen reducer and parser.
// The v0 reducer mints ids with Math.random, so each fixture runs under its own seeded PRNG and
// the output is byte-stable. Dates are read in Europe/Rome on 2026-10-14, the plan's frozen day.
//
// A few cases come from saves made before the v0 safety patch (b201af8), whose limits the frozen
// reducer now enforces. For those the frozen reducer builds the document as far as it can, and the
// pre-patch effect recorded in docs/AUDIT.md §5 is then written as data, with a comment naming it.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { composeBrief } from "../../test/legacy/v0/lib/brief";
import { interpretDemo } from "../../test/legacy/v0/lib/interpret/demo";
import { MOOD_GAP, MOOD_PAD, placeNext } from "../../test/legacy/v0/lib/mood";
import { applyOperations } from "../../test/legacy/v0/lib/ops";
import { DocSchema, type Doc, type MoodItem, type Operation, type Representation } from "../../test/legacy/v0/lib/schema";
import { emptyDoc } from "../../test/legacy/v0/lib/seed";

/** Where the fixtures live. */
export const FIXTURE_DIR = fileURLToPath(new URL("../../test/fixtures/v0/", import.meta.url));

/** The v0 localStorage keys (src/lib/store.ts at b201af8). */
export const V0_KEY = "form.workspace.v1";
export const V0_BACKUP_KEY = `${V0_KEY}.backup`;

/** The plan's frozen day and clock (§10.6, §10.8). */
const TODAY = { y: 2026, m: 10, d: 14 };
const LOG_START = Date.UTC(2026, 9, 14, 8, 0, 0);

const ALL_VIEWS: Representation[] = ["cards", "board", "timeline", "team", "focus", "brief"];

interface LogEntry {
  at: number;
  label: string;
  source: "agent" | "direct";
}

/** The zustand persist envelope v0 writes under `form.workspace.v1`. */
export interface Envelope {
  state: { doc: unknown; log: LogEntry[] };
  version: 1;
}

/** Raw localStorage contents, key → the exact string v0 (or a broken write) left there. */
export type StorageMap = Record<string, string>;

export type FixtureKind = "envelope" | "storage";

export interface FixtureEntry {
  name: string;
  file: string;
  /** "envelope": the parsed value of `form.workspace.v1`. "storage": raw localStorage strings by key. */
  kind: FixtureKind;
  /** "audit": recorded by the Phase 0 audit and copied in step 1. "generated": written by this script. */
  source: "audit" | "generated";
  /** The plan §10.6 case it covers, or the e2e state it seeds (§10.8). */
  covers: string;
  /** One line: what the fixture is for. */
  purpose: string;
  /** What v0's store makes of the main key: the doc parses with the frozen DocSchema, fails it, or can't be read at all. */
  v0Load: "valid" | "invalid" | "unreadable" | "absent";
}

interface Spec extends Omit<FixtureEntry, "file" | "v0Load" | "source"> {
  /** Builds the file content; absent for the audit fixtures, which are only checked. */
  build?: () => Envelope | StorageMap;
}

/* ------------------------------------------------------------------ */
/* Deterministic helpers                                               */
/* ------------------------------------------------------------------ */

/** mulberry32: a small seeded PRNG standing in for Math.random while the v0 reducer mints ids. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seedOf = (name: string) => createHash("sha256").update(name).digest().readUInt32LE(0);

/** Runs `build` with Math.random replaced by a PRNG seeded from the fixture name. */
function seeded<T>(name: string, build: () => T): T {
  const real = Math.random;
  Math.random = prng(seedOf(name));
  try {
    return build();
  } finally {
    Math.random = real;
  }
}

/** The day the brief and focus read, as v0 builds it: local midnight in the plan's time zone. */
function today(): Date {
  return new Date(TODAY.y, TODAY.m - 1, TODAY.d);
}

/** A v0 session: the document plus the log the store keeps for every change that took effect. */
class Session {
  doc: Doc;
  log: LogEntry[] = [];
  selectedId: string | null = null;

  constructor(doc: Doc = emptyDoc()) {
    this.doc = doc;
  }

  /** A direct edit (the store's `commit`): logged only when the document changed. */
  apply(label: string, ...ops: Operation[]): this {
    const next = applyOperations(this.doc, ops);
    if (next !== this.doc) this.record(label, "direct");
    this.doc = next;
    return this;
  }

  /** A typed command through the frozen demo parser, as `submit` runs it. */
  say(command: string): this {
    const result = interpretDemo(command, { doc: this.doc, selectedId: this.selectedId });
    if (result.tone !== "done" && result.tone !== "proposal") {
      throw new Error(`"${command}" → ${result.tone}: ${result.message}`);
    }
    const next = result.ops.length ? applyOperations(this.doc, result.ops) : this.doc;
    if (next !== this.doc) this.record(command, "agent");
    this.doc = next;
    return this;
  }

  select(title: string): this {
    this.selectedId = this.idOf(title);
    return this;
  }

  idOf(title: string): string {
    const task = Object.values(this.doc.tasks).find((t) => t.title === title);
    if (!task) throw new Error(`No task called ${title}`);
    return task.id;
  }

  private record(label: string, source: LogEntry["source"]) {
    // Newest first and at most 40, like the store
    this.log = [{ at: LOG_START + this.log.length * 60_000, label, source }, ...this.log].slice(0, 40);
  }

  envelope(): Envelope {
    return { state: { doc: this.doc, log: this.log }, version: 1 };
  }
}

/** The website template exactly as "Create a project tracker for my new website" makes it. */
function template(view: Representation = "cards"): Session {
  const command = {
    cards: "Create a project tracker for my new website",
    board: "Create a board for my new website",
    timeline: "Create a timeline for my project",
  }[view as "cards" | "board" | "timeline"];
  return new Session().say(command);
}

/** The template with all six views created, landing on the tracker (the shape of docDemo). */
function allViews(): Session {
  const s = template("cards");
  for (const v of ALL_VIEWS.slice(1)) s.apply(`view → ${v}`, { op: "setRepresentation", representation: v });
  return s.apply("view → cards", { op: "setRepresentation", representation: "cards" });
}

/* ------------------------------------------------------------------ */
/* The cases                                                           */
/* ------------------------------------------------------------------ */

const TITLE_140 = "Website relaunch for the Fondazione Arte Contemporanea, with the new visual identity, the online shop and the archive of all its exhibitions";
if (TITLE_140.length !== 140) throw new Error("TITLE_140 must be 140 characters");

const SPECS: Spec[] = [
  // 1 · The template as created
  {
    name: "docDemo",
    kind: "envelope",
    covers: "§10.6 #1",
    purpose: "The demo template with all six views on the tracker (the Phase 0 audit's demo document).",
  },
  {
    name: "docTracker",
    kind: "envelope",
    covers: "§10.6 #1; e2e add-view",
    purpose: "The template exactly as created: one tracker view, the sample team and the sample start date.",
    build: () => template("cards").envelope(),
  },

  // 2 · Legacy shapes
  {
    name: "legacyMinimal",
    kind: "envelope",
    covers: "§10.6 #2",
    purpose: "A save from before views, team, moodboard and brief existed: no tool.views, people, mood, plan, brief or task owner.",
    build: () => {
      const s = template("cards");
      const doc = structuredClone(s.doc) as Record<string, unknown> & Doc;
      delete (doc.tool as Partial<NonNullable<Doc["tool"]>>).views;
      for (const key of ["people", "mood", "plan", "brief"] as const) delete (doc as Partial<Doc>)[key];
      for (const t of Object.values(doc.tasks)) delete (t as Partial<typeof t>).owner;
      return { state: { doc, log: s.log }, version: 1 };
    },
  },

  // 3 · Over-limit saves (pre-patch, docs/AUDIT.md §5)
  {
    name: "overTitle140",
    kind: "envelope",
    covers: "§10.6 #3",
    purpose: "A 140-character project title, stored by the header editor before the safety patch (limit 80).",
    build: () => {
      const s = allViews();
      // Pre-patch: parts.tsx sliced the title to 140 and commit() never validated renameTool
      (s.doc.tool as { title: string }).title = TITLE_140;
      return s.envelope();
    },
  },
  {
    name: "over21People",
    kind: "envelope",
    covers: "§10.6 #3",
    purpose: "21 people, added one by one in the Team view before the safety patch capped the team at 20.",
    build: () => {
      const s = allViews();
      for (let i = 1; s.doc.people.length < 20; i++) s.apply("add person", { op: "addPerson", name: `Person ${String(i).padStart(2, "0")}` });
      // Pre-patch: "Add person" had no cap; the frozen reducer refuses the 21st, so it is written as data
      const extra = { id: "p-extra21", name: "Person 21", role: null, capacity: 10 };
      s.doc = { ...s.doc, people: [...s.doc.people, extra] };
      s.log = [{ at: LOG_START + s.log.length * 60_000, label: "add person", source: "direct" as const }, ...s.log].slice(0, 40);
      return s.envelope();
    },
  },
  {
    name: "over216Mood",
    kind: "envelope",
    covers: "§10.6 #3",
    purpose: "216 moodboard references from nine 24-image drops, before the safety patch capped the board at 200.",
    build: () => {
      const s = allViews();
      for (let drop = 0; drop < 9 && s.doc.mood.length < 200; drop++) {
        const items = Array.from({ length: 24 }, (_, i) => ({ kind: "image" as const, asset: `img-d${drop}i${i}`, w: 0.24, h: 0.24 * 0.75 }));
        s.apply(`add ${items.length} images`, { op: "addMoodItems", items });
      }
      // Pre-patch: addMoodItems piled drops up uncapped; the frozen reducer stops at 200
      const mood = [...s.doc.mood];
      for (let i = mood.length; i < 216; i++) {
        const at = placeNext(mood, 0.24);
        mood.push({ id: `m-over${i}`, kind: "image", x: at.x, y: Math.min(20, at.y), w: 0.24, h: 0.18, r: 0, asset: `img-over${i}`, hex: null, text: null });
      }
      s.doc = { ...s.doc, mood };
      return s.envelope();
    },
  },
  {
    name: "overMasonryTallNotes",
    kind: "envelope",
    covers: "§10.6 #3",
    purpose: "Tall notes arranged as a masonry before the safety patch: heights over 3 and tops past 20 board widths.",
    build: () => {
      const s = allViews();
      const notes = Array.from({ length: 14 }, (_, i) => ({ kind: "note" as const, text: `Reference note ${i + 1}` }));
      s.apply("add notes", { op: "addMoodItems", items: notes });
      for (const it of s.doc.mood) s.apply("resize", { op: "updateMoodItem", id: it.id, patch: { w: 0.06, h: 3 } });
      // Pre-patch masonry (mood.ts before b201af8 never clamped y or h): the same arithmetic, unbounded
      const cols = 4;
      const cw = (1 - 2 * MOOD_PAD - (cols - 1) * MOOD_GAP) / cols;
      const heights = Array<number>(cols).fill(MOOD_PAD);
      const mood: MoodItem[] = s.doc.mood.map((it) => {
        const col = heights.indexOf(Math.min(...heights));
        const h = cw * (it.h / it.w);
        const y = heights[col];
        heights[col] += h + MOOD_GAP;
        return { ...it, x: MOOD_PAD + col * (cw + MOOD_GAP), y, w: cw, h, r: 0 };
      });
      s.doc = { ...s.doc, mood };
      s.log = [{ at: LOG_START + s.log.length * 60_000, label: "arrange masonry", source: "direct" as const }, ...s.log].slice(0, 40);
      return s.envelope();
    },
  },
  {
    name: "overNarrowNote",
    kind: "envelope",
    covers: "§10.6 #3",
    purpose: "A note resized to 0.06 × 3 board widths, then laid out as a grid before the patch: width below the 0.04 minimum.",
    build: () => {
      const s = allViews();
      s.apply("add note", { op: "addMoodItems", items: [{ kind: "note", text: "Warm, tactile, editorial" }] });
      s.apply("add colour", { op: "addMoodItems", items: [{ kind: "color", hex: "#c8553d", text: "terracotta" }] });
      const note = s.doc.mood[0];
      s.apply("resize", { op: "updateMoodItem", id: note.id, patch: { w: 0.06, h: 3 } });
      // Pre-patch grid (mood.ts before b201af8 never clamped w): the note's cell shrinks it to its aspect
      const cols = 2;
      const cw = (1 - 2 * MOOD_PAD - (cols - 1) * MOOD_GAP) / cols;
      const ch = cw * 0.82;
      const resized = s.doc.mood[0];
      const a = resized.h / resized.w;
      const w = a > ch / cw ? ch / a : cw;
      const mood = s.doc.mood.map((it, i) => (i === 0 ? { ...it, x: MOOD_PAD + (cw - w) / 2, y: MOOD_PAD, w, h: w * a } : it));
      s.doc = { ...s.doc, mood };
      return s.envelope();
    },
  },

  // 4 · Incoherent status and progress (docs/AUDIT.md §2 B.11, §3)
  {
    name: "incoherentDone40",
    kind: "envelope",
    covers: "§10.6 #4",
    purpose: 'done@40: "Mark UI Design done at 40%" sets both fields in one patch, so v0 never coerces them.',
    build: () => allViews().say("Mark UI Design done at 40%").envelope(),
  },
  {
    name: "incoherentTodo30",
    kind: "envelope",
    covers: "§10.6 #4",
    purpose: "todo@30: the status menu moves UI Design (In progress, 30%) back to To do and keeps its progress.",
    build: () => {
      const s = allViews();
      return s.apply("edit", { op: "updateTask", id: s.idOf("UI Design"), patch: { status: "todo" } }).envelope();
    },
  },
  {
    name: "incoherentReview100",
    kind: "envelope",
    covers: "§10.6 #4",
    purpose: "review@100: the board's lane arrow moves Research from Done back to In review at 100%.",
    build: () => {
      const s = allViews();
      return s.apply("edit", { op: "updateTask", id: s.idOf("Research"), patch: { status: "review" } }).envelope();
    },
  },
  {
    name: "incoherentActive100",
    kind: "envelope",
    covers: "§10.6 #4",
    purpose: "active@100: the status menu moves Research from Done to In progress at 100%.",
    build: () => {
      const s = allViews();
      return s.apply("edit", { op: "updateTask", id: s.idOf("Research"), patch: { status: "active" } }).envelope();
    },
  },
  {
    name: "incoherentTodo100",
    kind: "envelope",
    covers: "§10.6 #4",
    purpose: "todo@100: a patch that sets To do and 100% together (parser or Claude path) on Development.",
    build: () => {
      const s = allViews();
      return s.apply("edit", { op: "updateTask", id: s.idOf("Development"), patch: { status: "todo", progress: 100 } }).envelope();
    },
  },
  {
    name: "sliderReview90",
    kind: "envelope",
    covers: "§10.6 #4",
    purpose: "Visual Direction (In review, 85%) after a slider pass 90 → 95 → 100 → 95 → 90: v0 stores active@90, review lost.",
    build: () => {
      const s = allViews();
      const id = s.idOf("Visual Direction");
      // The slider writes live frames without history, then one checkpointed commit
      for (const progress of [90, 95, 100, 95]) s.doc = applyOperations(s.doc, [{ op: "updateTask", id, patch: { progress } }]);
      return s.apply("edit", { op: "updateTask", id, patch: { progress: 90 } }).envelope();
    },
  },

  // 5 · Steps that v2 can't nest
  {
    name: "stepGrandchild",
    kind: "envelope",
    covers: "§10.6 #5",
    purpose: "A step under a step: UI Design › Wireframes › Mobile wireframes (the reducer accepts a step as parent).",
    build: () => {
      const s = allViews();
      s.apply("add step", { op: "addTask", title: "Wireframes", parentId: s.idOf("UI Design"), estimate: 2 });
      return s.apply("add step", { op: "addTask", title: "Mobile wireframes", parentId: s.idOf("Wireframes"), estimate: 1 }).envelope();
    },
  },
  {
    name: "stepOrphan",
    kind: "envelope",
    covers: "§10.6 #5",
    purpose: "An orphan step: removing Copywriting deletes its step Headlines but leaves the grandchild Hero line pointing at nothing.",
    build: () => {
      const s = allViews().say("Add a task called Copywriting");
      s.apply("add step", { op: "addTask", title: "Headlines", parentId: s.idOf("Copywriting"), estimate: 1 });
      s.apply("add step", { op: "addTask", title: "Hero line", parentId: s.idOf("Headlines"), estimate: 0.5 });
      return s.apply("remove task", { op: "removeTask", id: s.idOf("Copywriting") }).envelope();
    },
  },

  // 6 · Two pending proposals
  {
    name: "proposalAndPlan",
    kind: "envelope",
    covers: "§10.6 #6",
    purpose: "A subtasks proposal on UI Design and a reassign plan pending at once (v2 keeps one: the subtasks).",
    build: () => {
      const s = allViews().say("Balance the workload");
      return s.select("UI Design").say("Break this task into smaller steps").envelope();
    },
  },

  // 7 · Steps with estimates
  {
    name: "stepsWithEstimates",
    kind: "envelope",
    covers: "§10.6 #7",
    purpose: "UI Design broken into accepted steps that carry their own estimates, one of them done.",
    build: () => {
      const s = allViews().select("UI Design").say("Break this task into smaller steps").say("Accept them");
      const first = Object.values(s.doc.tasks).find((t) => t.parentId === s.idOf("UI Design"));
      if (!first) throw new Error("No accepted step");
      return s.apply("edit", { op: "updateTask", id: first.id, patch: { status: "done" } }).envelope();
    },
  },

  // 8 · Dangling focus pin
  {
    name: "danglingFocus",
    kind: "envelope",
    covers: "§10.6 #8",
    purpose: "view.focusId still names Development after Development was deleted (removeTask never clears it).",
    build: () => allViews().say("Focus on Development").say("Delete Development").envelope(),
  },

  // 9 · Brief edits keyed by entity ids
  {
    name: "briefEdits",
    kind: "envelope",
    covers: "§10.6 #9",
    purpose: "Brief edits keyed client:risks:t-ui and team:risks:load:p-marta, one keyed by a task that no longer exists, and two added lines.",
    build: () => {
      const s = allViews();
      const basis = (audience: "client" | "team", id: string) => {
        const brief = composeBrief(s.doc, audience, false, today());
        const line = [...(brief?.headline ?? []), ...(brief?.sections ?? []).flatMap((x) => x.lines)].find((l) => l.id === id);
        if (!line) throw new Error(`No ${audience} sentence ${id} on the sample day`);
        return line.composed;
      };
      s.apply("brief edit", { op: "editBriefLine", key: "client:risks:t-ui", text: "UI Design is the priority this week.", basis: basis("client", "risks:t-ui") });
      s.apply("brief edit", { op: "editBriefLine", key: "team:risks:load:p-marta", text: "Marta needs help on UI Design.", basis: basis("team", "risks:load:p-marta") });
      // A key whose task is gone: written on a task that was later deleted
      s.apply("brief edit", { op: "editBriefLine", key: "client:moving:t-copy", text: "Copywriting is with the client.", basis: "Copywriting has started." });
      s.say("Add to the brief: homepage preview on Friday");
      s.say("Add to the team brief: standup moved to 10");
      return s.envelope();
    },
  },

  // 10 · A moodboard image (its blob lives in IndexedDB, which this fixture can't carry)
  {
    name: "moodImage",
    kind: "envelope",
    covers: "§10.6 #10; e2e moodboard",
    purpose: "A moodboard with one image whose blob is missing (the e2e suite stores a blob under its asset id, img-fixture1).",
    build: () => {
      const s = allViews();
      return s.apply("add 1 image", { op: "addMoodItems", items: [{ kind: "image", asset: "img-fixture1", w: 0.24, h: 0.24 * 0.75 }] }).envelope();
    },
  },

  // 11 · Corrupt main key, valid backup
  {
    name: "corruptMainWithBackup",
    kind: "storage",
    covers: "§10.6 #11",
    purpose: "A main key that isn't JSON (a truncated write) next to a .backup ({doc, log}) holding a valid workspace.",
    build: () => {
      const s = allViews().say("Make the cards more compact");
      const main = JSON.stringify(s.envelope());
      return { [V0_KEY]: main.slice(0, Math.floor(main.length / 2)), [V0_BACKUP_KEY]: JSON.stringify({ doc: s.doc, log: s.log }) };
    },
  },

  // 12 · The three shapes a v0 document can be stored in
  {
    name: "shapeEnvelope",
    kind: "storage",
    covers: "§10.6 #12",
    purpose: "The zustand envelope {state: {doc, log}, version: 1} as v0's store writes it.",
    build: () => ({ [V0_KEY]: JSON.stringify(allViews().say("Highlight the urgent ones").envelope()) }),
  },
  {
    name: "shapeBackup",
    kind: "storage",
    covers: "§10.6 #12",
    purpose: "Only a .backup ({doc, log}, the safety patch's copy of an unreadable save) and no main key.",
    build: () => {
      const s = allViews().say("Highlight the urgent ones");
      return { [V0_BACKUP_KEY]: JSON.stringify({ doc: s.doc, log: s.log }) };
    },
  },
  {
    name: "shapeBare",
    kind: "storage",
    covers: "§10.6 #12",
    purpose: "A bare document under the main key, with no zustand envelope around it.",
    build: () => ({ [V0_KEY]: JSON.stringify(allViews().say("Highlight the urgent ones").doc) }),
  },

  // 13 · No project
  {
    name: "toolNull",
    kind: "envelope",
    covers: "§10.6 #13",
    purpose: '"Reset demo" after some work: tool null, no tasks, a log that still counts the changes.',
    build: () => {
      const s = allViews().say("Highlight the urgent ones");
      // store.reset() swaps in an empty document and leaves the log as it was
      return { state: { doc: emptyDoc(), log: s.log }, version: 1 };
    },
  },

  // 14 · Scale (audit)
  {
    name: "doc60",
    kind: "envelope",
    covers: "§10.6 #14",
    purpose: "60 top-level tasks over all six views (the Phase 0 audit's stress document).",
  },
  {
    name: "doc150",
    kind: "envelope",
    covers: "§10.6 #14",
    purpose: "150 top-level tasks over all six views (the Phase 0 audit's scale document).",
  },

  // e2e inputs (§10.8)
  {
    name: "clearedEstimate",
    kind: "envelope",
    covers: "e2e timeline with a cleared estimate",
    purpose: "Visual Direction's estimate cleared to unknown (a valid v0 patch), so v2 shows the unknown reaching its successors.",
    build: () => {
      const s = allViews();
      return s.apply("edit", { op: "updateTask", id: s.idOf("Visual Direction"), patch: { estimate: null } }).envelope();
    },
  },
];

/* ------------------------------------------------------------------ */
/* Output                                                              */
/* ------------------------------------------------------------------ */

const fileOf = (name: string) => `${name}.json`;

/** The document v0's store would hydrate from the main key, and whether its schema accepts it. */
function v0Load(kind: FixtureKind, content: unknown): FixtureEntry["v0Load"] {
  let raw: unknown;
  if (kind === "envelope") raw = content;
  else {
    const main = (content as StorageMap)[V0_KEY];
    if (main === undefined) return "absent";
    try {
      raw = JSON.parse(main);
    } catch {
      return "unreadable";
    }
  }
  // The store reads state.doc from the envelope; a bare document has no envelope, so it reads nothing
  const doc = (raw as Envelope | undefined)?.state?.doc;
  if (doc === undefined) return "unreadable";
  return DocSchema.safeParse(doc).success ? "valid" : "invalid";
}

const serialise = (content: unknown) => `${JSON.stringify(content, null, 2)}\n`;

function readme(entries: FixtureEntry[]): string {
  const rows = entries.map((e) => `| \`${e.file}\` | ${e.kind} | ${e.covers} | ${e.v0Load} | ${e.purpose.replace(/\|/g, "\\|")} |`);
  return [
    "# v0 fixtures",
    "",
    "Inputs for the v0 → v2 migration tests (plan §10.6) and for the Playwright baselines (§10.8).",
    "Generated by `scripts/fixtures/gen-v0.mts` through the frozen v0 code in `test/legacy/v0`, except the three audit documents, which the script only checks.",
    "Don't edit them by hand: change the script and run `npm run fixtures:v0` (`-- --check` verifies the committed files).",
    "",
    "- **envelope**: the parsed value v0 keeps under `form.workspace.v1` (`{ state: { doc, log }, version: 1 }`).",
    "- **storage**: raw localStorage strings by key, for the cases about how the value is stored.",
    "- **v0 load**: what v0's store makes of the main key: `valid` (DocSchema accepts it), `invalid` (v0 copies it to `.backup` and starts empty), `unreadable` (not JSON, or no envelope) or `absent`.",
    "",
    "| File | Kind | Covers | v0 load | Purpose |",
    "|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

/** Builds every fixture in memory: the manifest and the files to write (audit fixtures are read, never rebuilt). */
export function buildFixtures(): { entries: FixtureEntry[]; files: Record<string, string> } {
  const entries: FixtureEntry[] = [];
  const files: Record<string, string> = {};
  for (const spec of SPECS) {
    const file = fileOf(spec.name);
    let content: unknown;
    if (spec.build) {
      content = seeded(spec.name, spec.build);
      files[file] = serialise(content);
    } else {
      const path = FIXTURE_DIR + file;
      if (!existsSync(path)) throw new Error(`Audit fixture ${file} is missing`);
      content = JSON.parse(readFileSync(path, "utf8"));
    }
    entries.push({ name: spec.name, file, kind: spec.kind, source: spec.build ? "generated" : "audit", covers: spec.covers, purpose: spec.purpose, v0Load: v0Load(spec.kind, content) });
  }
  files["manifest.json"] = serialise(entries);
  files["README.md"] = readme(entries);
  return { entries, files };
}

function main() {
  // v0 reads dates in local time
  process.env.TZ = "Europe/Rome";
  const check = process.argv.includes("--check");
  const { entries, files } = buildFixtures();
  const stale: string[] = [];
  for (const [file, text] of Object.entries(files)) {
    const path = FIXTURE_DIR + file;
    const current = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (current === text) continue;
    if (check) stale.push(file);
    else writeFileSync(path, text);
  }
  if (check && stale.length) {
    console.error(`Out of date: ${stale.join(", ")}. Run npm run fixtures:v0.`);
    process.exit(1);
  }
  for (const e of entries) console.log(`${e.source === "audit" ? "checked " : check ? "matches " : "wrote   "} ${e.file.padEnd(28)} ${e.v0Load.padEnd(10)} ${e.covers}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
