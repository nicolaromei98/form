import { normaliseHex } from "@/lib/domain/colours";
import { parseIsoDate } from "@/lib/domain/dates";
import {
  BRIEF_BASIS,
  BRIEF_LINES_MAX,
  BRIEF_TEXT_MAX,
  CENTS_MAX,
  COLUMNS_MAX,
  ESTIMATE_MAX_DAYS,
  MOOD_MAX,
  MOOD_TEXT,
  PERSON_NAME,
  PERSON_ROLE,
  PROJECT_TITLE,
  PROPOSAL_ITEMS_MAX,
  STEP_TITLE,
  TASK_TITLE,
} from "@/lib/domain/limits";
import { clampBox, MOOD_DEFAULT_SIZE, MOOD_PAD, type MoodBox } from "@/lib/domain/mood-geometry";
import { toCents } from "@/lib/domain/money";
import {
  Audience,
  BLOCK_ORDER,
  type BlockKind,
  BriefSection,
  type IsoDate,
  MoodKind,
  Priority,
  SortKey,
  Status,
  ViewKind,
} from "@/lib/domain/schema/primitives";

/**
 * The lenient salvage reader for v0 documents (plan §7.2 step 1). v0 kept one document under
 * `localStorage["form.workspace.v1"]`, with no `schemaVersion`; this module turns whatever is stored
 * there into a well-typed `V0Doc` and never throws. Each field is read on its own (a "catch" per
 * field and per item): a value v0 couldn't have written, or one past a v2 limit, is coerced to the
 * nearest value v2 accepts, and every coercion is written down through `SalvageNotes`.
 *
 * It reads three kinds of input:
 * - v0 shapes: what v0's `DocSchema` accepts, including the fields its schema defaulted (task
 *   owners, mood, people, plan, brief), which are not coercions;
 * - legacy shapes: documents saved before `tool.views` existed, read like v0's `migrateViews`
 *   (the view on screen becomes the only view);
 * - over-limit values that v0 stored before the safety patch: an 80+ character project title,
 *   21 people, 216 mood items, boxes outside the board.
 *
 * Text that becomes a v2 `Line` is put on one line, trimmed and cut at the limit; text that is
 * empty afterwards gets a neutral title or drops its item. The v2 cross-references (ids, owners,
 * steps, brief keys) are resolved later, in `to-v2.ts`.
 */

/* ------------------------------------------------------------------
   v0 facts
   ------------------------------------------------------------------ */

/** The v0 sample team: ids the template minted, with the names it gave them (Q4) */
export const V0_SAMPLE_TEAM = { "p-marta": "Marta", "p-sara": "Sara", "p-luca": "Luca" } as const;
export type V0SampleId = keyof typeof V0_SAMPLE_TEAM;

/** v0's team cap, enforced by the safety patch: a larger saved team is cut by array order */
export const V0_PEOPLE_MAX = 20;

/** The blocks v0 knew; v2 adds budget and activity */
const V0_BLOCKS: readonly BlockKind[] = ["header", "metrics", "progress", "collection", "moodboard"];
/** v0's blocks for a new project */
const V0_DEFAULT_BLOCKS: readonly BlockKind[] = ["header", "metrics", "collection"];
/** Blocks every project shows */
const ALWAYS_BLOCKS: readonly BlockKind[] = ["header", "collection"];
/** v0 sort keys; v2 adds "due" */
const V0_SORTS: readonly SortKey[] = ["manual", "priority", "progress", "status", "title", "estimate"];
/** The longest IndexedDB key an asset alias may hold (DemoEnvelope.assetAliases) */
export const ASSET_KEY_MAX = 64;

export const UNTITLED_PROJECT = "Untitled project";
export const UNTITLED_TASK = "Untitled task";

/* ------------------------------------------------------------------
   The salvaged shape
   ------------------------------------------------------------------ */

export interface V0Tool {
  /** The v0 id ("tool-…"), or "" when none was stored: only the id map reads it */
  id: string;
  /** One trimmed line of 1–80 characters */
  title: string;
  /** A real date inside the IsoDate window, or null */
  startDate: IsoDate | null;
  startDateIsSample: boolean;
  /** Known, unique, with header and collection, in BLOCK_ORDER */
  blocks: BlockKind[];
  /** Known and unique, never empty, in creation order */
  views: ViewKind[];
}

