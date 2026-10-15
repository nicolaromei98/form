import { z } from "zod";
import { BriefLineId } from "@/lib/domain/schema/ids";
import { defineOp, isRejection } from "@/lib/ops/registry/_contract";
import { part } from "@/lib/ops/registry/_helpers";
import { lineIndex } from "@/lib/ops/registry/_views";

/**
 * Removes one of the user's own brief lines (plan §4.4 row 57). A line is there to remove or
 * `not_found`, as with tasks, so removing never leaves the document unchanged.
 */
export default defineOp({
  name: "removeBriefLine",
  scope: "project",
  schema: z.object({ op: z.literal("removeBriefLine"), lineId: BriefLineId }).strict(),

  reduce(d, op) {
    const i = lineIndex(d, op.lineId);
    if (isRejection(i)) return i;
    d.brief.lines.splice(i, 1);
  },

  caption: () => part("Brief line removed"),
  // Removing always removes or refuses
  noopCaption: () => null,

  undoable: true,
  activity: "show",
  idempotent: false,
  deprecates: ["removeBriefLine"],
  parser: { exempt: "A direct action on the user's own brief line, not a typed command." },
  palette: { exempt: "A direct action on the user's own brief line, not a typed command." },
  transport: { tool: "brief", action: "hideLine" },
  // The fixture's first line of the user's own; a fixture with none gives an id that names nothing
  sample: (fx, mint) => ({ op: "removeBriefLine", lineId: fx.project?.brief.lines[0]?.id ?? mint("briefLine") }),
});
