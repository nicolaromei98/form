import { z } from "zod";
import { coherenceProblems } from "@/lib/domain/invariants/transitions";
import { PROPOSAL_ITEMS_MAX, TASKS_MAX } from "@/lib/domain/limits";
import { ProposalId, type TaskId } from "@/lib/domain/schema/ids";
import { type TaskSeed, TaskSeedSchema } from "@/lib/domain/schema/template";
import { defineOp, isRejection, reject } from "@/lib/ops/registry/_contract";
import { formatDays, mustActivePerson, part, title, unique } from "@/lib/ops/registry/_helpers";
import { distinct, freshIds, plural, ProposalSource } from "@/lib/ops/registry/_proposals";

/**
 * Proposes new tasks (plan §4.4 row 44): fully minted, coherent seeds (plan §3.5). A seed waits
 * on earlier seeds of the same plan or on tasks that exist; its owner is an active person. Seeds
 * are normalised on write (plan §5.6): dependencies are deduplicated, and a milestone gets
 * estimate 0 and no steps. The pending proposal is replaced, and undo restores it.
 */

/** "no estimates yet", "2 without an estimate" or "14d of work" */
function estimateNote(seeds: readonly TaskSeed[]): string {
  const work = seeds.filter((s) => s.kind === "task");
  if (work.length === 0) return "milestones only";
  const unknown = work.filter((s) => s.estimateDays === null).length;
  if (unknown === work.length) return unknown === 1 ? "no estimate yet" : "no estimates yet";
  if (unknown > 0) return `${unknown} without an estimate`;
  return `${formatDays(work.reduce((s, t) => s + (t.estimateDays ?? 0), 0))}d of work`;
}

export default defineOp({
  name: "proposePlan",
  scope: "project",
  schema: z
    .object({
      op: z.literal("proposePlan"),
      proposalId: ProposalId,
      tasks: z
        .array(TaskSeedSchema)
        .min(1)
        .max(PROPOSAL_ITEMS_MAX)
        .refine((seeds) => distinct(seeds.map((s) => s.taskId)), "Each proposed task needs its own id")
        .refine((seeds) => distinct(seeds.flatMap((s) => s.steps.map((st) => st.stepId))), "Each proposed step needs its own id"),
      source: ProposalSource,
    })
    .strict(),

  reduce(d, op, ctx) {
    const count = Object.keys(d.tasks).length + op.tasks.length;
    if (count > TASKS_MAX) return reject("limit", `That plan would make ${count} tasks: a project holds at most ${TASKS_MAX}.`);
    const taken = freshIds(d, [op.proposalId, ...op.tasks.flatMap((s) => [s.taskId, ...s.steps.map((st) => st.stepId)])]);
    if (taken) return taken;

    const earlier = new Set<TaskId>();
    const seeds: TaskSeed[] = [];
    for (const seed of op.tasks) {
      const name = title(seed.title);
      const dependsOn = unique(seed.dependsOn);
      if (dependsOn.includes(seed.taskId)) return reject("self_dependency", `${name} can't wait on itself.`);
      if (dependsOn.some((id) => !earlier.has(id) && !Object.hasOwn(d.tasks, id))) {
        return reject("not_found", `${name} waits on a task that isn't in this project or comes later in the plan.`);
      }
      const milestone = seed.kind === "milestone";
      if (!milestone && seed.estimateDays === 0) return reject("invalid_payload", "An estimate is at least half a day.");
      if (milestone && seed.status !== "todo" && seed.status !== "done") {
        return reject("invalid_state", `${name} is a milestone: it's either to do or done.`);
      }
      const problem = coherenceProblems({ status: seed.status, progress: seed.progress, completedAt: null }, d.requireReview)[0];
      if (problem) return reject("invalid_state", `${name}: ${problem}`);
      if (seed.ownerId !== null) {
        const owner = mustActivePerson(ctx.workspace, seed.ownerId);
        if (isRejection(owner)) return owner;
      }
      seeds.push({
        ...seed,
        dependsOn,
        estimateDays: milestone ? 0 : seed.estimateDays,
        steps: milestone ? [] : seed.steps.map((s) => ({ stepId: s.stepId, title: s.title, estimateDays: s.estimateDays })),
      });
      earlier.add(seed.taskId);
    }

    d.proposal = { id: op.proposalId, createdAt: ctx.now, source: op.source, kind: "plan", tasks: seeds };
  },

  // "Proposal · 8 tasks, no estimates yet"
  caption: ({ op }) => part(`Proposal · ${plural(op.tasks.length, "task")}, ${estimateNote(op.tasks)}`, undefined, "proposal"),
  // A proposal always carries a fresh id: proposing applies or is refused, never a no-op
  noopCaption: () => null,
  undoable: true,
  activity: "show",
  idempotent: false,
  deprecates: [],
  parser: { exempt: "Proposed plans come from the Phase 5 agent; there is no command yet.", until: 5 },
  palette: { exempt: "No palette phrase for a proposed plan until the Phase 5 parser.", until: 5 },
  transport: { tool: "propose", action: "plan" },
  // Copywriting after UI Design, then a launch milestone after Development and Copywriting
  sample: (fx, mint) => {
    const copy = mint("task");
    const seed = (taskId: string, title: string, kind: "task" | "milestone", dependsOn: string[]) => ({
      taskId,
      title,
      kind,
      estimateDays: null,
      dependsOn,
      status: "todo",
      priority: "medium",
      progress: 0,
      ownerId: null,
      emphasis: false,
      steps: [],
    });
    return {
      op: "proposePlan",
      proposalId: mint("proposal"),
      tasks: [
        seed(copy, "Copywriting", "task", [fx.task("UI Design")]),
        { ...seed(mint("task"), "Launch", "milestone", [fx.task("Development"), copy]), estimateDays: 0 },
      ],
      source: "agent",
    };
  },
});
