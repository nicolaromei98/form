import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 11); Phase 1 step 10d (workspace and the project index) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: personId, timeOff {timeOffId, from, to, label}
 * - Caption: "Marta is off 2–6 Nov"
 */
export default stubOp({
  name: "addTimeOff",
  scope: "workspace",
  family: "10d",
  deprecates: [],
  transport: { tool: "person_edit", field: "timeOff" },
});
