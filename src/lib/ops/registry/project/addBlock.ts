import { z } from "zod";
import { BLOCK_ORDER, type BlockKind, BlockKind as BlockKindSchema } from "@/lib/domain/schema/primitives";
import type { ProjectDoc } from "@/lib/domain/schema/project";
import { defineOp } from "@/lib/ops/registry/_contract";
import { part, setIfChanged } from "@/lib/ops/registry/_helpers";
import { blockAlready, moodCount, references } from "@/lib/ops/registry/_views";

/**
 * Shows a block on the project page (plan §4.4 row 51). Blocks are kept in BLOCK_ORDER, so the
 * new one lands in its canonical place (plan §5.6); a block already shown is a no-op, and header
 * and collection are always shown. A moodboard that comes back with its references says so.
 */

const ADDED: Readonly<Record<Exclude<BlockKind, "moodboard">, string>> = {
  header: "Project header added",
  metrics: "Metrics added",
  progress: "Project progress indicator added",
  collection: "Tasks added",
  budget: "Budget added",
  activity: "Activity added",
};

function addedText(block: BlockKind, after: ProjectDoc): string {
  if (block !== "moodboard") return ADDED[block];
  const n = moodCount(after);
  return n > 0 ? `Moodboard back · ${references(n)}` : "Moodboard added · drop, paste or browse images";
}

export default defineOp({
  name: "addBlock",
  scope: "project",
  schema: z.object({ op: z.literal("addBlock"), block: BlockKindSchema }).strict(),

  reduce(d, op) {
    if (d.blocks.includes(op.block)) return;
    setIfChanged(
      d,
      "blocks",
      BLOCK_ORDER.filter((b) => b === op.block || d.blocks.includes(b)),
    );
  },

  caption: ({ op, after }) => part(addedText(op.block, after)),
  noopCaption({ op }) {
    if (op.block === "header") return "The project header is always shown";
    if (op.block === "collection") return "The tasks are always shown";
    return blockAlready(op.block, "shown");
  },

  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: ["addBlock"],
  parser: { family: "layout", examples: [{ say: "Show the overall progress", fixture: "demo" }] },
  palette: [
    { group: "Layout", phrase: "Add a progress indicator", rank: 60, needs: "project", fixture: "demo", surfaces: ["demo", "app"] },
    { group: "Moodboard", phrase: "Add a moodboard for the project", rank: 10, needs: "project", fixture: "demo", surfaces: ["demo", "app"] },
  ],
  transport: { tool: "block", field: "visible" },
  sample: () => ({ op: "addBlock", block: "progress" }),
});