export interface V0Task {
  /** The record key: v0 reducers looked tasks up by it */
  id: string;
  /** One trimmed line of 1–140 characters */
  title: string;
  status: Status;
  priority: Priority;
  /** An integer from 0 to 100 */
  progress: number;
  /** Working days in half days, 0.5–250, or null (unknown) */
  estimate: number | null;
  /** Integer cents, 0 to CENTS_MAX, or null (unknown) */
  costCents: number | null;
  parentId: string | null;
  emphasis: boolean;
  /** A v0 person id, resolved later */
  owner: string | null;
}

export interface V0View {
  representation: ViewKind;
  density: "comfortable" | "compact";
  layout: "grid" | "list";
  columns: number | null;
  sort: SortKey;
  hideDone: boolean;
  highlightUrgent: boolean;
  fields: { priority: boolean; estimate: boolean; progress: boolean };
  focusId: string | null;
  briefAudience: Audience;
  briefShort: boolean;
}

export interface V0Person {
  /** Null when the stored id wasn't a string: nothing can name this person */
  id: string | null;
  /** One trimmed line of 1–40 characters */
  name: string;
  role: string | null;
}

export interface V0MoodItem {
  id: string;
  kind: MoodKind;
  /** Inside the stored bounds, with x + w ≤ 1 */
  box: MoodBox;
  /** Images: the legacy IndexedDB key ("img-…"), 1–64 characters; otherwise null */
  asset: string | null;
  /** Lowercase "#rrggbb"; always set on a colour */
  hex: string | null;
  /** At most 400 characters; always set on a note */
  text: string | null;
}

export interface V0ProposalItem {
  id: string;
  title: string;
  estimate: number | null;
}

/** A pending breakdown of one task (v0 `proposal`) */
export interface V0Proposal {
  parentId: string;
  /** 1–12 items */
  items: V0ProposalItem[];
}

/** A pending workload plan (v0 `plan`) */
export interface V0Plan {
  moves: { taskId: string; to: string | null }[];
}

export interface V0BriefEdit {
  /** The v0 key, "<audience>:<sentence id>", rewritten later */
  key: string;
  /** At most 600 characters; "" hides the sentence */
  text: string;
  /** At most 4,000 characters */
  basis: string;
}

export interface V0BriefLine {
  id: string;
  audience: Audience;
  section: BriefSection;
  /** Trimmed, 1–600 characters */
  text: string;
}

export interface V0Doc {
  tool: V0Tool | null;
  /** In record order (v0's `Object.values`) */
  tasks: V0Task[];
  /** As stored: filtered against the tasks later */
  order: string[];
  view: V0View;
  proposal: V0Proposal | null;
  /** Stacking order, bottom first; at most 200 */
  mood: V0MoodItem[];
  /** Array order; at most 20 */
  people: V0Person[];
  plan: V0Plan | null;
  brief: { edits: V0BriefEdit[]; lines: V0BriefLine[] };
}

/** Where the salvage writes what it changed (`MigrationReport.salvaged` and `.dropped`) */
export interface SalvageNotes {
  /** `was` and `now` are already described (`show`) */
  salvaged(path: string, was: string, now: string): void;
  dropped(what: string, why: string): void;
}

/* ------------------------------------------------------------------
   Shapes of the stored value
   ------------------------------------------------------------------ */

type Rec = Record<string, unknown>;

