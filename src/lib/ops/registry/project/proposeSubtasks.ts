import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 40); Phase 1 step 10e (proposals) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: proposalId, taskId, items {stepId, title, estimateDays|null}[] 1–12
 * - Caption: "4 steps proposed for UI Design · fits its 6d estimate. Review them on the task."
 */
export default stubOp({
  name: "proposeSubtasks",
  scope: "project",
  family: "10e",
  deprecates: ["proposeSubtasks"],
  transport: { tool: "propose", action: "subtasks" },
});
