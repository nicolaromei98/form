import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 60); Phase 1 step 10b (views, blocks, setFocus, brief) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: field: showBudgetToClient, value
 * - Caption: "Budget shown to the client"
 */
export default stubOp({
  name: "setBriefSharing",
  scope: "project",
  family: "10b",
  deprecates: [],
  transport: { exempt: "Not exposed to the agent until the Phase 5 transport.", until: 5 },
});