export function isRecord(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An own property, never an inherited one ("constructor", "toString") */
function own(rec: Rec, key: string): unknown {
  return Object.hasOwn(rec, key) ? rec[key] : undefined;
}

/**
 * The document and the change log inside a stored value: the zustand envelope
 * (`{ state: { doc, log }, version }`, what v0's store writes), the safety patch's backup
 * (`{ doc, log }`) or a bare document.
 */
export function unwrapV0(raw: unknown): { doc: unknown; log: unknown } {
  if (isRecord(raw)) {
    const state = own(raw, "state");
    if (isRecord(state) && Object.hasOwn(state, "doc")) return { doc: own(state, "doc"), log: own(state, "log") };
    if (Object.hasOwn(raw, "doc") && !Object.hasOwn(raw, "tool") && !Object.hasOwn(raw, "tasks")) {
      return { doc: own(raw, "doc"), log: own(raw, "log") };
    }
  }
  return { doc: raw, log: undefined };
}

/** A v0 document: it has `tool` and `tasks` and no `schemaVersion` (plan §7.1) */
export function isV0Doc(doc: unknown): doc is Rec {
  return isRecord(doc) && Object.hasOwn(doc, "tool") && Object.hasOwn(doc, "tasks") && !Object.hasOwn(doc, "schemaVersion");
}

/** Whether a stored value (any of the three shapes) holds a v0 document */
export function detectV0(raw: unknown): boolean {
  return isV0Doc(unwrapV0(raw).doc);
}

/* ------------------------------------------------------------------
   Coercion helpers
   ------------------------------------------------------------------ */

const SHOW_MAX = 80;

/** A short description of a stored value for the report: never the whole of a long value */
export function show(value: unknown): string {
  if (value === undefined) return "missing";
  if (typeof value === "string") {
    const chars = Array.from(value);
    return JSON.stringify(chars.length > SHOW_MAX ? `${chars.slice(0, SHOW_MAX - 1).join("")}…` : value);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) return String(value);
  if (Array.isArray(value)) return `a list of ${value.length}`;
  if (typeof value === "object") return "an object";
  return typeof value;
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** At most `max` UTF-16 code units, never splitting a surrogate pair */
export function cut(s: string, max: number): string {
  if (s.length <= max) return s;
  const code = s.charCodeAt(max - 1);
  return s.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

/** One trimmed line of at most `max` characters, possibly empty (v2 `Line`) */
export function toLine(s: string, max: number): string {
  return cut(s.replace(/[\r\n]+/g, " ").trim(), max).trim();
}

/** Trimmed text of at most `max` characters, line breaks kept, possibly empty (v2 `Text`) */
function toText(s: string, max: number): string {
  return cut(s.trim(), max).trim();
}

/** Half days in [0.5, 250]: the nearest half day, clamped (plan §7.2 step 1) */
export function toEstimate(v: number): number {
  return clamp(Math.round(v * 2) / 2, 0.5, ESTIMATE_MAX_DAYS);
}

function oneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === "string" && (options as readonly string[]).includes(value);
}

/** Reads one field of a record, coercing it and noting the change */
class Reader {
  constructor(
    private readonly notes: SalvageNotes,
    private readonly rec: Rec,
    private readonly path: string,
  ) {}

  raw(key: string): unknown {
    return own(this.rec, key);
  }

  /** Notes `was → now` when the stored value isn't the one kept */
  note(key: string, was: unknown, now: unknown): void {
    if (!Object.is(was, now)) this.notes.salvaged(`${this.path}.${key}`, show(was), show(now));
  }

  /** Notes a change already described in words */
  noteText(key: string, was: string, now: string): void {
    this.notes.salvaged(`${this.path}.${key}`, was, now);
  }

  enumOf<T extends string>(key: string, options: readonly T[], fallback: T): T {
    const v = this.raw(key);
    if (oneOf(v, options)) return v;
    this.note(key, v, fallback);
    return fallback;
  }

  bool(key: string, fallback: boolean, quietWhenMissing = false): boolean {
    const v = this.raw(key);
    if (typeof v === "boolean") return v;
    if (!(quietWhenMissing && v === undefined)) this.note(key, v, fallback);
    return fallback;
  }

  /** A line of 1–max characters, or `fallback` when nothing is left */
  line(key: string, max: number, fallback: string): string {
    const v = this.raw(key);
    const now = typeof v === "string" ? toLine(v, max) || fallback : fallback;
    this.note(key, v, now);
    return now;
  }

  /** A line of 1–max characters, or null (not noted: the caller drops the item) */
  lineOrNull(key: string, max: number): string | null {
    const v = this.raw(key);
    const now = typeof v === "string" ? toLine(v, max) : "";
    if (!now) return null;
    this.note(key, v, now);
    return now;
  }

  /** A string id, or null */
  optionalString(key: string, quietWhenMissing: boolean): string | null {
    const v = this.raw(key);
    if (typeof v === "string") return v;
    if (!(v === null || (quietWhenMissing && v === undefined))) this.note(key, v, null);
    return null;
  }

  /** An estimate (half days in [0.5, 250]) or null */
  estimate(key: string): number | null {
    const v = this.raw(key);
    const now = isNumber(v) ? toEstimate(v) : null;
    this.note(key, v, now);
    return now;
  }
}

/* ------------------------------------------------------------------
   The document
   ------------------------------------------------------------------ */

/**
 * Salvages a v0 document (a record without `schemaVersion`). Total: every field is read on its
 * own, and anything unusable becomes its v0 default or is dropped, with a note.
 */
export function salvageV0(doc: Rec, notes: SalvageNotes): V0Doc {
  const view = salvageView(own(doc, "view"), notes);
  return {
    tool: salvageTool(own(doc, "tool"), view.representation, notes),
    tasks: salvageTasks(own(doc, "tasks"), notes),
    order: salvageOrder(own(doc, "order"), notes),
    view,
    proposal: salvageProposal(own(doc, "proposal"), notes),
    mood: salvageMood(own(doc, "mood"), notes),
    people: salvagePeople(own(doc, "people"), notes),
    plan: salvagePlan(own(doc, "plan"), notes),
    brief: salvageBrief(own(doc, "brief"), notes),
  };
}

/** "[header, metrics]": a short list of stored values for the report */
function showList(values: readonly unknown[]): string {
  const shown = values.slice(0, 8).map((v) => (typeof v === "string" ? v : show(v)));
  return `[${shown.join(", ")}${values.length > 8 ? ", …" : ""}]`;
}

/** A list stored where v0 kept one; a missing or null list is v0's default (empty) */
function listAt(raw: unknown, path: string, notes: SalvageNotes, nullIsDefault: boolean): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!(raw === undefined || (raw === null && nullIsDefault))) notes.salvaged(path, show(raw), "[]");
  return [];
}

