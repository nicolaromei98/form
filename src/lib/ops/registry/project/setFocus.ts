import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 50); Phase 1 step 10b (views, blocks, setFocus, brief) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: taskId|null
 * - Caption: "Focus · Development"
 */
export default stubOp({
  name: "setFocus",
  scope: "project",
  family: "10b",
  activity: "hide",
  deprecates: [],
  transport: { tool: "focus", action: "pin" },
});
