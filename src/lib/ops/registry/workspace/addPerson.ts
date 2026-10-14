import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 5); Phase 1 step 10d (workspace and the project index) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: personId, name, role, email, capacityDaysPerWeek|null, dayRateCents|null
 * - Caption: "Giulia added to the team · capacity not set" · "Giulia is already in the team"
 */
export default stubOp({
  name: "addPerson",
  scope: "workspace",
  family: "10d",
  deprecates: ["addPerson"],
  transport: { tool: "person_edit" },
});