function salvageTool(raw: unknown, representation: ViewKind, notes: SalvageNotes): V0Tool | null {
  if (raw === null || raw === undefined) return null;
  if (!isRecord(raw)) {
    notes.dropped("the project", `its saved value is ${show(raw)}, not a project`);
    return null;
  }
  const r = new Reader(notes, raw, "tool");

  const storedDate = r.raw("startDate");
  const startDate = typeof storedDate === "string" ? parseIsoDate(storedDate) : null;
  r.note("startDate", storedDate, startDate);

  const id = r.raw("id");
  return {
    id: typeof id === "string" ? id : "",
    title: r.line("title", PROJECT_TITLE, UNTITLED_PROJECT),
    startDate,
    // Unknown whether the date was chosen: treat it as a sample, so nothing reads as late
    startDateIsSample: r.bool("startDateIsSample", true),
    blocks: salvageBlocks(r),
    views: salvageViews(r, representation),
  };
}

function salvageBlocks(r: Reader): BlockKind[] {
  const raw = r.raw("blocks");
  if (!Array.isArray(raw)) {
    r.noteText("blocks", show(raw), showList(V0_DEFAULT_BLOCKS));
    return [...V0_DEFAULT_BLOCKS];
  }
  const kept = new Set<BlockKind>(raw.filter((b): b is BlockKind => oneOf(b, V0_BLOCKS)));
  for (const b of ALWAYS_BLOCKS) kept.add(b);
  const blocks = BLOCK_ORDER.filter((b) => kept.has(b));
  if (blocks.length !== raw.length || blocks.some((b, i) => b !== raw[i])) r.noteText("blocks", showList(raw), showList(blocks));
  return blocks;
}

/** v0's `migrateViews`: a document saved before views were created one by one keeps the view on screen */
function salvageViews(r: Reader, representation: ViewKind): ViewKind[] {
  const raw = r.raw("views");
  if (!Array.isArray(raw)) {
    r.noteText("views", show(raw), showList([representation]));
    return [representation];
  }
  const views = [...new Set(raw.filter((v): v is ViewKind => oneOf(v, ViewKind.options)))];
  if (views.length === 0) views.push(representation);
  if (views.length !== raw.length || views.some((v, i) => v !== raw[i])) r.noteText("views", showList(raw), showList(views));
  return views;
}

const DEFAULT_V0_VIEW: V0View = {
  representation: "cards",
  density: "comfortable",
  layout: "grid",
  columns: null,
  sort: "manual",
  hideDone: false,
  highlightUrgent: false,
  fields: { priority: true, estimate: true, progress: true },
  focusId: null,
  briefAudience: "client",
  briefShort: false,
};

