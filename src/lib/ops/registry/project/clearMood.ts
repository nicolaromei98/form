import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 65); Phase 1 step 10c (moodboard) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: itemIds
 * - Caption: "Moodboard cleared · 12 references removed" · "The moodboard is already empty"
 */
export default stubOp({
  name: "clearMood",
  scope: "project",
  family: "10c",
  deprecates: ["clearMood"],
  transport: { tool: "moodboard", action: "clear" },
});
