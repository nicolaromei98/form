import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 1); Phase 1 step 10d (workspace and the project index) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: field: name|timezone|defaultCurrency|holidayPreset|improveFormOptIn, value
 * - Caption: "Workspace renamed to {name}" · "Already {value}"
 */
export default stubOp({
  name: "updateWorkspace",
  scope: "workspace",
  family: "10d",
  deprecates: [],
  transport: { exempt: "Settings only: the agent never edits workspace settings." },
});
