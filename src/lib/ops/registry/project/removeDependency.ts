import { z } from "zod";
import { TaskId } from "@/lib/domain/schema/ids";
import { defineOp, isRejection } from "@/lib/ops/registry/_contract";
import { mustTask, part, title } from "@/lib/ops/registry/_helpers";

/**
 * Stops a task waiting on another (plan §4.4 row 31). Both tasks must exist (`not_found`); a
 * dependency that isn't there is a no-op, so removing it twice is harmless. Removing an edge can
 * never create a loop, so nothing else is checked.
 */
export default defineOp({
  name: "removeDependency",
  scope: "project",
  schema: z.object({ op: z.literal("removeDependency"), taskId: TaskId, dependsOnId: TaskId }).strict(),

  reduce(d, op) {
    const task = mustTask(d, op.taskId);
    if (isRejection(task)) return task;
    const other = mustTask(d, op.dependsOnId);
    if (isRejection(other)) return other;
    const i = task.dependsOn.indexOf(op.dependsOnId);
    if (i >= 0) task.dependsOn.splice(i, 1);
  },

  caption: ({ op, after }) =>
    part(`${title(after.tasks[op.taskId].title)} no longer waits on ${title(after.tasks[op.dependsOnId].title)}`),
  noopCaption: ({ op, before }) =>
    `${title(before.tasks[op.taskId].title)} doesn't wait on ${title(before.tasks[op.dependsOnId].title)}`,
  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: [],
  parser: { exempt: "Dependencies are edited directly until the Phase 5 parser names them.", until: 5 },
  palette: { exempt: "No palette phrase for dependencies until the Phase 5 parser.", until: 5 },
  transport: { tool: "task_dependency", action: "remove" },
  sample: (fx) => ({ op: "removeDependency", taskId: fx.task("Development"), dependsOnId: fx.task("UI Design") }),
});
