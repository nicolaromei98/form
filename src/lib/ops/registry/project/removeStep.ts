import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 38); Phase 1 step 10a (tasks, steps, dependencies, pins, assignment, links, members, updateProject, rebalanceOrder) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: taskId, stepId
 * - Caption: "QA pass removed"
 */
export default stubOp({
  name: "removeStep",
  scope: "project",
  family: "10a",
  deprecates: ["removeTask"],
  transport: { tool: "step_edit", action: "remove" },
});
