import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 64); Phase 1 step 10c (moodboard) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: layout, itemIds
 * - Caption: "Moodboard arranged as a collage"
 */
export default stubOp({
  name: "arrangeMood",
  scope: "project",
  family: "10c",
  deprecates: ["arrangeMood"],
  transport: { tool: "moodboard", action: "arrange" },
});
