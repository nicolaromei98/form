import { z } from "zod";
import { BRIEF_SENT_MAX } from "@/lib/domain/limits";
import { SnapshotId } from "@/lib/domain/schema/ids";
import { Audience } from "@/lib/domain/schema/primitives";
import { defineOp, reject } from "@/lib/ops/registry/_contract";
import { ensureFreshId, part } from "@/lib/ops/registry/_helpers";
import { fitsDoc, jsonBytes } from "@/lib/ops/registry/_views";

/**
 * Records that a brief was sent (plan §4.4 row 59). The body is a server row (`brief_snapshots`,
 * Phase 4); the project keeps only the reference, stamped with `ctx.now`. The producer mints the
 * snapshot id, so marking twice is a `duplicate_id`, never a second reference. At most 200
 * references are kept, within the project's 1 MB (`limit`).
 */

const AUDIENCE_LABEL = { client: "Client", team: "Team" } as const;

export default defineOp({
  name: "markBriefSent",
  scope: "project",
  schema: z.object({ op: z.literal("markBriefSent"), audience: Audience, snapshotId: SnapshotId }).strict(),

  reduce(d, op, ctx) {
    if (d.brief.sent.length >= BRIEF_SENT_MAX) return reject("limit", `A project keeps at most ${BRIEF_SENT_MAX} sent briefs.`);
    const fresh = ensureFreshId(d, op.snapshotId);
    if (fresh) return fresh;
    const sent = { snapshotId: op.snapshotId, audience: op.audience, sentAt: ctx.now };
    const tooLarge = fitsDoc(d, jsonBytes(sent) + 1);
    if (tooLarge) return tooLarge;
    d.brief.sent.push(sent);
  },

  caption: ({ op }) => part(`${AUDIENCE_LABEL[op.audience]} brief marked as sent`),
  // Marking always records a fresh snapshot or refuses
  noopCaption: () => null,

  undoable: true,
  activity: "show",
  idempotent: false,
  deprecates: [],
  parser: { exempt: "Sending a brief arrives with the Phase 4 brief UI.", until: 4 },
  palette: { exempt: "Sending a brief arrives with the Phase 4 brief UI.", until: 4 },
  transport: { tool: "brief", action: "markSent" },
  sample: (_fx, mint) => ({ op: "markBriefSent", audience: "client", snapshotId: mint("snapshot") }),
});
