import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 44); Phase 1 step 10e (proposals) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: proposalId, tasks: TaskSeed[] 1–12
 * - Caption: "Proposal · 8 tasks, no estimates yet"
 */
export default stubOp({
  name: "proposePlan",
  scope: "project",
  family: "10e",
  deprecates: [],
  transport: { tool: "propose", action: "plan" },
});
