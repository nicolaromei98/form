import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 35); Phase 1 step 10a (tasks, steps, dependencies, pins, assignment, links, members, updateProject, rebalanceOrder) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: taskId
 * - Caption: "Visual Direction unassigned"
 */
export default stubOp({
  name: "unassignTask",
  scope: "project",
  family: "10a",
  deprecates: ["assignTask"],
  transport: { tool: "assign" },
});
