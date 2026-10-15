import { z } from "zod";
import { compareKeys } from "@/lib/domain/order";
import { BriefEditKey } from "@/lib/domain/schema/project";
import { defineOp } from "@/lib/ops/registry/_contract";
import { part, unique } from "@/lib/ops/registry/_helpers";

/**
 * Restores FORM's wording on one or more sentences of the brief (plan §4.4 row 54; v0 took one
 * key, v2 takes up to 80). Keys without an edit are skipped, so restoring twice is a no-op. Edits
 * are deleted in key order, so patches never depend on payload order.
 */

/** Keys one op may restore (plan §4.4 row 54) */
const KEYS_MAX = 80;

export default defineOp({
  name: "resetBriefLine",
  scope: "project",
  schema: z.object({ op: z.literal("resetBriefLine"), keys: z.array(BriefEditKey).min(1).max(KEYS_MAX) }).strict(),

  reduce(d, op) {
    for (const key of unique(op.keys).sort(compareKeys)) {
      if (Object.hasOwn(d.brief.edits, key)) delete d.brief.edits[key];
    }
  },

  caption({ op, before }) {
    const n = unique(op.keys).filter((k) => Object.hasOwn(before.brief.edits, k)).length;
    return part(n === 1 ? "FORM's wording restored" : `FORM's wording restored on ${n} lines`);
  },
  noopCaption: ({ op }) => (unique(op.keys).length === 1 ? "That line already reads as FORM wrote it" : "Those lines already read as FORM wrote them"),

  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: ["resetBriefLine"],
  parser: { exempt: "A direct action on an edited line of the brief, not a typed command." },
  palette: { exempt: "A direct action on an edited line of the brief, not a typed command." },
  transport: { tool: "brief", action: "reset" },
  // The first edit of the fixture's brief; a fixture with no edits gives a key that restores nothing
  sample: (fx) => ({
    op: "resetBriefLine",
    keys: [Object.keys(fx.project?.brief.edits ?? {}).sort(compareKeys)[0] ?? "client:head:status"],
  }),
  // Complete and unit-tested (views.test.ts runs the completeness checks on a fixture with brief
  // content), but no named fixture holds a brief edit yet, so the completeness test can't apply
  // the sample. The mark keeps the op out of the full-op checks until test/fixtures/v2/named.ts
  // gains one (reported by step 10b); then delete this line and point `sampleOn` at it.
  stub: { family: "10b", until: 1 },
});
