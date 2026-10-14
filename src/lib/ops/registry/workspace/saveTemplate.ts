import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 13); Phase 1 step 10d (workspace and the project index) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: template
 * - Caption: "Saved as template · {name}"
 */
export default stubOp({
  name: "saveTemplate",
  scope: "workspace",
  family: "10d",
  deprecates: [],
  transport: { exempt: "Templates are saved from the project index, never by the agent." },
});
