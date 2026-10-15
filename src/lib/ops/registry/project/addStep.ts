import { z } from "zod";
import { ESTIMATE_MAX_DAYS, STEP_TITLE, STEPS_MAX } from "@/lib/domain/limits";
import { StepId, TaskId } from "@/lib/domain/schema/ids";
import { halfDays, Line } from "@/lib/domain/schema/primitives";
import { defineOp, isRejection, reject } from "@/lib/ops/registry/_contract";
import { ensureFreshId, mustTask, part, title } from "@/lib/ops/registry/_helpers";
import { stepIndex } from "@/lib/ops/registry/_tasks";

/**
 * Adds a step to a task (plan §4.4 row 36; v0 addTask with a parent). Steps are one level deep,
 * in array order: `after` names the step it follows, null puts it first and "end" last; a missing
 * anchor falls back to the end, as addTask does, so the step is never lost. A milestone takes no
 * steps (`invalid_state`); a task holds at most 40 (`limit`). The producer mints the id, and a
 * taken one is refused (`duplicate_id`).
 */
export default defineOp({
  name: "addStep",
  scope: "project",
  schema: z
    .object({
      op: z.literal("addStep"),
      taskId: TaskId,
      stepId: StepId,
      title: Line(STEP_TITLE),
      estimateDays: halfDays(0.5, ESTIMATE_MAX_DAYS).nullable(),
      after: z.union([StepId, z.null(), z.literal("end")]),
    })
    .strict(),

  reduce(d, op) {
    const t = mustTask(d, op.taskId);
    if (isRejection(t)) return t;
    if (t.kind === "milestone") return reject("invalid_state", `${title(t.title)} is a milestone: it has no steps.`);
    if (t.steps.length >= STEPS_MAX) return reject("limit", `A task has at most ${STEPS_MAX} steps.`);
    const fresh = ensureFreshId(d, op.stepId);
    if (fresh) return fresh;
    const anchor = op.after === null ? -1 : op.after === "end" ? t.steps.length - 1 : stepIndex(t, op.after);
    const at = op.after !== null && anchor < 0 ? t.steps.length : anchor + 1;
    t.steps.splice(at, 0, { id: op.stepId, title: op.title, done: false, ownerId: null, estimateDays: op.estimateDays });
  },

  caption: ({ op, after }) => part(`Step added to ${title(after.tasks[op.taskId].title)}`),
  // A fresh id is never there already: adding adds or refuses
  noopCaption: () => null,
  undoable: true,
  activity: "show",
  idempotent: false,
  deprecates: ["addTask"],
  parser: { family: "task", examples: [{ say: "Add a step called QA pass", fixture: "demoSelected", selected: "UI Design" }] },
  palette: { exempt: "The v0 palette has no add-step phrase; the parser example covers it." },
  transport: { tool: "step_edit", action: "add" },
  sample: (fx, mint) => ({ op: "addStep", taskId: fx.task("UI Design"), stepId: mint("step"), title: "QA pass", estimateDays: null, after: "end" }),
});
