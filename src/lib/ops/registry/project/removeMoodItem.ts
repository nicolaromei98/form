import { z } from "zod";
import { sortedByZ } from "@/lib/domain/order";
import { MoodItemId } from "@/lib/domain/schema/ids";
import { defineOp, isRejection } from "@/lib/ops/registry/_contract";
import { part } from "@/lib/ops/registry/_helpers";
import { mustItem } from "@/lib/ops/registry/_mood";

/**
 * Removes one reference (plan §4.4 row 63; v0 removeMoodItem: × or Backspace on the selected
 * one). Its image stays in the asset store, as in v0; undo puts the item back where it was, at
 * the same height in the stack.
 */
export default defineOp({
  name: "removeMoodItem",
  scope: "project",
  schema: z.object({ op: z.literal("removeMoodItem"), itemId: MoodItemId }).strict(),

  reduce(d, op) {
    const found = mustItem(d, op.itemId);
    if (isRejection(found)) return found;
    delete d.moodboard.items[op.itemId];
  },

  caption: () => part("Reference removed"),
  // A reference is either there to remove or not_found: removing never leaves the board unchanged
  noopCaption: () => null,
  undoable: true,
  activity: "show",
  idempotent: false,
  deprecates: ["removeMoodItem"],
  parser: { exempt: "Direct only: × or Backspace on the selected reference; v0 had no command for it." },
  palette: { exempt: "Direct only: a single reference is removed on the board itself." },
  transport: { tool: "moodboard", action: "remove" },
  sampleOn: "demoMood3",
  sample: (fx) => ({ op: "removeMoodItem", itemId: sortedByZ(fx.project!.moodboard.items)[0].id }),
});
