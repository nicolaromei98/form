import { z } from "zod";
import { arrange } from "@/lib/domain/mood-geometry";
import { sortedByZ } from "@/lib/domain/order";
import { MoodLayout } from "@/lib/domain/schema/primitives";
import { defineOp } from "@/lib/ops/registry/_contract";
import { part, setIfChanged } from "@/lib/ops/registry/_helpers";
import { itemCount, ItemIds, namedInZ, references } from "@/lib/ops/registry/_mood";

/**
 * Re-lays references out as a masonry, a grid or a collage (plan §4.4 row 64; v0 arrangeMood).
 * The op names its items (plan §13 #11), so a replay arranges only what the user saw: v0 lowers
 * to "every item on the board". The named items are arranged bottom first (z order) with the v0
 * arithmetic (`arrange`, which also clamps every box to the stored bounds: the v0 safety patch),
 * and only the fields that change are written. Items that are gone are skipped.
 *
 * Not idempotent: the layouts recompute sizes from each item's proportions, so arranging an
 * arranged board can move a box by a rounding error. It is a no-op when nothing moves (a board of
 * colours only, for one) or when none of the named items is on the board.
 */

const ARRANGED = ["x", "y", "w", "h", "r"] as const;

export default defineOp({
  name: "arrangeMood",
  scope: "project",
  schema: z.object({ op: z.literal("arrangeMood"), layout: MoodLayout, itemIds: ItemIds }).strict(),

  reduce(d, op) {
    const items = namedInZ(d, op.itemIds);
    const boxes = arrange(items, op.layout);
    for (const it of items) {
      const box = boxes.get(it.id)!;
      const draft = d.moodboard.items[it.id];
      for (const k of ARRANGED) setIfChanged(draft, k, box[k]);
    }
  },

  caption({ op, after }) {
    const n = namedInZ(after, op.itemIds).length;
    // v0's wording when the whole board was arranged ("Moodboard arranged as a masonry")
    if (n === itemCount(after)) return part(`Moodboard arranged as a ${op.layout}`);
    return part(`${references(n)} arranged as a ${op.layout}`);
  },
  noopCaption({ op, before }) {
    if (itemCount(before) === 0) return "Add a few references first — drop images onto the moodboard, or add notes and colours.";
    if (namedInZ(before, op.itemIds).length === 0) return "Those references aren't on the moodboard anymore";
    return `The moodboard is already arranged as a ${op.layout}`;
  },
  undoable: true,
  activity: "show",
  idempotent: false,
  deprecates: ["arrangeMood"],
  parser: { family: "mood", examples: [{ say: "Rearrange the moodboard", fixture: "demoMood3" }] },
  palette: [
    { group: "Moodboard", phrase: "Tidy up the moodboard", rank: 40, needs: "project", fixture: "demoMood3", surfaces: ["demo", "app"] },
    { group: "Moodboard", phrase: "Arrange the moodboard in a grid", rank: 50, needs: "project", fixture: "demoMood3", surfaces: ["demo", "app"] },
    { group: "Moodboard", phrase: "Arrange the moodboard as a collage", rank: 60, needs: "project", fixture: "demoMood3", surfaces: ["demo", "app"] },
  ],
  transport: { tool: "moodboard", action: "arrange" },
  sampleOn: "demoMood3",
  sample: (fx) => ({ op: "arrangeMood", layout: "collage", itemIds: sortedByZ(fx.project!.moodboard.items).map((it) => it.id) }),
});
