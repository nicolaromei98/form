import { z } from "zod";
import { sortedByZ } from "@/lib/domain/order";
import { defineOp } from "@/lib/ops/registry/_contract";
import { part } from "@/lib/ops/registry/_helpers";
import { itemCount, ItemIds, namedInZ, references } from "@/lib/ops/registry/_mood";

/**
 * Removes references in one go (plan §4.4 row 65; v0 clearMood). The op names its items (plan §13
 * #11): v0 lowers to "every item on the board", and a replay removes only what the user saw, never
 * a reference someone added since. Items that are gone are skipped, so clearing twice is a no-op.
 * The moodboard block stays, as in v0; undo brings every reference back.
 */
export default defineOp({
  name: "clearMood",
  scope: "project",
  schema: z.object({ op: z.literal("clearMood"), itemIds: ItemIds }).strict(),

  reduce(d, op) {
    // Bottom first, so the patches never depend on payload or record key order
    for (const it of namedInZ(d, op.itemIds)) delete d.moodboard.items[it.id];
  },

  caption({ before, after }) {
    const removed = references(itemCount(before) - itemCount(after));
    return part(itemCount(after) === 0 ? `Moodboard cleared · ${removed} removed` : `${removed} removed from the moodboard`);
  },
  noopCaption: ({ before }) => (itemCount(before) === 0 ? "The moodboard is already empty" : "Those references are already gone"),
  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: ["clearMood"],
  parser: { family: "mood", examples: [{ say: "Clear the moodboard", fixture: "demoMood3" }] },
  palette: { exempt: "The v0 palette has no clear phrase; the parser example covers it." },
  transport: { tool: "moodboard", action: "clear" },
  sampleOn: "demoMood3",
  sample: (fx) => ({ op: "clearMood", itemIds: sortedByZ(fx.project!.moodboard.items).map((it) => it.id) }),
});
