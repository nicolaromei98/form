import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 62); Phase 1 step 10c (moodboard) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: itemId, patch {x, y, w, h, r, hex, text}, toFront
 * - Caption: none (direct, no caption)
 */
export default stubOp({
  name: "updateMoodItem",
  scope: "project",
  family: "10c",
  deprecates: ["updateMoodItem"],
  transport: { exempt: "Direct manipulation only: no agent tool drags or reorders." },
});
