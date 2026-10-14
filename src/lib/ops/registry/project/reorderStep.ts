import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 39); Phase 1 step 10a (tasks, steps, dependencies, pins, assignment, links, members, updateProject, rebalanceOrder) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: taskId, stepId, after: StepId|null
 * - Caption: "QA pass moved"
 */
export default stubOp({
  name: "reorderStep",
  scope: "project",
  family: "10a",
  deprecates: [],
  transport: { exempt: "Direct manipulation only: no agent tool drags or reorders." },
});
