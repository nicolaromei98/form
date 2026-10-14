import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 29); Phase 1 step 10a (tasks, steps, dependencies, pins, assignment, links, members, updateProject, rebalanceOrder) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: taskId, place, status?
 * - Caption: "UI Design moved after Research"
 */
export default stubOp({
  name: "moveTask",
  scope: "project",
  family: "10a",
  deprecates: ["moveTask"],
  transport: { exempt: "Direct manipulation only: no agent tool drags or reorders." },
});
