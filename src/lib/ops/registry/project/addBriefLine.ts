import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 55); Phase 1 step 10b (views, blocks, setFocus, brief) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: lineId, audience, section, text
 * - Caption: "Added to the client brief · Next"
 */
export default stubOp({
  name: "addBriefLine",
  scope: "project",
  family: "10b",
  deprecates: ["addBriefLine"],
  transport: { tool: "brief", action: "addLine" },
});