function salvageView(raw: unknown, notes: SalvageNotes): V0View {
  if (!isRecord(raw)) {
    notes.salvaged("view", show(raw), "the default view");
    return { ...DEFAULT_V0_VIEW, fields: { ...DEFAULT_V0_VIEW.fields } };
  }
  const r = new Reader(notes, raw, "view");
  const columnsRaw = r.raw("columns");
  const columns = isNumber(columnsRaw) ? clamp(Math.round(columnsRaw), 1, COLUMNS_MAX) : null;
  r.note("columns", columnsRaw, columns);

  const fieldsRaw = r.raw("fields");
  const f = new Reader(notes, isRecord(fieldsRaw) ? fieldsRaw : {}, "view.fields");
  if (!isRecord(fieldsRaw)) r.noteText("fields", show(fieldsRaw), "all shown");

  return {
    representation: r.enumOf("representation", ViewKind.options, "cards"),
    density: r.enumOf("density", ["comfortable", "compact"] as const, "comfortable"),
    layout: r.enumOf("layout", ["grid", "list"] as const, "grid"),
    columns,
    sort: r.enumOf("sort", V0_SORTS, "manual"),
    hideDone: r.bool("hideDone", false),
    highlightUrgent: r.bool("highlightUrgent", false),
    fields: {
      priority: f.bool("priority", true, !isRecord(fieldsRaw)),
      estimate: f.bool("estimate", true, !isRecord(fieldsRaw)),
      progress: f.bool("progress", true, !isRecord(fieldsRaw)),
    },
    // Optional in v0: missing means "FORM decides", the client brief, the full brief
    focusId: r.optionalString("focusId", true),
    briefAudience: r.raw("briefAudience") === undefined ? "client" : r.enumOf("briefAudience", Audience.options, "client"),
    briefShort: r.bool("briefShort", false, true),
  };
}

function salvageTasks(raw: unknown, notes: SalvageNotes): V0Task[] {
  if (!isRecord(raw)) {
    notes.salvaged("tasks", show(raw), "no tasks");
    return [];
  }
  const out: V0Task[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value)) {
      notes.dropped(`task ${show(key)}`, `its saved value is ${show(value)}, not a task`);
      continue;
    }
    out.push(salvageTask(key, value, notes));
  }
  return out;
}

function salvageTask(key: string, raw: Rec, notes: SalvageNotes): V0Task {
  const r = new Reader(notes, raw, `tasks.${key}`);
  const id = r.raw("id");
  if (id !== key) r.note("id", id, key);

  const progressRaw = r.raw("progress");
  const progress = isNumber(progressRaw) ? Math.round(clamp(progressRaw, 0, 100)) : 0;
  r.note("progress", progressRaw, progress);

  const costRaw = r.raw("cost");
  const cents = isNumber(costRaw) && costRaw >= 0 ? toCents(costRaw) : null;
  const costCents = cents !== null && cents <= CENTS_MAX ? cents : null;
  if (costCents === null) r.note("cost", costRaw, null);

  return {
    id: key,
    title: r.line("title", TASK_TITLE, UNTITLED_TASK),
    status: r.enumOf("status", Status.options, "todo"),
    priority: r.enumOf("priority", Priority.options, "medium"),
    progress,
    estimate: r.estimate("estimate"),
    costCents,
    parentId: r.optionalString("parentId", true),
    emphasis: r.bool("emphasis", false),
    // v0's schema defaulted a missing owner to null (saves from before teams existed)
    owner: r.optionalString("owner", true),
  };
}

function salvageOrder(raw: unknown, notes: SalvageNotes): string[] {
  const list = listAt(raw, "order", notes, false);
  const ids = list.filter((id): id is string => typeof id === "string");
  if (ids.length !== list.length) notes.salvaged("order", show(list), show(ids));
  return ids;
}

