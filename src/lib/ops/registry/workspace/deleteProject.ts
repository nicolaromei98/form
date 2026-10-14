import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 20); Phase 1 step 10d (workspace and the project index) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: projectId (soft: index deletedAt)
 * - Caption: "{title} deleted" (demo reset: "Workspace reset")
 */
export default stubOp({
  name: "deleteProject",
  scope: "workspace",
  family: "10d",
  deprecates: [],
  transport: { exempt: "Deleting a project is an index action and the demo reset, never an agent call." },
});
