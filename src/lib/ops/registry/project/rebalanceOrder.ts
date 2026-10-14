import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 66); Phase 1 step 10a (tasks, steps, dependencies, pins, assignment, links, members, updateProject, rebalanceOrder) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: keys: Record<TaskId, OrderKey>
 * - Caption: none (folded into its commit)
 */
export default stubOp({
  name: "rebalanceOrder",
  scope: "project",
  family: "10a",
  activity: "hide",
  deprecates: [],
  transport: { exempt: "System op: the command runner appends it, never a person or the agent." },
});
