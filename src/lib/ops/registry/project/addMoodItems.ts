import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 61); Phase 1 step 10c (moodboard) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: items {itemId, kind, x?, y?, w?, h?, assetId?, hex?, text?}[] 1–24
 * - Caption: "3 colours added to the moodboard" · "8 of 24 added · the moodboard holds 200 references"
 */
export default stubOp({
  name: "addMoodItems",
  scope: "project",
  family: "10c",
  deprecates: ["addMoodItems"],
  transport: { tool: "moodboard", action: "add" },
});
