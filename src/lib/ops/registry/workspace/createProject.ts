import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 16); Phase 1 step 10d (workspace and the project index) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: projectId, draft: ProjectDraft, tasks: TaskSeed[] ≤ 150 (+ spawn)
 * - Caption: "{View} created · 4 tasks"
 */
export default stubOp({
  name: "createProject",
  scope: "workspace",
  family: "10d",
  deprecates: ["createProject"],
  transport: { tool: "project_draft" },
});
