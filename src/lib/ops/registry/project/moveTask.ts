import { z } from "zod";
import { applyStatus } from "@/lib/domain/invariants/transitions";
import { STATUS_LABEL } from "@/lib/domain/labels";
import { TaskId } from "@/lib/domain/schema/ids";
import { Place, Status } from "@/lib/domain/schema/primitives";
import type { ProjectDoc, Task } from "@/lib/domain/schema/project";
import { type CaptionPart, defineOp, isRejection, reject } from "@/lib/ops/registry/_contract";
import { captionKey, keyForPlace, mustTask, part, title, workflowOf } from "@/lib/ops/registry/_helpers";

/**
 * Moves a task in the workflow (plan §4.4 row 29; v0 moveTask{toIndex}, lowered to the neighbour
 * it lands after, or "start"). The place is an anchor, so a replay keeps the intent: the reducer
 * computes the new order key between the anchor and its successor. A board drag also names the
 * lane it drops in (`status`), applied through the status table. A missing anchor is refused
 * (`not_found`), unlike addTask, because a move with no destination has nothing to do. A task
 * already in place keeps its key, so the same move twice is a no-op.
 */

type Placement = z.infer<typeof Place>;

/** The task right before `id` in the workflow, null when it is first */
function predecessor(doc: ProjectDoc, id: TaskId): Task | null {
  const list = workflowOf(doc);
  const i = list.findIndex((t) => t.id === id);
  return i > 0 ? list[i - 1] : null;
}

/** Whether the task already sits at the place */
function isAt(doc: ProjectDoc, id: TaskId, place: Placement): boolean {
  const list = workflowOf(doc);
  if (place === "start") return list[0]?.id === id;
  if (place === "end") return list[list.length - 1]?.id === id;
  return predecessor(doc, id)?.id === place.after;
}

function placeText(doc: ProjectDoc, place: Placement): string {
  if (place === "start") return "to the start";
  if (place === "end") return "to the end";
  return `after ${title(doc.tasks[place.after].title)}`;
}

export default defineOp({
  name: "moveTask",
  scope: "project",
  schema: z.object({ op: z.literal("moveTask"), taskId: TaskId, place: Place, status: Status.optional() }).strict(),

  reduce(d, op, ctx) {
    const t = mustTask(d, op.taskId);
    if (isRejection(t)) return t;
    const place = op.place;
    if (typeof place === "object") {
      if (place.after === op.taskId) return reject("invalid_payload", "A task can't move after itself.");
      if (!Object.hasOwn(d.tasks, place.after)) return reject("not_found", "The task it should follow isn't in this project anymore.");
    }
    if (!isAt(d, op.taskId, place)) {
      const order = keyForPlace(d, place, { exclude: op.taskId, missingAnchor: "reject" });
      if (isRejection(order)) return order;
      t.order = order;
    }
    if (op.status !== undefined) return applyStatus(t, op.status, d, ctx.now);
  },

  caption({ op, before, after }) {
    const was = before.tasks[op.taskId];
    const t = after.tasks[op.taskId];
    const name = title(t.title);
    const moved = t.order !== was.order;
    const parts: CaptionPart[] = [];
    if (t.status !== was.status) parts.push(part(`${name} → ${STATUS_LABEL[t.status]}`, captionKey.taskState(t.id)));
    if (moved) {
      const where = placeText(after, op.place);
      parts.push(part(parts.length ? `moved ${where}` : `${name} moved ${where}`, captionKey.taskField(t.id, "order")));
    }
    // Never empty: an applied move changed the key or the status, but the caption stays total
    if (parts.length === 0) parts.push(part(`${name} · ${t.progress}%`, captionKey.taskState(t.id)));
    return parts;
  },

  noopCaption({ op, before }) {
    const name = title(before.tasks[op.taskId].title);
    const place = op.place;
    if (place === "start") return `${name} is already first`;
    if (place === "end") return `${name} is already last`;
    return `${name} is already after ${title(before.tasks[place.after].title)}`;
  },

  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: ["moveTask"],
  parser: { exempt: "Tasks move by direct manipulation (drag, Phase 3); no command reorders them." },
  palette: { exempt: "Tasks move by direct manipulation (drag, Phase 3); no palette phrase." },
  transport: { exempt: "Direct manipulation only: no agent tool drags or reorders." },
  // Research → Visual Direction → UI Design → Development: UI Design moves up one place
  sample: (fx) => ({ op: "moveTask", taskId: fx.task("UI Design"), place: { after: fx.task("Research") } }),
});
