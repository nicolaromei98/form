import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 6); Phase 1 step 10d (workspace and the project index) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: personId, field: name|role|email|capacityDaysPerWeek|dayRateCents, value
 * - Caption: "Marta · 4 days a week"
 */
export default stubOp({
  name: "updatePerson",
  scope: "workspace",
  family: "10d",
  deprecates: ["updatePerson"],
  transport: { tool: "person_edit" },
});
