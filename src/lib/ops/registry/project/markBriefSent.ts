import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 59); Phase 1 step 10b (views, blocks, setFocus, brief) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: audience, snapshotId
 * - Caption: "Client brief marked as sent"
 */
export default stubOp({
  name: "markBriefSent",
  scope: "project",
  family: "10b",
  deprecates: [],
  transport: { tool: "brief", action: "markSent" },
});
