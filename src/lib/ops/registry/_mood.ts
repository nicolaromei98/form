import { z } from "zod";
import { MOOD_MAX } from "@/lib/domain/limits";
import { sortedByZ } from "@/lib/domain/order";
import { MoodItemId } from "@/lib/domain/schema/ids";
import { BLOCK_ORDER } from "@/lib/domain/schema/primitives";
import type { MoodItem, ProjectDoc } from "@/lib/domain/schema/project";
import { type Rejection, reject } from "@/lib/ops/registry/_contract";
import { baseOf, setIfChanged } from "@/lib/ops/registry/_helpers";

/**
 * What the moodboard ops (step 10c: addMoodItems, updateMoodItem, removeMoodItem, arrangeMood,
 * clearMood) share. Only those ops import this module; the geometry itself lives in
 * `domain/mood-geometry`, so it stays bit-for-bit what v0 computed.
 */

export const ITEM_GONE = "That reference isn't on the moodboard anymore.";

/**
 * A colour as producers send it: "#E4572E", "e4572e" or "#e52". The recipe stores it as lowercase
 * "#rrggbb" through `normaliseHex`, as v0 did, so the parser, the picker and the agent may pass
 * any of the three forms.
 */
export const HexInput = z.string().regex(/^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Use a hex colour like #e4572e");

/** Ids that name existing references (arrangeMood, clearMood): each one at most once */
export const ItemIds = z
  .array(MoodItemId)
  .max(MOOD_MAX)
  .refine((ids) => new Set(ids).size === ids.length, "Name each reference once");

/** The item, or `not_found` */
export function mustItem(d: ProjectDoc, id: MoodItem["id"]): MoodItem | Rejection {
  return Object.hasOwn(d.moodboard.items, id) ? d.moodboard.items[id] : reject("not_found", ITEM_GONE);
}

/**
 * The named items that are on the committed board, bottom first (z key, then id). Ids that are
 * gone are skipped, so a replay after someone else removed a reference still does the rest.
 */
export function namedInZ(doc: ProjectDoc, ids: readonly string[]): MoodItem[] {
  const named = new Set(ids);
  return sortedByZ(baseOf(doc).moodboard.items).filter((it) => named.has(it.id));
}

/** How many references the committed board holds */
export function itemCount(doc: ProjectDoc): number {
  return Object.keys(doc.moodboard.items).length;
}

/** "1 reference", "12 references" */
export function references(n: number): string {
  return `${n} reference${n === 1 ? "" : "s"}`;
}

/**
 * Shows the moodboard block if it was hidden, in the canonical block order: adding references
 * brings the board back (v0 `withBlock`).
 */
export function showBoard(d: ProjectDoc): void {
  if (d.blocks.includes("moodboard")) return;
  const blocks = new Set([...d.blocks, "moodboard"]);
  setIfChanged(d, "blocks", BLOCK_ORDER.filter((b) => blocks.has(b)));
}
