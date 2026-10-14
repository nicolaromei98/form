import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 47); Phase 1 step 10b (views, blocks, setFocus, brief) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: view (appended; ≤ 6)
 * - Caption: "{View} view added" (merged with the show caption: key captionKey.viewAdded(view))
 */
export default stubOp({
  name: "addView",
  scope: "project",
  family: "10b",
  deprecates: ["setRepresentation"],
  transport: { tool: "view", action: "add" },
});
