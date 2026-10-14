import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 34); Phase 1 step 10a (tasks, steps, dependencies, pins, assignment, links, members, updateProject, rebalanceOrder) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: taskId, personId (also adds to memberIds)
 * - Caption: "Development → Sara" · "Development is already with Sara"
 */
export default stubOp({
  name: "assignTask",
  scope: "project",
  family: "10a",
  deprecates: ["assignTask"],
  transport: { tool: "assign" },
});
