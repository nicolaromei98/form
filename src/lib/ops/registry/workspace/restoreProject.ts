import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 19); Phase 1 step 10d (workspace and the project index) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: projectId
 * - Caption: "{title} restored"
 */
export default stubOp({
  name: "restoreProject",
  scope: "workspace",
  family: "10d",
  deprecates: [],
  transport: { exempt: "Not exposed to the agent until the Phase 5 transport.", until: 5 },
});
