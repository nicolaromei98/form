import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 53); Phase 1 step 10b (views, blocks, setFocus, brief) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: key, text, basis
 * - Caption: "Brief line edited"
 */
export default stubOp({
  name: "editBriefLine",
  scope: "project",
  family: "10b",
  deprecates: ["editBriefLine"],
  transport: { tool: "brief", action: "editLine" },
});
