import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 43); Phase 1 step 10e (proposals) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: proposalId, items[]
 * - Caption: "Suggested estimates for 6 tasks"
 */
export default stubOp({
  name: "proposeEstimates",
  scope: "project",
  family: "10e",
  deprecates: [],
  transport: { tool: "propose", action: "estimates" },
});
