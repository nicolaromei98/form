import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 9); Phase 1 step 10d (workspace and the project index) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: personId (rejected owns_tasks unless ownership = 0)
 * - Caption: "Luca deleted"
 */
export default stubOp({
  name: "deletePerson",
  scope: "workspace",
  family: "10d",
  deprecates: [],
  transport: { exempt: "Settings only: the agent never edits workspace settings." },
});
