import { z } from "zod";
import { wouldCycle } from "@/lib/domain/invariants/graph";
import { DEPS_MAX } from "@/lib/domain/limits";
import { TaskId } from "@/lib/domain/schema/ids";
import { defineOp, fitText, isRejection, reject } from "@/lib/ops/registry/_contract";
import { baseOf, mustTask, part, title } from "@/lib/ops/registry/_helpers";

/**
 * Makes a task wait on another (finish-to-start; plan §5.6). A self-reference, a missing task
 * and a loop are refused; the loop is named, shortest first ("That would create a loop:
 * Development → UI Design → Development.").
 */

const LOOP = "That would create a loop: ";

/** The loop sentence within 140 characters: shorter titles first, then the middle of a long loop elided */
function loopMessage(names: readonly string[]): string {
  const cut = (name: string, max: number) => fitText(name, max);
  for (const max of [60, 30, 16]) {
    const text = `${LOOP}${names.map((n) => cut(n, max)).join(" → ")}.`;
    if (text.length <= 140) return text;
  }
  const short = names.map((n) => cut(n, 16));
  return fitText(`${LOOP}${[...short.slice(0, 2), "…", ...short.slice(-2)].join(" → ")}.`);
}

export default defineOp({
  name: "addDependency",
  scope: "project",
  schema: z.object({ op: z.literal("addDependency"), taskId: TaskId, dependsOnId: TaskId }).strict(),

  reduce(d, op) {
    if (op.taskId === op.dependsOnId) return reject("self_dependency", "A task can't wait on itself.");
    const task = mustTask(d, op.taskId);
    if (isRejection(task)) return task;
    const before = mustTask(d, op.dependsOnId);
    if (isRejection(before)) return before;
    if (task.dependsOn.includes(op.dependsOnId)) return;
    if (task.dependsOn.length >= DEPS_MAX) return reject("limit", `${title(task.title)} already waits on ${DEPS_MAX} tasks.`);
    const base = baseOf(d);
    const loop = wouldCycle(base, op.taskId, op.dependsOnId);
    if (loop) return reject("cycle", loopMessage(loop.map((id) => base.tasks[id].title)), { path: loop.join(" ") });
    task.dependsOn.push(op.dependsOnId);
  },

  caption: ({ op, after }) => part(`${title(after.tasks[op.taskId].title)} now waits on ${title(after.tasks[op.dependsOnId].title)}`),
  noopCaption: ({ op, before }) => `${title(before.tasks[op.taskId].title)} already waits on ${title(before.tasks[op.dependsOnId].title)}`,
  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: [],
  parser: { exempt: "Dependencies are edited directly until the Phase 5 parser names them.", until: 5 },
  palette: { exempt: "No palette phrase for dependencies until the Phase 5 parser.", until: 5 },
  transport: { tool: "task_dependency", action: "add" },
  // Research → Visual Direction → UI Design → Development: Development may also wait on Research
  sample: (fx) => ({ op: "addDependency", taskId: fx.task("Development"), dependsOnId: fx.task("Research") }),
});
