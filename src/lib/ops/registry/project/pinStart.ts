import { z } from "zod";
import { TaskId } from "@/lib/domain/schema/ids";
import { IsoDate } from "@/lib/domain/schema/primitives";
import { defineOp, isRejection } from "@/lib/ops/registry/_contract";
import { captionKey, mustTask, part, setIfChanged, shortDate, title } from "@/lib/ops/registry/_helpers";

/**
 * Pins a task's start (plan §4.4 row 32). The schedule then starts it on the pinned day, or on the
 * first working day after it, and never before its predecessors finish (plan §6.3): the pin is a
 * wish the plan honours, not a promise it breaks. Milestones may be pinned too (their date
 * follows the pin).
 */
export default defineOp({
  name: "pinStart",
  scope: "project",
  schema: z.object({ op: z.literal("pinStart"), taskId: TaskId, date: IsoDate }).strict(),

  reduce(d, op) {
    const t = mustTask(d, op.taskId);
    if (isRejection(t)) return t;
    setIfChanged(t, "pinnedStart", op.date);
  },

  caption: ({ op, after }) =>
    part(`${title(after.tasks[op.taskId].title)} starts ${shortDate(op.date)}`, captionKey.taskField(op.taskId, "pinnedStart")),
  noopCaption: ({ op, before }) => `${title(before.tasks[op.taskId].title)} already starts ${shortDate(op.date)}`,
  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: [],
  parser: { exempt: "Start pins are set directly until the Phase 5 parser understands them.", until: 5 },
  palette: { exempt: "No palette phrase for start pins until the Phase 5 parser.", until: 5 },
  transport: { tool: "task_edit", field: "pinnedStart" },
  sample: (fx) => ({ op: "pinStart", taskId: fx.task("UI Design"), date: "2026-10-12" }),
});
