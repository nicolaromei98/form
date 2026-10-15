import { z } from "zod";
import { SECTION_LABEL } from "@/lib/domain/labels";
import { BRIEF_LINES_MAX, BRIEF_TEXT_MAX } from "@/lib/domain/limits";
import { BriefLineId } from "@/lib/domain/schema/ids";
import { Audience, BriefSection, Text } from "@/lib/domain/schema/primitives";
import { defineOp, reject } from "@/lib/ops/registry/_contract";
import { ensureFreshId, part } from "@/lib/ops/registry/_helpers";
import { fitsDoc, jsonBytes } from "@/lib/ops/registry/_views";

/**
 * Adds a line in the user's own words to one audience's brief, under a section (plan §4.4 row 55).
 * The producer mints the line id; a taken one is refused (`duplicate_id`), never re-minted, so the
 * op isn't idempotent. Lines are appended; the brief holds at most 80 of them, and a line that
 * would take the project past 1 MB is refused (`limit`) rather than failing the commit gate.
 */
export default defineOp({
  name: "addBriefLine",
  scope: "project",
  schema: z
    .object({
      op: z.literal("addBriefLine"),
      lineId: BriefLineId,
      audience: Audience,
      section: BriefSection,
      text: Text(BRIEF_TEXT_MAX),
    })
    .strict(),

  reduce(d, op) {
    if (d.brief.lines.length >= BRIEF_LINES_MAX) return reject("limit", `The brief holds at most ${BRIEF_LINES_MAX} lines of your own.`);
    const fresh = ensureFreshId(d, op.lineId);
    if (fresh) return fresh;
    const line = { id: op.lineId, audience: op.audience, section: op.section, text: op.text };
    const tooLarge = fitsDoc(d, jsonBytes(line) + 1);
    if (tooLarge) return tooLarge;
    d.brief.lines.push(line);
  },

  caption: ({ op }) => part(`Added to the ${op.audience} brief · ${SECTION_LABEL[op.section]}`),
  // Adding always adds or refuses: a fresh id can't be there already
  noopCaption: () => null,

  undoable: true,
  activity: "show",
  idempotent: false,
  deprecates: ["addBriefLine"],
  parser: { family: "brief", examples: [{ say: "Add to the team brief under risks: copy is late", fixture: "demo" }] },
  palette: [
    { group: "Brief", phrase: "Add to the brief: homepage preview on Friday", rank: 50, needs: "project", fixture: "demo", surfaces: ["demo", "app"] },
  ],
  transport: { tool: "brief", action: "addLine" },
  sample: (_fx, mint) => ({
    op: "addBriefLine",
    lineId: mint("briefLine"),
    audience: "client",
    section: "next",
    text: "Homepage preview on Friday.",
  }),
});
