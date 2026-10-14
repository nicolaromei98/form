import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 46); Phase 1 step 10e (proposals) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: proposalId
 * - Caption: "Proposal discarded" · "Plan discarded · nothing moved"
 */
export default stubOp({
  name: "discardProposal",
  scope: "project",
  family: "10e",
  deprecates: ["discardProposal","discardReassign"],
  transport: { tool: "proposal", action: "discard" },
});
