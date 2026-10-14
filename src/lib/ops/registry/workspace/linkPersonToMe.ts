import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 10); Phase 1 step 10d (workspace and the project index) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: personId, userId (unlinks others)
 * - Caption: "This is you: Marta"
 */
export default stubOp({
  name: "linkPersonToMe",
  scope: "workspace",
  family: "10d",
  deprecates: [],
  transport: { exempt: "Linking a person to an account needs sign-in (Phase 2) and the agent (Phase 5).", until: 5 },
});
