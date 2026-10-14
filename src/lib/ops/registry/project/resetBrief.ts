import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 58); Phase 1 step 10b (views, blocks, setFocus, brief) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: audience
 * - Caption: "Your edits to the client brief are cleared · FORM's version" · "The client brief is already FORM's version"
 */
export default stubOp({
  name: "resetBrief",
  scope: "project",
  family: "10b",
  deprecates: ["resetBrief"],
  transport: { tool: "brief", action: "reset" },
});
