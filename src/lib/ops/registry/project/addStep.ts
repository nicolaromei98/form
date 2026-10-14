import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 36); Phase 1 step 10a (tasks, steps, dependencies, pins, assignment, links, members, updateProject, rebalanceOrder) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: taskId, stepId, title, estimateDays|null, after: StepId|null|"end"
 * - Caption: "Step added to UI Design"
 */
export default stubOp({
  name: "addStep",
  scope: "project",
  family: "10a",
  deprecates: ["addTask"],
  transport: { tool: "step_edit", action: "add" },
});
