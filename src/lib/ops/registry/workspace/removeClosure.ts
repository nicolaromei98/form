import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 4); Phase 1 step 10d (workspace and the project index) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: closureId
 * - Caption: "Closure removed"
 */
export default stubOp({
  name: "removeClosure",
  scope: "workspace",
  family: "10d",
  deprecates: [],
  transport: { exempt: "Settings only: the agent never edits workspace settings." },
});
