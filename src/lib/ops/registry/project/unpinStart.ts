import { z } from "zod";
import { sortedByOrder } from "@/lib/domain/order";
import { TaskId } from "@/lib/domain/schema/ids";
import { defineOp, isRejection } from "@/lib/ops/registry/_contract";
import { captionKey, mustTask, part, setIfChanged, title } from "@/lib/ops/registry/_helpers";

/**
 * Clears a task's start pin (plan §4.4 row 33): the schedule places it after its predecessors
 * again, or at the project's start when it waits on nothing. A task with no pin is a no-op.
 */
export default defineOp({
  name: "unpinStart",
  scope: "project",
  schema: z.object({ op: z.literal("unpinStart"), taskId: TaskId }).strict(),

  reduce(d, op) {
    const t = mustTask(d, op.taskId);
    if (isRejection(t)) return t;
    setIfChanged(t, "pinnedStart", null);
  },

  caption({ op, after }) {
    const t = after.tasks[op.taskId];
    const name = title(t.title);
    const key = captionKey.taskField(t.id, "pinnedStart");
    return part(t.dependsOn.length > 0 ? `${name} follows its dependencies again` : `${name} starts with the project again`, key);
  },
  noopCaption: ({ op, before }) => `${title(before.tasks[op.taskId].title)} isn't pinned`,
  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: [],
  parser: { exempt: "Start pins are cleared directly until the Phase 5 parser understands them.", until: 5 },
  palette: { exempt: "No palette phrase for start pins until the Phase 5 parser.", until: 5 },
  transport: { tool: "task_edit", field: "pinnedStart" },
  // generated60 pins two tasks; the first pinned one in workflow order
  sampleOn: "generated60",
  sample: (fx) => ({ op: "unpinStart", taskId: sortedByOrder(fx.project!.tasks).find((t) => t.pinnedStart !== null)!.id }),
});
