import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 57); Phase 1 step 10b (views, blocks, setFocus, brief) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: lineId
 * - Caption: "Brief line removed"
 */
export default stubOp({
  name: "removeBriefLine",
  scope: "project",
  family: "10b",
  deprecates: ["removeBriefLine"],
  transport: { tool: "brief", action: "hideLine" },
});
