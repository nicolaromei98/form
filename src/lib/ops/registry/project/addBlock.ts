import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 51); Phase 1 step 10b (views, blocks, setFocus, brief) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: block (canonical order)
 * - Caption: "Project progress indicator added" · "Moodboard added · drop, paste or browse images"
 */
export default stubOp({
  name: "addBlock",
  scope: "project",
  family: "10b",
  deprecates: ["addBlock"],
  transport: { tool: "block", field: "visible" },
});
