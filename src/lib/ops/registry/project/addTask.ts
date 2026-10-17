import { z } from "zod";
import { DEPS_MAX, ESTIMATE_MAX_DAYS, MEMBERS_MAX, TASK_TITLE, TASKS_MAX } from "@/lib/domain/limits";
import { PersonId, TaskId } from "@/lib/domain/schema/ids";
import { halfDays, Line, Place, Priority, TaskKind } from "@/lib/domain/schema/primitives";
import type { Task } from "@/lib/domain/schema/project";
import { defineOp, isRejection, reject } from "@/lib/ops/registry/_contract";
import { ensureFreshId, keyForPlace, mustActivePerson, part, title, unique } from "@/lib/ops/registry/_helpers";

/**
 * Adds one top-level task (plan §4.4 row 26; v0 addTask with no parent). The producer mints the
 * id and decides the dependencies: with autoChain a quick "Add task" depends on the last task
 * (plan §4.5). A milestone gets estimate 0 and allocation 1; dependencies are deduplicated; an
 * owner joins the project's members, as with assignTask.
 */
export default defineOp({
  name: "addTask",
  scope: "project",
  schema: z
    .object({
      op: z.literal("addTask"),
      taskId: TaskId,
      title: Line(TASK_TITLE),
      kind: TaskKind,
      place: Place,
      dependsOn: z.array(TaskId).max(DEPS_MAX),
      estimateDays: halfDays(0, ESTIMATE_MAX_DAYS).nullable(),
      priority: Priority,
      ownerId: PersonId.nullable(),
    })
    .strict(),

  reduce(d, op, ctx) {
    if (Object.keys(d.tasks).length >= TASKS_MAX) return reject("limit", `A project holds at most ${TASKS_MAX} tasks.`);
    const fresh = ensureFreshId(d, op.taskId);
    if (fresh) return fresh;
    const dependsOn = unique(op.dependsOn);
    if (dependsOn.includes(op.taskId)) return reject("self_dependency", "A task can't wait on itself.");
    if (dependsOn.some((id) => !Object.hasOwn(d.tasks, id))) {
      return reject("not_found", "A task it should follow isn't in this project anymore.");
    }
    const milestone = op.kind === "milestone";
    if (!milestone && op.estimateDays === 0) return reject("invalid_payload", "An estimate is at least half a day.");
    if (op.ownerId !== null) {
      const owner = mustActivePerson(ctx.workspace, op.ownerId);
      if (isRejection(owner)) return owner;
      if (!d.memberIds.includes(op.ownerId)) {
        if (d.memberIds.length >= MEMBERS_MAX) return reject("limit", `A project has at most ${MEMBERS_MAX} members.`);
        d.memberIds.push(op.ownerId);
      }
    }
    const order = keyForPlace(d, op.place);
    if (isRejection(order)) return order;

    const task: Task = {
      id: op.taskId,
      title: op.title,
      kind: op.kind,
      description: null,
      status: "todo",
      priority: op.priority,
      progress: 0,
      estimateDays: milestone ? 0 : op.estimateDays,
      allocation: 1,
      pinnedStart: null,
      dueDate: null,
      dependsOn,
      ownerId: op.ownerId,
      costCents: null,
      tags: [],
      links: [],
      emphasis: false,
      steps: [],
      order,
      createdAt: ctx.now,
      completedAt: null,
    };
    d.tasks[op.taskId] = task;
  },

  caption: ({ op }) => part(`${title(op.title)} added`),
  // Adding always adds or refuses: a fresh id can't be there already
  noopCaption: () => null,
  undoable: true,
  activity: "show",
  idempotent: false,
  deprecates: ["addTask"],
  parser: { family: "task", examples: [{ say: "Add a task called Copywriting", fixture: "demo" }] },
  palette: { exempt: "The v0 palette has no add-task phrase; the parser example covers it." },
  transport: { tool: "task_add" },
  sample: (fx, mint) => ({
    op: "addTask",
    taskId: mint("task"),
    title: "Copywriting",
    kind: "task",
    place: "end",
    dependsOn: [fx.task("Development")],
    estimateDays: null,
    priority: "medium",
    ownerId: null,
  }),
});
