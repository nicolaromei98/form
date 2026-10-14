import { z } from "zod";
import { applyKind, applyProgress, applyStatus } from "@/lib/domain/invariants/transitions";
import { PRIORITY_LABEL, STATUS_LABEL } from "@/lib/domain/labels";
import { ESTIMATE_MAX_DAYS, TAGS_MAX, TASK_DESCRIPTION, TASK_TITLE } from "@/lib/domain/limits";
import { formatMoney } from "@/lib/domain/money";
import { TaskId } from "@/lib/domain/schema/ids";
import { Allocation, Cents, halfDays, IsoDate, Line, Priority, Status, Tag, TaskKind } from "@/lib/domain/schema/primitives";
import type { ProjectDoc, Task } from "@/lib/domain/schema/project";
import { defineOp, isRejection, reject } from "@/lib/ops/registry/_contract";
import { captionKey, formatDays, mustTask, part, setIfChanged, shortDate, title, unique } from "@/lib/ops/registry/_helpers";

/**
 * Changes one field of a task (plan §4.2, §4.4 row 27). Status and progress go through the §5.7
 * table (`transitions.ts`), so each op changes one of them and the other follows. A v0 multi-field
 * update becomes one op per field, status last (plan §4.5): their caption parts share the key
 * `task:{id}:state`, so "Mark UI Design done at 40%" reads only "UI Design → Done". Tags are
 * deduplicated on write; a task that becomes a milestone leaves the pending proposal.
 */

const field = <F extends string, V extends z.ZodType>(f: F, value: V) =>
  z.object({ op: z.literal("updateTask"), taskId: TaskId, field: z.literal(f), value }).strict();

const milestoneTakesNoTime = (t: Task) => reject("invalid_state", `${title(t.title)} is a milestone: it takes no time.`);

const percent = (allocation: number) => `${allocation * 100}%`;

/**
 * A milestone takes no steps and no estimate, so the pending proposal stops offering them (plan
 * §3.8 P9): proposed steps for it are dropped with their proposal, and a suggested estimate for it
 * leaves the list (the proposal goes when the list empties), as removeTask prunes a removed task.
 */
function dropProposalsFor(d: ProjectDoc, id: TaskId): void {
  const p = d.proposal;
  if (p?.kind === "subtasks" && p.taskId === id) d.proposal = null;
  else if (p?.kind === "estimates" && p.items.some((i) => i.taskId === id)) {
    const items = p.items.filter((i) => i.taskId !== id);
    if (items.length > 0) p.items = items;
    else d.proposal = null;
  }
}

