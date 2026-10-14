import { z } from "zod";
import { bridgeOnRemove } from "@/lib/domain/invariants/graph";
import { DEPS_MAX } from "@/lib/domain/limits";
import { compareKeys, sortedByOrder } from "@/lib/domain/order";
import { TaskId } from "@/lib/domain/schema/ids";
import type { ProjectDoc } from "@/lib/domain/schema/project";
import type { Proposal } from "@/lib/domain/schema/proposal";
import { type CaptionPart, defineOp, isRejection, type Rejection, reject } from "@/lib/ops/registry/_contract";
import { baseOf, joinNames, part, TASK_GONE, title, unique } from "@/lib/ops/registry/_helpers";

/**
 * Removes a task and bridges its dependencies (plan §5.6): every task that waited on it inherits
 * its predecessors, so the chain never breaks and no loop can appear. It also clears the focus
 * pin, prunes the pending proposal and deletes the brief edits keyed to the task or its steps;
 * undo restores all of it, because it is one op with one inverse.
 */

type Seeds = Extract<Proposal, { kind: "plan" }>["tasks"];

/** A plan proposal's seeds that wait on the removed task inherit its predecessors too */
function bridgeSeeds(seeds: Seeds, removed: TaskId, inherited: readonly TaskId[]): Seeds | Rejection | null {
  if (!seeds.some((s) => s.dependsOn.includes(removed))) return null;
  const next = seeds.map((s) =>
    s.dependsOn.includes(removed) ? { ...s, dependsOn: unique([...s.dependsOn.filter((id) => id !== removed), ...inherited]) } : s,
  );
  if (next.some((s) => s.dependsOn.length > DEPS_MAX)) {
    return reject("limit", `A proposed task would wait on more than ${DEPS_MAX} tasks.`);
  }
  return next;
}

/** Whether a brief edit key ("client:risks:tsk_…") names one of the ids */
const namesAny = (key: string, ids: ReadonlySet<string>) => key.split(":").slice(1).some((segment) => ids.has(segment));

export default defineOp({
  name: "removeTask",
  scope: "project",
  schema: z.object({ op: z.literal("removeTask"), taskId: TaskId }).strict(),

  reduce(d, op) {
    const base: ProjectDoc = baseOf(d);
    if (!Object.hasOwn(base.tasks, op.taskId)) return reject("not_found", TASK_GONE);
    const removed = base.tasks[op.taskId];

    const bridges = bridgeOnRemove(base, op.taskId);
    for (const [id, bridge] of bridges) {
      if (bridge.dependsOn.length > DEPS_MAX) {
        return reject("limit", `Removing ${title(removed.title)} would leave ${title(base.tasks[id].title)} waiting on over ${DEPS_MAX} tasks.`);
      }
    }
    const inherited = unique(removed.dependsOn).filter((id) => id !== op.taskId && Object.hasOwn(base.tasks, id));
    const seeds = base.proposal?.kind === "plan" ? bridgeSeeds(base.proposal.tasks, op.taskId, inherited) : null;
    if (isRejection(seeds)) return seeds;

    for (const [id, bridge] of bridges) d.tasks[id].dependsOn = bridge.dependsOn;
    delete d.tasks[op.taskId];

    if (d.viewConfig.focusPin === op.taskId) d.viewConfig.focusPin = null;

    const p = d.proposal;
    if (p) {
      switch (p.kind) {
        case "subtasks":
          if (p.taskId === op.taskId) d.proposal = null;
          break;
        case "reassign": {
          const moves = p.moves.filter((m) => m.taskId !== op.taskId);
          if (moves.length === 0) d.proposal = null;
          else if (moves.length !== p.moves.length) p.moves = moves;
          break;
        }
        case "leveling": {
          const moves = p.moves.filter((m) => m.taskId !== op.taskId);
          if (moves.length === 0) d.proposal = null;
          else if (moves.length !== p.moves.length) p.moves = moves;
          break;
        }
        case "estimates": {
          const items = p.items.filter((i) => i.taskId !== op.taskId);
          if (items.length === 0) d.proposal = null;
          else if (items.length !== p.items.length) p.items = items;
          break;
        }
        case "plan":
          if (seeds) p.tasks = seeds;
          break;
      }
    }

    // Brief edits keyed to the task or one of its steps: deleted in key order, so patches never depend on key order
    const named = new Set<string>([op.taskId, ...removed.steps.map((s) => s.id)]);
    for (const key of Object.keys(base.brief.edits).sort(compareKeys)) {
      if (namesAny(key, named)) delete d.brief.edits[key];
    }
  },

  caption({ op, before, after }) {
    const removed = before.tasks[op.taskId];
    const parts: CaptionPart[] = [part(`${title(removed.title)} removed`)];
    // Dependents that inherited predecessors, in workflow order: "Development now follows Visual Direction"
    const relinked = sortedByOrder(after.tasks)
      .filter((t) => Object.hasOwn(before.tasks, t.id) && before.tasks[t.id].dependsOn.includes(op.taskId))
      .map((t) => ({ task: t, added: t.dependsOn.filter((id) => !before.tasks[t.id].dependsOn.includes(id)) }))
      .filter((r) => r.added.length > 0);
    if (relinked.length > 0) {
      const [first] = relinked;
      parts.push(part(`${title(first.task.title)} now follows ${joinNames(first.added.map((id) => title(after.tasks[id].title)))}`));
      const more = relinked.length - 1;
      if (more > 0) parts.push(part(`${more} more task${more > 1 ? "s" : ""} re-linked`));
    }
    return parts;
  },
  // A task is either there to remove or not_found: removing never leaves the document unchanged
  noopCaption: () => null,
  undoable: true,
  activity: "show",
  idempotent: false,
  deprecates: ["removeTask"],
  parser: { family: "task", examples: [{ say: "Delete UI Design", fixture: "demo" }] },
  palette: { exempt: "The v0 palette has no remove-task phrase; the parser example covers it." },
  transport: { tool: "task_remove" },
  sample: (fx) => ({ op: "removeTask", taskId: fx.task("UI Design") }),
});
