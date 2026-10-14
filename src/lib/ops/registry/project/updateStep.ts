import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 37); Phase 1 step 10a (tasks, steps, dependencies, pins, assignment, links, members, updateProject, rebalanceOrder) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: taskId, stepId, field: title|done|ownerId|estimateDays, value
 * - Caption: "QA pass done"
 */
export default stubOp({
  name: "updateStep",
  scope: "project",
  family: "10a",
  deprecates: ["updateTask"],
  transport: { tool: "step_edit" },
});
