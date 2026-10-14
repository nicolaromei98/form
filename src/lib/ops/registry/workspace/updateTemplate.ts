import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 14); Phase 1 step 10d (workspace and the project index) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: templateId, field: name|kind, value
 * - Caption: "Template renamed to {name}"
 */
export default stubOp({
  name: "updateTemplate",
  scope: "workspace",
  family: "10d",
  deprecates: [],
  transport: { exempt: "Templates are edited in Settings, never by the agent." },
});
