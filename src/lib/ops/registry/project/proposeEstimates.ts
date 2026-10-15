import { z } from "zod";
import { PROPOSAL_BULK_MAX } from "@/lib/domain/limits";
import { ProposalId } from "@/lib/domain/schema/ids";
import { EstimateItemSchema } from "@/lib/domain/schema/proposal";
import { defineOp, isRejection, reject } from "@/lib/ops/registry/_contract";
import { formatDays, mustTask, part, title } from "@/lib/ops/registry/_helpers";
import { distinct, freshIds, ProposalSource } from "@/lib/ops/registry/_proposals";

/**
 * Suggests estimates (plan §4.4 row 43). They are shown as suggestions until accepted; only tasks
 * take one, since a milestone takes no time (plan §3.8 P9). The pending proposal is replaced, and
 * undo restores it.
 */

export default defineOp({
  name: "proposeEstimates",
  scope: "project",
  schema: z
    .object({
      op: z.literal("proposeEstimates"),
      proposalId: ProposalId,
      items: z
        .array(EstimateItemSchema)
        .min(1)
        .max(PROPOSAL_BULK_MAX)
        .refine((items) => distinct(items.map((i) => i.taskId)), "Each task gets one suggestion"),
      source: ProposalSource,
    })
    .strict(),

  reduce(d, op, ctx) {
    for (const item of op.items) {
      const task = mustTask(d, item.taskId);
      if (isRejection(task)) return task;
      if (task.kind !== "task") return reject("invalid_state", `${title(task.title)} is a milestone: it takes no time.`);
    }
    const taken = freshIds(d, [op.proposalId]);
    if (taken) return taken;
    d.proposal = {
      id: op.proposalId,
      createdAt: ctx.now,
      source: op.source,
      kind: "estimates",
      items: op.items.map((i) => ({ taskId: i.taskId, estimateDays: i.estimateDays })),
    };
  },

  // "Suggested estimates for 6 tasks"; one suggestion names its task and days
  caption({ op, after }) {
    const [first] = op.items;
    if (op.items.length === 1) {
      return part(`Suggested estimate for ${title(after.tasks[first.taskId].title)} · ${formatDays(first.estimateDays)}d`, undefined, "proposal");
    }
    return part(`Suggested estimates for ${op.items.length} tasks`, undefined, "proposal");
  },
  // A proposal always carries a fresh id: proposing applies or is refused, never a no-op
  noopCaption: () => null,
  undoable: true,
  activity: "show",
  idempotent: false,
  deprecates: [],
  parser: { exempt: "Suggested estimates come from the Phase 5 agent; there is no command yet.", until: 5 },
  palette: { exempt: "No palette phrase for suggested estimates until the Phase 5 parser.", until: 5 },
  transport: { tool: "propose", action: "estimates" },
  sampleOn: "demoUnestimated",
  sample: (fx, mint) => ({
    op: "proposeEstimates",
    proposalId: mint("proposal"),
    items: [{ taskId: fx.task("UI Design"), estimateDays: 6 }],
    source: "agent",
  }),
});
