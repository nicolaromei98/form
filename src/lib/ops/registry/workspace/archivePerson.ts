import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 7); Phase 1 step 10d (workspace and the project index) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: personId
 * - Caption: "Luca removed · 1 task unassigned"
 */
export default stubOp({
  name: "archivePerson",
  scope: "workspace",
  family: "10d",
  deprecates: ["removePerson"],
  transport: { tool: "person_edit", field: "remove" },
});
