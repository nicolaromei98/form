import { z } from "zod";
import { sortedByOrder } from "@/lib/domain/order";
import { StepId, TaskId } from "@/lib/domain/schema/ids";
import { defineOp, isRejection, reject } from "@/lib/ops/registry/_contract";
import { part, title } from "@/lib/ops/registry/_helpers";
import { mustTaskAndStep, stepGone, stepIndex, stepKey, stepOf } from "@/lib/ops/registry/_tasks";

/**
 * Moves a step inside its task (plan §4.4 row 39): `after` names the step it follows, null puts it
 * first. Steps are an array, so the move is a remove and an insert; a step already in place is a
 * no-op. Both the step and its anchor must be in the task (`not_found`).
 */
export default defineOp({
  name: "reorderStep",
  scope: "project",
  schema: z.object({ op: z.literal("reorderStep"), taskId: TaskId, stepId: StepId, after: StepId.nullable() }).strict(),

  reduce(d, op) {
    const found = mustTaskAndStep(d, op.taskId, op.stepId);
    if (isRejection(found)) return found;
    const { task, index } = found;
    if (op.after === op.stepId) return reject("invalid_payload", "A step can't move after itself.");
    if (op.after !== null && stepIndex(task, op.after) < 0) return reject("not_found", stepGone(task));
    const before = index > 0 ? task.steps[index - 1].id : null;
    if (before === op.after) return;
    const [step] = task.steps.splice(index, 1);
    const at = op.after === null ? 0 : stepIndex(task, op.after) + 1;
    task.steps.splice(at, 0, step);
  },

  caption: ({ op, after }) => part(`${title(stepOf(after, op.taskId, op.stepId)!.title)} moved`, stepKey(op.stepId, "order")),
  noopCaption: ({ op, before }) => `${title(stepOf(before, op.taskId, op.stepId)!.title)} is already there`,
  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: [],
  parser: { exempt: "Steps move by direct manipulation (drag); no command reorders them." },
  palette: { exempt: "Steps move by direct manipulation (drag); no palette phrase." },
  transport: { exempt: "Direct manipulation only: no agent tool drags or reorders." },
  // generated60 gives every task three steps; the first task's last step moves to the top
  sampleOn: "generated60",
  sample(fx) {
    const task = sortedByOrder(fx.project!.tasks).find((t) => t.steps.length > 1)!;
    return { op: "reorderStep", taskId: task.id, stepId: task.steps[task.steps.length - 1].id, after: null };
  },
});
