import { idKindOf } from "@/lib/domain/ids";
import { docBytes, utf8Length } from "@/lib/domain/invariants/check";
import { DOC_BYTES_MAX } from "@/lib/domain/limits";
import type { BriefLineId } from "@/lib/domain/schema/ids";
import type { BlockKind } from "@/lib/domain/schema/primitives";
import type { ProjectDoc } from "@/lib/domain/schema/project";
import { type Rejection, reject } from "@/lib/ops/registry/_contract";
import { baseOf } from "@/lib/ops/registry/_helpers";

/**
 * Helpers of the step 10b ops only: views, blocks, setFocus and the brief (`registry/README.md`).
 * No other family imports this module, and the ops never import each other.
 */

/* ------------------------------------------------------------------
   Blocks
   ------------------------------------------------------------------ */

/** "1 reference", "12 references" */
export function references(n: number): string {
  return `${n} reference${n === 1 ? "" : "s"}`;
}

/** Mood items on the board, shown or hidden */
export function moodCount(doc: ProjectDoc): number {
  return Object.keys(doc.moodboard.items).length;
}

/** How a block is named in a sentence, with its verb */
const BLOCK_SUBJECT: Readonly<Record<BlockKind, readonly [subject: string, verb: "is" | "are"]>> = {
  header: ["The project header", "is"],
  metrics: ["The metrics", "are"],
  progress: ["The progress indicator", "is"],
  collection: ["The tasks", "are"],
  moodboard: ["The moodboard", "is"],
  budget: ["The budget", "is"],
  activity: ["The activity", "is"],
};

/** "The moodboard is already hidden", "The metrics are already shown" */
export function blockAlready(block: BlockKind, state: "shown" | "hidden"): string {
  const [subject, verb] = BLOCK_SUBJECT[block];
  return `${subject} ${verb} already ${state}`;
}

/* ------------------------------------------------------------------
   Brief lines and edits
   ------------------------------------------------------------------ */

export const LINE_GONE = "That brief line isn't there anymore.";

/** The index of one of the user's brief lines, or `not_found` */
export function lineIndex(d: ProjectDoc, id: BriefLineId): number | Rejection {
  const i = d.brief.lines.findIndex((l) => l.id === id);
  return i >= 0 ? i : reject("not_found", LINE_GONE);
}

/**
 * Whether an edit key ("client:moving:tsk_…") names a task or a step the project doesn't have.
 * removeTask and removeStep delete the edits keyed to what they remove, so nothing may bring a
 * dangling one back. Person ids ("team:risks:load:per_…") live in the workspace and aren't checked.
 */
export function namesMissing(key: string, doc: ProjectDoc): boolean {
  let steps: Set<string> | null = null;
  for (const segment of key.split(":").slice(1)) {
    const kind = idKindOf(segment);
    if (kind === "task" && !Object.hasOwn(doc.tasks, segment)) return true;
    if (kind === "step") {
      steps ??= new Set(Object.values(doc.tasks).flatMap((t) => t.steps.map((s) => s.id)));
      if (!steps.has(segment)) return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------
   Document size
   ------------------------------------------------------------------ */

const BYTES = new WeakMap<object, number>();

/** The JSON byte length of a committed document, cached per document version */
function committedBytes(doc: ProjectDoc): number {
  let bytes = BYTES.get(doc);
  if (bytes === undefined) {
    bytes = docBytes(doc);
    BYTES.set(doc, bytes);
  }
  return bytes;
}

/** The JSON byte length of a value */
export function jsonBytes(value: unknown): number {
  return value === undefined ? 0 : utf8Length(JSON.stringify(value));
}

/** What a record entry takes in its JSON: `"key":value,` */
export function recordBytes(key: string, value: unknown): number {
  return jsonBytes(key) + jsonBytes(value) + 2;
}

export const TOO_LARGE = "That would take the project past its 1 MB limit.";

/**
 * `limit` when growing the committed document by `added` bytes and shrinking it by `removed`
 * would pass DOC_BYTES_MAX, so the brief ops refuse instead of failing the commit gate with
 * `invalid_result` (plan §5.6: a reducer rejects with `limit` rather than truncating text).
 */
export function fitsDoc(draft: ProjectDoc, added: number, removed = 0): Rejection | null {
  if (added <= removed) return null;
  return committedBytes(baseOf(draft)) - removed + added > DOC_BYTES_MAX ? reject("limit", TOO_LARGE) : null;
}
