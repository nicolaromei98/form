import { z } from "zod";
import { TaskId } from "@/lib/domain/schema/ids";
import { defineOp, isRejection } from "@/lib/ops/registry/_contract";
import { captionKey, mustTask, part, setIfChanged, title } from "@/lib/ops/registry/_helpers";

/**
 * Takes a task's owner away (plan §4.4 row 35; v0 assignTask with no person). The former owner
 * stays a member of the project: they may still own other work, and the Team rows don't jump.
 */
export default defineOp({
  name: "unassignTask",
  scope: "project",
  schema: z.object({ op: z.literal("unassignTask"), taskId: TaskId }).strict(),

  reduce(d, op) {
    const t = mustTask(d, op.taskId);
    if (isRejection(t)) return t;
    setIfChanged(t, "ownerId", null);
  },

  caption: ({ op, after }) => part(`${title(after.tasks[op.taskId].title)} unassigned`, captionKey.taskField(op.taskId, "owner")),
  noopCaption: ({ op, before }) => `${title(before.tasks[op.taskId].title)} is already unassigned`,
  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: ["assignTask"],
  parser: { family: "team", examples: [{ say: "Unassign Visual Direction", fixture: "demo" }] },
  palette: { exempt: "The v0 palette has no unassign phrase; the parser example covers it." },
  transport: { tool: "assign" },
  sample: (fx) => ({ op: "unassignTask", taskId: fx.task("Visual Direction") }),
});
