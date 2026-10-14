import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 15); Phase 1 step 10d (workspace and the project index) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: templateId
 * - Caption: "Template deleted"
 */
export default stubOp({
  name: "deleteTemplate",
  scope: "workspace",
  family: "10d",
  deprecates: [],
  transport: { exempt: "Templates are deleted in Settings, never by the agent." },
});
