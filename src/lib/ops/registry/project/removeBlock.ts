import { z } from "zod";
import { type BlockKind, BlockKind as BlockKindSchema } from "@/lib/domain/schema/primitives";
import { PROTECTED_BLOCKS } from "@/lib/domain/schema/project";
import { type CaptionPart, defineOp, reject } from "@/lib/ops/registry/_contract";
import { captionKey, part } from "@/lib/ops/registry/_helpers";
import { blockAlready, moodCount, references } from "@/lib/ops/registry/_views";

/**
 * Hides a block (plan §4.4 row 52). Nothing it shows is deleted: a hidden moodboard keeps its
 * references. Header and collection always stay (`protected_block`); a block already hidden is a
 * no-op.
 *
 * Hiding the progress indicator speaks with setView's "Progress hidden" key: v0's "hide the
 * progress" hides the bars and the indicator together, and the two parts read as one.
 */

type Protected = "header" | "collection";

const REFUSED: Readonly<Record<Protected, string>> = {
  header: "The project header always stays on the page.",
  collection: "The tasks always stay on the page.",
};

const isProtected = (block: BlockKind): block is Protected => PROTECTED_BLOCKS.includes(block);

function hiddenPart(block: BlockKind, n: number): CaptionPart {
  switch (block) {
    case "moodboard":
      return part(n > 0 ? `Moodboard hidden · its ${references(n)} ${n === 1 ? "is" : "are"} kept` : "Moodboard hidden");
    case "progress":
      return part("Progress hidden", captionKey.viewOption("fields.progress"));
    case "metrics":
      return part("Metrics removed");
    case "budget":
      return part("Budget hidden");
    case "activity":
      return part("Activity hidden");
    // Protected blocks are refused before they can be hidden
    case "header":
    case "collection":
      return part(REFUSED[block]);
  }
}

export default defineOp({
  name: "removeBlock",
  scope: "project",
  schema: z.object({ op: z.literal("removeBlock"), block: BlockKindSchema }).strict(),

  reduce(d, op) {
    if (isProtected(op.block)) return reject("protected_block", REFUSED[op.block]);
    const i = d.blocks.indexOf(op.block);
    if (i < 0) return;
    d.blocks.splice(i, 1);
  },

  caption: ({ op, after }) => hiddenPart(op.block, moodCount(after)),
  noopCaption: ({ op }) => blockAlready(op.block, "hidden"),

  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: ["removeBlock"],
  parser: { family: "layout", examples: [{ say: "Hide the metrics", fixture: "demo" }] },
  palette: [{ group: "Moodboard", phrase: "Hide the moodboard", rank: 70, needs: "project", fixture: "demoMoodShown", surfaces: ["demo", "app"] }],
  transport: { tool: "block", field: "visible" },
  sampleOn: "demoMoodShown",
  sample: () => ({ op: "removeBlock", block: "moodboard" }),
});
