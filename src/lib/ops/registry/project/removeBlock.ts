import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 52); Phase 1 step 10b (views, blocks, setFocus, brief) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: block (rejected protected_block for header and collection)
 * - Caption: "Moodboard hidden · its 12 references are kept" · "The moodboard is already hidden"
 */
export default stubOp({
  name: "removeBlock",
  scope: "project",
  family: "10b",
  deprecates: ["removeBlock"],
  transport: { tool: "block", field: "visible" },
});
