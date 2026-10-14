import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 8); Phase 1 step 10d (workspace and the project index) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: personId
 * - Caption: "Luca is back in the team"
 */
export default stubOp({
  name: "restorePerson",
  scope: "workspace",
  family: "10d",
  deprecates: [],
  transport: { exempt: "Settings \"Restore\" only: the agent never restores people." },
});
