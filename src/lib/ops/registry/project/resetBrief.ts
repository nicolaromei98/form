import { z } from "zod";
import { compareKeys } from "@/lib/domain/order";
import { Audience } from "@/lib/domain/schema/primitives";
import { defineOp } from "@/lib/ops/registry/_contract";
import { part } from "@/lib/ops/registry/_helpers";

/**
 * Clears the user's edits and own lines from one audience's brief, back to FORM's version (plan
 * §4.4 row 58). The other audience's brief is untouched; a brief with nothing of the user's is a
 * no-op. Edits are deleted in key order, so patches never depend on record key order.
 */
export default defineOp({
  name: "resetBrief",
  scope: "project",
  schema: z.object({ op: z.literal("resetBrief"), audience: Audience }).strict(),

  reduce(d, op) {
    const prefix = `${op.audience}:`;
    for (const key of Object.keys(d.brief.edits).sort(compareKeys)) {
      if (key.startsWith(prefix)) delete d.brief.edits[key];
    }
    if (d.brief.lines.some((l) => l.audience === op.audience)) {
      d.brief.lines = d.brief.lines.filter((l) => l.audience !== op.audience);
    }
  },

  caption: ({ op }) => part(`Your edits to the ${op.audience} brief are cleared · FORM's version`),
  noopCaption: ({ op }) => `The ${op.audience} brief is already FORM's version`,

  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: ["resetBrief"],
  parser: { family: "brief", examples: [{ say: "Reset the team brief", fixture: "demo" }] },
  palette: [{ group: "Brief", phrase: "Reset the brief", rank: 60, needs: "project", fixture: "demo", surfaces: ["demo", "app"] }],
  transport: { tool: "brief", action: "reset" },
  sample: () => ({ op: "resetBrief", audience: "client" }),
  // Complete and unit-tested (views.test.ts runs the completeness checks on a fixture with brief
  // content), but no named fixture holds a brief edit or line yet, so the completeness test can't
  // apply the sample. The mark keeps the op out of the full-op checks until
  // test/fixtures/v2/named.ts gains one (reported by step 10b); then delete this line.
  stub: { family: "10b", until: 1 },
});
