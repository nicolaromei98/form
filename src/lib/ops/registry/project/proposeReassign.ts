import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 41); Phase 1 step 10e (proposals) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: proposalId, moves[]
 * - Caption: "Marta is 4d over capacity · 1 handover proposed. Review it on the team."
 */
export default stubOp({
  name: "proposeReassign",
  scope: "project",
  family: "10e",
  deprecates: ["proposeReassign"],
  transport: { tool: "propose", action: "reassign" },
});
