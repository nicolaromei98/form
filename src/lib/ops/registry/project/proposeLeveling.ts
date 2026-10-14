import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 42); Phase 1 step 10e (proposals) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: proposalId, moves[]
 * - Caption: "Leveling proposed · 3 starts move"
 */
export default stubOp({
  name: "proposeLeveling",
  scope: "project",
  family: "10e",
  deprecates: [],
  transport: { tool: "propose", action: "leveling" },
});
