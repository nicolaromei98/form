import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 24); Phase 1 step 10a (tasks, steps, dependencies, pins, assignment, links, members, updateProject, rebalanceOrder) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: target {kind:"project"}|{kind:"task", taskId}, link
 * - Caption: "Link added · Figma"
 */
export default stubOp({
  name: "addLink",
  scope: "project",
  family: "10a",
  deprecates: [],
  transport: { tool: "project_edit", field: "link" },
});
