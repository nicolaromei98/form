import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 45); Phase 1 step 10e (proposals) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: proposalId, only?: string[]
 * - Caption: "4 steps added to UI Design" · "1 task reassigned" · rejected stale_proposal
 */
export default stubOp({
  name: "acceptProposal",
  scope: "project",
  family: "10e",
  deprecates: ["acceptProposal","acceptReassign"],
  transport: { tool: "proposal", action: "accept" },
});
