import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 63); Phase 1 step 10c (moodboard) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: itemId
 * - Caption: "Reference removed"
 */
export default stubOp({
  name: "removeMoodItem",
  scope: "project",
  family: "10c",
  deprecates: ["removeMoodItem"],
  transport: { tool: "moodboard", action: "remove" },
});
