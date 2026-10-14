import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 54); Phase 1 step 10b (views, blocks, setFocus, brief) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: keys[1–80]
 * - Caption: "FORM's wording restored"
 */
export default stubOp({
  name: "resetBriefLine",
  scope: "project",
  family: "10b",
  deprecates: ["resetBriefLine"],
  transport: { tool: "brief", action: "reset" },
});
