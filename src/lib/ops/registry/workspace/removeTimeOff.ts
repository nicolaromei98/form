import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 12); Phase 1 step 10d (workspace and the project index) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: personId, timeOffId
 * - Caption: "Time off removed"
 */
export default stubOp({
  name: "removeTimeOff",
  scope: "workspace",
  family: "10d",
  deprecates: [],
  transport: { tool: "person_edit", field: "timeOff" },
});
