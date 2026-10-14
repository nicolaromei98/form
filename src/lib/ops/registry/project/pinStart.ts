import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 32); Phase 1 step 10a (tasks, steps, dependencies, pins, assignment, links, members, updateProject, rebalanceOrder) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: taskId, date
 * - Caption: "UI Design starts 12 Oct"
 */
export default stubOp({
  name: "pinStart",
  scope: "project",
  family: "10a",
  deprecates: [],
  transport: { tool: "task_edit", field: "pinnedStart" },
});
