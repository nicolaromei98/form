import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 31); Phase 1 step 10a (tasks, steps, dependencies, pins, assignment, links, members, updateProject, rebalanceOrder) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: taskId, dependsOnId
 * - Caption: "Development no longer waits on QA"
 */
export default stubOp({
  name: "removeDependency",
  scope: "project",
  family: "10a",
  deprecates: [],
  transport: { tool: "task_dependency", action: "remove" },
});
