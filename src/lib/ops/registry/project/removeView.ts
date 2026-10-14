import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 48); Phase 1 step 10b (views, blocks, setFocus, brief) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: view (rejected last_view)
 * - Caption: "Board view removed · nothing in the project is deleted"
 */
export default stubOp({
  name: "removeView",
  scope: "project",
  family: "10b",
  deprecates: ["removeView"],
  transport: { tool: "view", action: "remove" },
});