export default defineOp({
  name: "updateTask",
  scope: "project",
  schema: z.discriminatedUnion("field", [
    field("title", Line(TASK_TITLE)),
    field("description", z.string().max(TASK_DESCRIPTION).nullable()),
    field("status", Status),
    field("priority", Priority),
    field("progress", z.int().min(0).max(100)),
    field("estimateDays", halfDays(0, ESTIMATE_MAX_DAYS).nullable()),
    field("allocation", Allocation),
    field("dueDate", IsoDate.nullable()),
    field("costCents", Cents.nullable()),
    field("emphasis", z.boolean()),
    field("tags", z.array(Tag).max(TAGS_MAX)),
    field("kind", TaskKind),
  ]),

  reduce(d, op, ctx) {
    const t = mustTask(d, op.taskId);
    if (isRejection(t)) return t;
    switch (op.field) {
      case "status":
        return applyStatus(t, op.value, d, ctx.now);
      case "progress":
        return applyProgress(t, op.value, d, ctx.now);
      case "estimateDays":
        if (t.kind === "milestone" && op.value !== 0) return milestoneTakesNoTime(t);
        if (t.kind === "task" && op.value === 0) return reject("invalid_payload", "An estimate is at least half a day.");
        setIfChanged(t, "estimateDays", op.value);
        return;
      case "allocation":
        if (t.kind === "milestone" && op.value !== 1) return milestoneTakesNoTime(t);
        setIfChanged(t, "allocation", op.value);
        return;
      case "kind": {
        const refused = applyKind(t, op.value);
        if (refused) return refused;
        if (op.value === "milestone") dropProposalsFor(d, t.id);
        return;
      }
      case "tags":
        setIfChanged(t, "tags", unique(op.value));
        return;
      case "title":
        setIfChanged(t, "title", op.value);
        return;
      case "description":
        setIfChanged(t, "description", op.value);
        return;
      case "priority":
        setIfChanged(t, "priority", op.value);
        return;
      case "dueDate":
        setIfChanged(t, "dueDate", op.value);
        return;
      case "costCents":
        setIfChanged(t, "costCents", op.value);
        return;
      case "emphasis":
        setIfChanged(t, "emphasis", op.value);
        return;
    }
  },

  caption({ op, before, after }) {
    const was = before.tasks[op.taskId];
    const t = after.tasks[op.taskId];
    const name = title(t.title);
    const state = captionKey.taskState(t.id);
    const key = captionKey.taskField(t.id, op.field);
    switch (op.field) {
      case "status":
        return part(`${name} → ${STATUS_LABEL[t.status]}`, state);
      case "progress":
        if (t.status === was.status) return part(`Progress ${t.progress}%`, state);
        return part(t.status === "done" ? `${name} → Done` : `${name} → ${STATUS_LABEL[t.status]} · ${t.progress}%`, state);
      case "title":
        return part(`Renamed to ${name}`, key);
      case "priority":
        return part(`Priority ${t.priority}`, key);
      case "estimateDays":
        return part(t.estimateDays === null ? `${name} · estimate cleared` : `Estimate ${formatDays(t.estimateDays)}d`, key);
      case "allocation":
        return part(`${name} · ${percent(t.allocation)} allocation`, key);
      case "dueDate":
        return part(t.dueDate === null ? `${name} · due date cleared` : `${name} due ${shortDate(t.dueDate)}`, key);
      case "costCents":
        return part(t.costCents === null ? `${name} · cost cleared` : `Cost ${formatMoney(t.costCents, after.currency)}`, key);
      case "emphasis":
        return part(t.emphasis ? `${name} emphasised` : "Emphasis removed", key);
      case "description":
        return part(t.description ? `${name} · description updated` : `${name} · description cleared`, key);
      case "tags":
        return part(t.tags.length ? `${name} · tagged ${t.tags.join(", ")}` : `${name} · tags cleared`, key);
      case "kind":
        return part(`${name} is now a ${t.kind}`, key);
    }
  },

  noopCaption({ op, before }) {
    const t = before.tasks[op.taskId];
    const name = title(t.title);
    switch (op.field) {
      case "status":
        return t.status === "todo" ? `${name} hasn't started yet` : `${name} is already ${STATUS_LABEL[t.status].toLowerCase()}`;
      case "progress":
        return `${name} is already at ${t.progress}%`;
      case "title":
        return `It's already called ${name}`;
      case "priority":
        return `${name} is already ${PRIORITY_LABEL[t.priority].toLowerCase()} priority`;
      case "estimateDays":
        return t.estimateDays === null ? `${name} has no estimate yet` : `${name} is already estimated at ${formatDays(t.estimateDays)}d`;
      case "allocation":
        return `${name} is already at ${percent(t.allocation)} allocation`;
      case "dueDate":
        return t.dueDate === null ? `${name} has no due date` : `${name} is already due ${shortDate(t.dueDate)}`;
      case "costCents":
        return t.costCents === null ? `${name} has no cost set` : `${name} already costs ${formatMoney(t.costCents, before.currency)}`;
      case "emphasis":
        return t.emphasis ? `${name} already stands out` : `${name} isn't emphasised`;
      case "description":
        return `${name}'s description is unchanged`;
      case "tags":
        return `${name}'s tags are unchanged`;
      case "kind":
        return `${name} is already a ${t.kind}`;
    }
  },

  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: ["updateTask"],
  parser: {
    family: "task",
    examples: [
      { say: "Mark UI Design in review", fixture: "demo" },
      { say: "Set it to 40%", fixture: "demoSelected", selected: "UI Design" },
      { say: "It takes 2 weeks", fixture: "demoSelected", selected: "UI Design" },
      { say: "Rename it to Discovery", fixture: "demoSelected", selected: "Research" },
    ],
  },
  palette: [
    { group: "Selected task", phrase: "Make this more prominent", rank: 20, needs: "selection", fixture: "demoSelected", surfaces: ["demo", "app"] },
    { group: "Selected task", phrase: "Mark it done", rank: 30, needs: "selection", fixture: "demoSelected", surfaces: ["demo", "app"] },
    { group: "Selected task", phrase: "Set the cost to €2,400", rank: 40, needs: "selection", fixture: "demoSelected", surfaces: ["demo", "app"] },
  ],
  transport: { tool: "task_edit" },
  sample: (fx) => ({ op: "updateTask", taskId: fx.task("UI Design"), field: "status", value: "done" }),
});
