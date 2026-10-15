import { z } from "zod";
import { sortedByOrder } from "@/lib/domain/order";
import { StepId, TaskId } from "@/lib/domain/schema/ids";
import { defineOp, isRejection } from "@/lib/ops/registry/_contract";
import { baseOf, part, title } from "@/lib/ops/registry/_helpers";
import { dropBriefEdits, mustTaskAndStep, stepOf } from "@/lib/ops/registry/_tasks";

/**
 * Removes a step (plan §4.4 row 38; v0 removeTask on a step). Like removeTask, it deletes the
 * brief edits keyed to the step, and undo restores them with it.
 */
export default defineOp({
  name: "removeStep",
  scope: "project",
  schema: z.object({ op: z.literal("removeStep"), taskId: TaskId, stepId: StepId }).strict(),

  reduce(d, op) {
    const found = mustTaskAndStep(d, op.taskId, op.stepId);
    if (isRejection(found)) return found;
    found.task.steps.splice(found.index, 1);
    dropBriefEdits(d, baseOf(d), new Set([op.stepId]));
  },

  caption: ({ op, before }) => part(`${title(stepOf(before, op.taskId, op.stepId)!.title)} removed`),
  // A step is either there to remove or not_found
  noopCaption: () => null,
  undoable: true,
  activity: "show",
  idempotent: false,
  deprecates: ["removeTask"],
  parser: { family: "task", examples: [{ say: "Delete the QA pass step", fixture: "demoSelected", selected: "UI Design" }] },
  palette: { exempt: "The v0 palette has no remove-step phrase; the parser example covers it." },
  transport: { tool: "step_edit", action: "remove" },
  // generated60 gives every task three steps; the first task's second step goes
  sampleOn: "generated60",
  sample(fx) {
    const task = sortedByOrder(fx.project!.tasks).find((t) => t.steps.length > 1)!;
    return { op: "removeStep", taskId: task.id, stepId: task.steps[1].id };
  },
});