function salvageProposal(raw: unknown, notes: SalvageNotes): V0Proposal | null {
  if (raw === null || raw === undefined) return null;
  if (!isRecord(raw)) {
    notes.dropped("the pending breakdown", `its saved value is ${show(raw)}`);
    return null;
  }
  const parentId = own(raw, "parentId");
  if (typeof parentId !== "string") {
    notes.dropped("the pending breakdown", "it names no task");
    return null;
  }
  const items: V0ProposalItem[] = [];
  listAt(own(raw, "items"), "proposal.items", notes, false).forEach((item, i) => {
    if (!isRecord(item)) {
      notes.dropped(`breakdown item ${i + 1}`, `its saved value is ${show(item)}`);
      return;
    }
    const r = new Reader(notes, item, `proposal.items[${i}]`);
    const title = r.lineOrNull("title", STEP_TITLE);
    if (!title) {
      notes.dropped(`breakdown item ${i + 1}`, "it has no title");
      return;
    }
    const id = r.raw("id");
    items.push({ id: typeof id === "string" ? id : "", title, estimate: r.estimate("estimate") });
  });
  if (items.length > PROPOSAL_ITEMS_MAX) {
    notes.dropped(`${items.length - PROPOSAL_ITEMS_MAX} breakdown items`, `a breakdown holds at most ${PROPOSAL_ITEMS_MAX}`);
    items.length = PROPOSAL_ITEMS_MAX;
  }
  if (items.length === 0) {
    notes.dropped("the pending breakdown", "it has no items left");
    return null;
  }
  return { parentId, items };
}

function salvagePlan(raw: unknown, notes: SalvageNotes): V0Plan | null {
  if (raw === null || raw === undefined) return null;
  if (!isRecord(raw)) {
    notes.dropped("the pending workload plan", `its saved value is ${show(raw)}`);
    return null;
  }
  const moves: V0Plan["moves"] = [];
  listAt(own(raw, "moves"), "plan.moves", notes, false).forEach((move, i) => {
    const taskId = isRecord(move) ? own(move, "taskId") : undefined;
    if (!isRecord(move) || typeof taskId !== "string") {
      notes.dropped(`workload move ${i + 1}`, "it names no task");
      return;
    }
    const to = own(move, "to");
    if (!(typeof to === "string" || to === null)) notes.salvaged(`plan.moves[${i}].to`, show(to), "null");
    moves.push({ taskId, to: typeof to === "string" ? to : null });
  });
  if (moves.length === 0) {
    notes.dropped("the pending workload plan", "it has no moves");
    return null;
  }
  return { moves };
}

const MOOD_COORDS = ["x", "y", "w", "h", "r"] as const;

function salvageMood(raw: unknown, notes: SalvageNotes): V0MoodItem[] {
  const out: V0MoodItem[] = [];
  listAt(raw, "mood", notes, true).forEach((item, i) => {
    const what = `moodboard item ${i + 1}`;
    if (!isRecord(item)) {
      notes.dropped(what, `its saved value is ${show(item)}`);
      return;
    }
    const r = new Reader(notes, item, `mood[${i}]`);
    const kind = r.raw("kind");
    if (!oneOf(kind, MoodKind.options)) {
      notes.dropped(what, `${show(kind)} isn't an image, a colour or a note`);
      return;
    }

    // What the item shows: an item without it is dropped before anything else is noted
    const assetRaw = r.raw("asset");
    const hexRaw = r.raw("hex");
    const hex = typeof hexRaw === "string" ? normaliseHex(hexRaw) : null;
    if (kind === "image" && (typeof assetRaw !== "string" || assetRaw.length === 0 || assetRaw.length > ASSET_KEY_MAX)) {
      notes.dropped(what, "the image names no stored file");
      return;
    }
    if (kind === "color" && hex === null) {
      notes.dropped(what, `the colour ${show(hexRaw)} isn't a hex colour`);
      return;
    }
    const asset = kind === "image" && typeof assetRaw === "string" ? assetRaw : null;
    if (kind !== "image" && assetRaw !== null && assetRaw !== undefined) r.note("asset", assetRaw, null);
    if (hexRaw !== undefined) r.note("hex", hexRaw, hex);

    const size = MOOD_DEFAULT_SIZE[kind];
    const fallback = { x: MOOD_PAD, y: MOOD_PAD, w: size.w, h: size.h, r: 0 };
    const stored = {} as Record<(typeof MOOD_COORDS)[number], number>;
    for (const c of MOOD_COORDS) {
      const v = r.raw(c);
      stored[c] = isNumber(v) ? v : fallback[c];
      r.note(c, v, stored[c]);
    }
    const box = clampBox(stored);
    for (const c of MOOD_COORDS) r.note(c, stored[c], box[c]);

    const textRaw = r.raw("text");
    let text = typeof textRaw === "string" ? cut(textRaw, MOOD_TEXT) : null;
    if (kind === "note" && text === null) text = "";
    if (!(textRaw === undefined && text === null)) r.note("text", textRaw, text);

    const id = r.raw("id");
    out.push({ id: typeof id === "string" ? id : "", kind, box, asset, hex, text });
  });
  if (out.length > MOOD_MAX) {
    notes.dropped(`${out.length - MOOD_MAX} moodboard items`, `a moodboard holds at most ${MOOD_MAX}; the last ones added go`);
    out.length = MOOD_MAX;
  }
  return out;
}

