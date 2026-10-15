import { z } from "zod";
import { ProposalId } from "@/lib/domain/schema/ids";
import type { Proposal } from "@/lib/domain/schema/proposal";
import { defineOp } from "@/lib/ops/registry/_contract";
import { part } from "@/lib/ops/registry/_helpers";

/**
 * Discards the pending proposal (plan §4.4 row 46; v0 discardProposal and discardReassign).
 * Nothing in the project moves. Naming a proposal that is no longer pending (already resolved
 * or replaced by a newer one) is a no-op, so a newer proposal is never thrown away by mistake.
 */

/** v0 called the reassign proposal "Plan"; the subtasks and plan proposals are "Proposal" */
const DISCARDED: Readonly<Record<Proposal["kind"], string>> = {
  subtasks: "Proposal discarded",
  reassign: "Plan discarded · nothing moved",
  leveling: "Leveling discarded · nothing moved",
  estimates: "Suggested estimates discarded",
  plan: "Proposal discarded",
};

export default defineOp({
  name: "discardProposal",
  scope: "project",
  schema: z.object({ op: z.literal("discardProposal"), proposalId: ProposalId }).strict(),

  reduce(d, op) {
    if (d.proposal !== null && d.proposal.id === op.proposalId) d.proposal = null;
  },

  caption: ({ before }) => part(before.proposal ? DISCARDED[before.proposal.kind] : "Proposal discarded", undefined, "done"),
  noopCaption: ({ before }) => (before.proposal === null ? "There's no proposal to discard" : "That proposal was already replaced"),
  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: ["discardProposal", "discardReassign"],
  parser: {
    family: "control",
    examples: [
      { say: "Discard", fixture: "demoProposal" },
      { say: "Never mind", fixture: "demoPlan" },
    ],
  },
  palette: { exempt: "The v0 palette has no discard phrase; the parser examples cover it." },
  transport: { tool: "proposal", action: "discard" },
  sampleOn: "demoProposal",
  sample: (fx) => {
    const pending = fx.project?.proposal;
    if (!pending) throw new Error(`Fixture ${fx.name} has no pending proposal`);
    return { op: "discardProposal", proposalId: pending.id };
  },
});
