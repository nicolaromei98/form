import { z } from "zod";
import { TaskId } from "@/lib/domain/schema/ids";
import { defineOp, reject } from "@/lib/ops/registry/_contract";
import { captionKey, part, setIfChanged, TASK_GONE, title } from "@/lib/ops/registry/_helpers";

/**
 * Pins the task Focus shows, or hands the choice back to FORM with null (plan §4.4 row 50; v0
 * `setView.focusId`, plan §4.5). The pin is view config: it commits and undoes but stays out of
 * Activity (Q6). Any existing task may be pinned; Focus itself ignores a pin on a finished task.
 *
 * The caption part shares the local show caption's key (`captionKey.show("focus")`): "Focus on
 * Development" also shows Focus, whose caption names the same pick, so the two read as one part,
 * and `announceView` turns it into "Focus view added · Development" when the view is new.
 */
export default defineOp({
  name: "setFocus",
  scope: "project",
  schema: z.object({ op: z.literal("setFocus"), taskId: TaskId.nullable() }).strict(),

  reduce(d, op) {
    if (op.taskId !== null && !Object.hasOwn(d.tasks, op.taskId)) return reject("not_found", TASK_GONE);
    setIfChanged(d.viewConfig, "focusPin", op.taskId);
  },

  caption({ op, after }) {
    const key = captionKey.show("focus");
    if (op.taskId === null) return part("Focus · FORM picks the next task", key);
    return part(`Focus · ${title(after.tasks[op.taskId].title)}`, key);
  },
  // Clearing a pin that isn't there says nothing: "What should I work on now?" reads as the show caption alone
  noopCaption: ({ op, before }) => (op.taskId === null ? null : `Focus is already on ${title(before.tasks[op.taskId].title)}`),

  undoable: true,
  activity: "hide",
  idempotent: true,
  deprecates: ["setView"],
  parser: { family: "view", examples: [{ say: "Focus mode for UI Design", fixture: "demo" }] },
  palette: [
    { group: "Decide", phrase: "What should I work on now?", rank: 10, needs: "project", fixture: "demo", surfaces: ["demo", "app"] },
    { group: "Decide", phrase: "Focus on Development", rank: 20, needs: "project", fixture: "demo", surfaces: ["demo", "app"] },
  ],
  transport: { tool: "focus", action: "pin" },
  sample: (fx) => ({ op: "setFocus", taskId: fx.task("Development") }),
});
