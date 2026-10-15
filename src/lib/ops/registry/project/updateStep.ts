import { z } from "zod";
import { ESTIMATE_MAX_DAYS, STEP_TITLE } from "@/lib/domain/limits";
import { sortedByOrder } from "@/lib/domain/order";
import { PersonId, StepId, TaskId } from "@/lib/domain/schema/ids";
import { halfDays, Line } from "@/lib/domain/schema/primitives";
import { defineOp, isRejection } from "@/lib/ops/registry/_contract";
import { formatDays, mustActivePerson, part, setIfChanged, title } from "@/lib/ops/registry/_helpers";
import { ensureMember, mustTaskAndStep, stepKey, stepOf } from "@/lib/ops/registry/_tasks";

/**
 * Changes one field of a step (plan §4.4 row 37; v0 updateTask on a step, lowered to title, done
 * or estimate). A step's owner follows the same rules as a task's: someone in the workspace
 * (`invalid_reference`), not archived (`archived`), who then joins the project's members. Ticking
 * a step never moves its task's status or progress: those are the task's own (plan §5.5).
 */

const field = <F extends string, V extends z.ZodType>(f: F, value: V) =>
  z.object({ op: z.literal("updateStep"), taskId: TaskId, stepId: StepId, field: z.literal(f), value }).strict();

export default defineOp({
  name: "updateStep",
  scope: "project",
  schema: z.discriminatedUnion("field", [
    field("title", Line(STEP_TITLE)),
    field("done", z.boolean()),
    field("ownerId", PersonId.nullable()),
    field("estimateDays", halfDays(0.5, ESTIMATE_MAX_DAYS).nullable()),
  ]),

  reduce(d, op, ctx) {
    const found = mustTaskAndStep(d, op.taskId, op.stepId);
    if (isRejection(found)) return found;
    const step = found.task.steps[found.index];
    switch (op.field) {
      case "title":
        setIfChanged(step, "title", op.value);
        return;
      case "done":
        setIfChanged(step, "done", op.value);
        return;
      case "estimateDays":
        setIfChanged(step, "estimateDays", op.value);
        return;
      case "ownerId": {
        if (op.value !== null) {
          const person = mustActivePerson(ctx.workspace, op.value);
          if (isRejection(person)) return person;
          const member = ensureMember(d, op.value);
          if (member) return member;
        }
        setIfChanged(step, "ownerId", op.value);
        return;
      }
    }
  },

  caption({ op, after, env }) {
    const step = stepOf(after, op.taskId, op.stepId)!;
    const name = title(step.title);
    const key = stepKey(op.stepId, op.field);
    switch (op.field) {
      case "title":
        return part(`Step renamed to ${name}`, key);
      case "done":
        return part(step.done ? `${name} done` : `${name} reopened`, key);
      case "ownerId":
        return part(step.ownerId === null ? `${name} unassigned` : `${name} → ${title(env.personName(step.ownerId))}`, key);
      case "estimateDays":
        return part(step.estimateDays === null ? `${name} · estimate cleared` : `${name} · ${formatDays(step.estimateDays)}d`, key);
    }
  },

  noopCaption({ op, before, env }) {
    const step = stepOf(before, op.taskId, op.stepId)!;
    const name = title(step.title);
    switch (op.field) {
      case "title":
        return `It's already called ${name}`;
      case "done":
        return step.done ? `${name} is already done` : `${name} isn't done yet`;
      case "ownerId":
        return step.ownerId === null ? `${name} is already unassigned` : `${name} is already with ${title(env.personName(step.ownerId))}`;
      case "estimateDays":
        return step.estimateDays === null ? `${name} has no estimate yet` : `${name} is already estimated at ${formatDays(step.estimateDays)}d`;
    }
  },

  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: ["updateTask"],
  parser: { family: "task", examples: [{ say: "Mark QA pass done", fixture: "demoSelected", selected: "UI Design" }] },
  palette: { exempt: "The v0 palette has no step phrase; the parser example covers it." },
  transport: { tool: "step_edit" },
  // generated60 gives every task three steps; the first one not done yet gets ticked
  sampleOn: "generated60",
  sample(fx) {
    const task = sortedByOrder(fx.project!.tasks).find((t) => t.steps.some((s) => !s.done))!;
    const step = task.steps.find((s) => !s.done)!;
    return { op: "updateStep", taskId: task.id, stepId: step.id, field: "done", value: true };
  },
});