function salvagePeople(raw: unknown, notes: SalvageNotes): V0Person[] {
  const out: V0Person[] = [];
  listAt(raw, "people", notes, true).forEach((item, i) => {
    if (!isRecord(item)) {
      notes.dropped(`person ${i + 1}`, `their saved value is ${show(item)}`);
      return;
    }
    const r = new Reader(notes, item, `people[${i}]`);
    const name = r.lineOrNull("name", PERSON_NAME);
    if (!name) {
      notes.dropped(`person ${i + 1}`, "they have no name");
      return;
    }
    const roleRaw = r.raw("role");
    const role = typeof roleRaw === "string" ? toLine(roleRaw, PERSON_ROLE) || null : null;
    if (!(roleRaw === undefined && role === null)) r.note("role", roleRaw, role);
    out.push({ id: r.optionalString("id", false), name, role });
  });
  if (out.length > V0_PEOPLE_MAX) {
    for (const p of out.slice(V0_PEOPLE_MAX)) notes.dropped(`person ${p.name}`, `the v0 team holds at most ${V0_PEOPLE_MAX} people`);
    out.length = V0_PEOPLE_MAX;
  }
  return out;
}

function salvageBrief(raw: unknown, notes: SalvageNotes): V0Doc["brief"] {
  const brief: V0Doc["brief"] = { edits: [], lines: [] };
  if (raw === undefined) return brief;
  if (!isRecord(raw)) {
    notes.salvaged("brief", show(raw), "an empty brief");
    return brief;
  }

  const edits = own(raw, "edits");
  if (isRecord(edits)) {
    for (const [key, edit] of Object.entries(edits)) {
      const text = isRecord(edit) ? own(edit, "text") : undefined;
      if (!isRecord(edit) || typeof text !== "string") {
        notes.dropped(`brief edit ${show(key)}`, "it holds no text");
        continue;
      }
      const r = new Reader(notes, edit, `brief.edits[${key}]`);
      const keptText = cut(text, BRIEF_TEXT_MAX);
      r.note("text", text, keptText);
      const basisRaw = r.raw("basis");
      const basis = typeof basisRaw === "string" ? cut(basisRaw, BRIEF_BASIS) : "";
      r.note("basis", basisRaw, basis);
      brief.edits.push({ key, text: keptText, basis });
    }
  } else if (edits !== undefined) notes.salvaged("brief.edits", show(edits), "no edits");

  listAt(own(raw, "lines"), "brief.lines", notes, false).forEach((line, i) => {
    const what = `brief line ${i + 1}`;
    if (!isRecord(line)) {
      notes.dropped(what, `its saved value is ${show(line)}`);
      return;
    }
    const r = new Reader(notes, line, `brief.lines[${i}]`);
    const audience = r.raw("audience");
    if (!oneOf(audience, Audience.options)) {
      notes.dropped(what, `${show(audience)} is neither the client nor the team`);
      return;
    }
    const textRaw = r.raw("text");
    const text = typeof textRaw === "string" ? toText(textRaw, BRIEF_TEXT_MAX) : "";
    if (!text) {
      notes.dropped(what, "it has no text");
      return;
    }
    r.note("text", textRaw, text);
    const id = r.raw("id");
    brief.lines.push({ id: typeof id === "string" ? id : "", audience, section: r.enumOf("section", BriefSection.options, "note"), text });
  });
  if (brief.lines.length > BRIEF_LINES_MAX) {
    notes.dropped(`${brief.lines.length - BRIEF_LINES_MAX} brief lines`, `a brief holds at most ${BRIEF_LINES_MAX}`);
    brief.lines.length = BRIEF_LINES_MAX;
  }
  return brief;
}
