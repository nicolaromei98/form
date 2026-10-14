import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 56); Phase 1 step 10b (views, blocks, setFocus, brief) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: lineId, text (an empty edit becomes removeBriefLine at the producer)
 * - Caption: "Brief line updated"
 */
export default stubOp({
  name: "updateBriefLine",
  scope: "project",
  family: "10b",
  deprecates: ["updateBriefLine"],
  transport: { tool: "brief", action: "editLine" },
});
