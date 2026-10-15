import type { BriefLineId } from "@/lib/domain/schema/ids";
import type { BlockKind } from "@/lib/domain/schema/primitives";
import type { ProjectDoc } from "@/lib/domain/schema/project";
import { type Rejection, reject } from "@/lib/ops/registry/_contract";

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
   Brief lines
   ------------------------------------------------------------------ */

export const LINE_GONE = "That brief line isn't there anymore.";

/** The index of one of the user's brief lines, or `not_found` */
export function lineIndex(d: ProjectDoc, id: BriefLineId): number | Rejection {
  const i = d.brief.lines.findIndex((l) => l.id === id);
  return i >= 0 ? i : reject("not_found", LINE_GONE);
}
