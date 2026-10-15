import { z } from "zod";
import { normaliseHex } from "@/lib/domain/colours";
import { MOOD_TEXT } from "@/lib/domain/limits";
import { frontZ, type MoodBox, patchBox, topZ } from "@/lib/domain/mood-geometry";
import { sortedByZ } from "@/lib/domain/order";
import { MoodItemId } from "@/lib/domain/schema/ids";
import type { MoodItem } from "@/lib/domain/schema/project";
import { defineOp, isRejection, reject } from "@/lib/ops/registry/_contract";
import { baseOf, part, setIfChanged } from "@/lib/ops/registry/_helpers";
import { HexInput, mustItem } from "@/lib/ops/registry/_mood";

/**
 * A direct edit of one reference (plan §4.4 row 62; v0 updateMoodItem): drag, resize, rotate, a
 * note's text, a colour's hex or name, and `toFront` (v0 `raise`), which stacks it above every
 * other item with a new top z key computed at apply time (plan §5.6). Geometry is clamped to the
 * stored bounds exactly as v0 clamped it (`patchBox`). The UI commits it without a caption (v0
 * parity: direct edits are quiet); the caption below speaks only when another source sends it.
 */

const GEOMETRY = ["x", "y", "w", "h", "r"] as const satisfies readonly (keyof MoodBox)[];

const Patch = z
  .object({
    x: z.number().optional(),
    y: z.number().optional(),
    w: z.number().optional(),
    h: z.number().optional(),
    /** Degrees, clamped to ±15 */
    r: z.number().optional(),
    /** Colours only */
    hex: HexInput.optional(),
    /** A note's text, or a colour's name; null clears a name */
    text: z.string().max(MOOD_TEXT).nullable().optional(),
  })
  .strict();

/** What changed, for the caption: content first, then size, place, rotation and stacking */
function editCaption(before: MoodItem, after: MoodItem): string {
  if (after.kind === "note" && after.text !== before.text) return "Note edited";
  if (after.hex !== before.hex || after.text !== before.text) return after.kind === "color" ? "Colour updated" : "Reference updated";
  if (after.w !== before.w || after.h !== before.h) return "Reference resized";
  if (after.x !== before.x || after.y !== before.y) return "Reference moved";
  if (after.r !== before.r) return "Reference rotated";
  return "Reference brought to front";
}

export default defineOp({
  name: "updateMoodItem",
  scope: "project",
  schema: z
    .object({
      op: z.literal("updateMoodItem"),
      itemId: MoodItemId,
      patch: Patch,
      /** Stack it above every other reference (v0 `raise`: a moved item goes on top) */
      toFront: z.boolean(),
    })
    .strict(),

  reduce(d, op) {
    const found = mustItem(d, op.itemId);
    if (isRejection(found)) return found;
    const item = found;
    const base = baseOf(d).moodboard.items[op.itemId];
    const p = op.patch;
    if (p.hex !== undefined && base.kind !== "color") return reject("invalid_state", "Only a colour has a hex code.");
    if (p.text === null && base.kind === "note") return reject("invalid_state", "A note keeps its text: empty it, or remove the note.");

    if (GEOMETRY.some((k) => p[k] !== undefined)) {
      const box = patchBox(base, p);
      for (const k of GEOMETRY) setIfChanged(item, k, box[k]);
    }
    if (p.hex !== undefined) setIfChanged(item, "hex", normaliseHex(p.hex));
    if (p.text !== undefined) setIfChanged(item, "text", p.text);
    if (op.toFront) {
      // z keys are unique (invariant), so the top key belongs to one item: already on top is a no-op
      const board = sortedByZ(baseOf(d).moodboard.items);
      if (topZ(board) !== base.z) item.z = frontZ(board);
    }
  },

  caption: ({ op, before, after }) => part(editCaption(before.moodboard.items[op.itemId], after.moodboard.items[op.itemId])),
  noopCaption: () => "That reference already looks like that",
  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: ["updateMoodItem"],
  parser: { exempt: "Direct manipulation only: drag, resize, rotate or write on a reference on the board." },
  palette: { exempt: "Direct manipulation only: references are moved and edited on the board itself." },
  transport: { exempt: "Direct manipulation only: no agent tool drags or reorders." },
  sampleOn: "demoMood3",
  sample: (fx) => {
    const [bottom] = sortedByZ(fx.project!.moodboard.items);
    return { op: "updateMoodItem", itemId: bottom.id, patch: { x: 0.5, y: 0.4 }, toFront: true };
  },
});
