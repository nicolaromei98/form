import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 23); Phase 1 step 10a (tasks, steps, dependencies, pins, assignment, links, members, updateProject, rebalanceOrder) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: personId
 * - Caption: "Giulia leaves the project"
 */
export default stubOp({
  name: "removeMember",
  scope: "project",
  family: "10a",
  deprecates: [],
  transport: { exempt: "Not exposed to the agent until the Phase 5 transport.", until: 5 },
});
