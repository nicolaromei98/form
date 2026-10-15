import { z } from "zod";
import { PROPOSAL_ITEMS_MAX, STEPS_MAX } from "@/lib/domain/limits";
import { ProposalId, TaskId } from "@/lib/domain/schema/ids";
import { type StepSeed, StepSeedSchema } from "@/lib/domain/schema/template";
import { defineOp, isRejection, reject } from "@/lib/ops/registry/_contract";
import { formatDays, mustTask, part, title } from "@/lib/ops/registry/_helpers";
import { distinct, freshIds, plural, ProposalSource } from "@/lib/ops/registry/_proposals";

/**
 * Proposes steps for one task (plan §4.4 row 40; v0 proposeSubtasks). The pending proposal is
 * replaced, and undo restores it. The step ids are minted by the producer and kept when the
 * proposal is accepted, so the proposed row morphs into the real step. Only a task (never a
 * milestone) takes steps, and the steps it would end up with stay within the 40-step limit.
 *
 * - Payload: proposalId, taskId, items {stepId, title, estimateDays|null}[] 1–12, source
 *   (parser|agent|direct: who proposed it, stored on the proposal)
 * - Caption: "4 steps proposed for UI Design · fits its 6d estimate. Review them on the task."
 */

/**
 * What the caption says about the estimates (plan §8.4): "fits its 6d estimate" only when the
 * steps add up exactly to the task's estimate; "no estimates" when none is known.
 */
function estimateNote(items: readonly StepSeed[], estimate: number | null): string {
  const known = items.filter((i) => i.estimateDays !== null);
  if (known.length === 0) return items.length === 1 ? " · no estimate" : " · no estimates";
  if (known.length < items.length) return ` · ${plural(items.length - known.length, "step")} without an estimate`;
  const sum = known.reduce((s, i) => s + (i.estimateDays ?? 0), 0);
  if (estimate !== null && sum === estimate) return ` · fits its ${formatDays(estimate)}d estimate`;
  return ` · ${formatDays(sum)}d in all`;
}

export default defineOp({
  name: "proposeSubtasks",
  scope: "project",
  schema: z
    .object({
      op: z.literal("proposeSubtasks"),
      proposalId: ProposalId,
      taskId: TaskId,
      items: z
        .array(StepSeedSchema)
        .min(1)
        .max(PROPOSAL_ITEMS_MAX)
        .refine((items) => distinct(items.map((i) => i.stepId)), "Each proposed step needs its own id"),
      source: ProposalSource,
    })
    .strict(),

  reduce(d, op, ctx) {
    const task = mustTask(d, op.taskId);
    if (isRejection(task)) return task;
    if (task.kind !== "task") return reject("invalid_state", `${title(task.title)} is a milestone: it takes no steps.`);
    if (task.steps.length + op.items.length > STEPS_MAX) {
      return reject("limit", `${title(task.title)} would have ${task.steps.length + op.items.length} steps: a task holds at most ${STEPS_MAX}.`);
    }
    const taken = freshIds(d, [op.proposalId, ...op.items.map((i) => i.stepId)]);
    if (taken) return taken;
    d.proposal = {
      id: op.proposalId,
      createdAt: ctx.now,
      source: op.source,
      kind: "subtasks",
      taskId: op.taskId,
      items: op.items.map((i) => ({ stepId: i.stepId, title: i.title, estimateDays: i.estimateDays })),
    };
  },

  caption({ op, after }) {
    const task = after.tasks[op.taskId];
    const n = op.items.length;
    const note = estimateNote(op.items, task.estimateDays);
    return part(`${plural(n, "step")} proposed for ${title(task.title)}${note}. Review ${n === 1 ? "it" : "them"} on the task.`, undefined, "proposal");
  },
  // A proposal always carries a fresh id: proposing applies or is refused, never a no-op
  noopCaption: () => null,
  undoable: true,
  activity: "show",
  idempotent: false,
  deprecates: ["proposeSubtasks"],
  parser: { family: "task", examples: [{ say: "Break UI Design into smaller steps", fixture: "demo" }] },
  palette: [
    {
      group: "Selected task",
      phrase: "Break this task into smaller steps",
      rank: 10,
      needs: "selection",
      fixture: "demoSelected",
      surfaces: ["demo", "app"],
    },
  ],
  transport: { tool: "propose", action: "subtasks" },
  // The v0 breakdown of UI Design: 1.5 + 2 + 1.5 + 1 = its 6 days
  sample: (fx, mint) => ({
    op: "proposeSubtasks",
    proposalId: mint("proposal"),
    taskId: fx.task("UI Design"),
    items: [
      { stepId: mint("step"), title: "Wireframes & flows", estimateDays: 1.5 },
      { stepId: mint("step"), title: "Key screens", estimateDays: 2 },
      { stepId: mint("step"), title: "Component library", estimateDays: 1.5 },
      { stepId: mint("step"), title: "Prototype & handoff", estimateDays: 1 },
    ],
    source: "parser",
  }),
});
