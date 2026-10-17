import { z } from "zod";
import { BRIEF_TEXT_MAX } from "@/lib/domain/limits";
import { BriefLineId } from "@/lib/domain/schema/ids";
import { Text } from "@/lib/domain/schema/primitives";
import { defineOp, isRejection } from "@/lib/ops/registry/_contract";
import { part, setIfChanged } from "@/lib/ops/registry/_helpers";
import { fitsDoc, jsonBytes, lineIndex } from "@/lib/ops/registry/_views";

/**
 * Rewrites one of the user's own brief lines (plan §4.4 row 56). The text is never empty: an
 * emptied line becomes removeBriefLine at the producer. The same text again is a no-op; a longer
 * text that would take the project past 1 MB is refused (`limit`).
 */
export default defineOp({
  name: "updateBriefLine",
  scope: "project",
  schema: z.object({ op: z.literal("updateBriefLine"), lineId: BriefLineId, text: Text(BRIEF_TEXT_MAX) }).strict(),

  reduce(d, op) {
    const i = lineIndex(d, op.lineId);
    if (isRejection(i)) return i;
    const line = d.brief.lines[i];
    const tooLarge = fitsDoc(d, jsonBytes(op.text), jsonBytes(line.text));
    if (tooLarge) return tooLarge;
    setIfChanged(line, "text", op.text);
  },

  caption: () => part("Brief line updated"),
  noopCaption: () => "That line already says that",

  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: ["updateBriefLine"],
  parser: { exempt: "A direct edit in the brief: the user types over their own line." },
  palette: { exempt: "A direct edit in the brief: the user types over their own line." },
  transport: { tool: "brief", action: "editLine" },
  // The fixture's first line of the user's own; a fixture with none gives an id that names nothing
  sample: (fx, mint) => ({
    op: "updateBriefLine",
    lineId: fx.project?.brief.lines[0]?.id ?? mint("briefLine"),
    text: "Homepage preview moves to Monday.",
  }),
  sampleOn: "demoExtras",
});
