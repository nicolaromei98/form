import { z } from "zod";
import { PROPOSAL_BULK_MAX } from "@/lib/domain/limits";
import { ProposalId } from "@/lib/domain/schema/ids";
import { LevelingMoveSchema } from "@/lib/domain/schema/proposal";
import { defineOp, isRejection } from "@/lib/ops/registry/_contract";
import { mustTask, part } from "@/lib/ops/registry/_helpers";
import { distinct, freshIds, mustBeOpen, plural, ProposalSource } from "@/lib/ops/registry/_proposals";

/**
 * Proposes new starts that keep every owner within a day's work (plan §4.4 row 42, §6.6
 * leveling). Each move pins one open task's start; nothing moves until the proposal is
 * accepted. The pending proposal is replaced, and undo restores it.
 *
 * - Payload: proposalId, moves {taskId, pinnedStart, days, why}[] 1–150, source
 * - Caption: "Leveling proposed · 3 starts move"
 */

export default defineOp({
  name: "proposeLeveling",
  scope: "project",
  schema: z
    .object({
      op: z.literal("proposeLeveling"),
      proposalId: ProposalId,
      moves: z
        .array(LevelingMoveSchema)
        .min(1)
        .max(PROPOSAL_BULK_MAX)
        .refine((moves) => distinct(moves.map((m) => m.taskId)), "Each task can be moved once"),
      source: ProposalSource,
    })
    .strict(),

  reduce(d, op, ctx) {
    for (const m of op.moves) {
      const task = mustTask(d, m.taskId);
      if (isRejection(task)) return task;
      const closed = mustBeOpen(task);
      if (closed) return closed;
    }
    const taken = freshIds(d, [op.proposalId]);
    if (taken) return taken;
    d.proposal = {
      id: op.proposalId,
      createdAt: ctx.now,
      source: op.source,
      kind: "leveling",
      moves: op.moves.map((m) => ({ ...m })),
    };
  },

  // "Leveling proposed · 3 starts move"
  caption: ({ op }) => {
    const n = op.moves.length;
    return part(`Leveling proposed · ${plural(n, "start")} move${n === 1 ? "s" : ""}`, undefined, "proposal");
  },
  // A proposal always carries a fresh id: proposing applies or is refused, never a no-op
  noopCaption: () => null,
  undoable: true,
  activity: "show",
  idempotent: false,
  deprecates: [],
  parser: { exempt: "Leveling has no command until the Phase 5 parser and agent.", until: 5 },
  palette: { exempt: "No palette phrase for leveling until the Phase 5 parser.", until: 5 },
  transport: { tool: "propose", action: "leveling" },
  sample: (fx, mint) => ({
    op: "proposeLeveling",
    proposalId: mint("proposal"),
    moves: [{ taskId: fx.task("Development"), pinnedStart: "2026-10-26", days: 2, why: "Luca is busy until then." }],
    source: "agent",
  }),
});
