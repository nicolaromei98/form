import { stubOp } from "@/lib/ops/registry/_stub";

/**
 * Stub (plan §4.4 row 21); Phase 1 step 10a (tasks, steps, dependencies, pins, assignment, links, members, updateProject, rebalanceOrder) replaces this file with
 * a real `defineOp`, keeping what the table already fixes below.
 * - Payload: field: title|client|kind|goal|status|startDate|startConfirmed|deadline|deadlineKind|currency|budgetCents|leadId|requireReview|autoChain|calendarOverride|tags, value
 * - Caption: "Renamed to {title}" · "Start · 21 Sep" · "Review step off · 2 tasks → Done"
 */
export default stubOp({
  name: "updateProject",
  scope: "project",
  family: "10a",
  deprecates: ["renameTool","setStartDate"],
  transport: { tool: "project_edit" },
});
