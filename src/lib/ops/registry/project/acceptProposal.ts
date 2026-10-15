import { z } from "zod";
import { applyProgress, applyStatus } from "@/lib/domain/invariants/transitions";
import { DEPS_MAX, MEMBERS_MAX, PROPOSAL_BULK_MAX, STEPS_MAX, TASKS_MAX } from "@/lib/domain/limits";
import { nKeysBetween } from "@/lib/domain/order";
import { ProposalId, StepId, TaskId } from "@/lib/domain/schema/ids";
import type { IsoDate } from "@/lib/domain/schema/primitives";
import type { ProjectDoc, Task } from "@/lib/domain/schema/project";
import type {
  EstimateItem,
  EstimatesProposal,
  LevelingMove,
  LevelingProposal,
  PlanProposal,
  ReassignMove,
  ReassignProposal,
  SubtasksProposal,
} from "@/lib/domain/schema/proposal";
import type { StepSeed, TaskSeed } from "@/lib/domain/schema/template";
import type { WorkspaceDoc } from "@/lib/domain/schema/workspace";
import { type CaptionPart, defineOp, isRejection, type Rejection, reject } from "@/lib/ops/registry/_contract";
import { baseOf, formatDays, part, setIfChanged, title, unique, workflowOf } from "@/lib/ops/registry/_helpers";
import { freshOutsideProposal, isActivePerson, plural } from "@/lib/ops/registry/_proposals";

/**
 * Accepts the pending proposal, whole or in part (plan §5.6; v0 acceptProposal and
 * acceptReassign). The id must name the pending proposal (`stale_proposal`); `only` picks items
 * by their key (the step id of a proposed step, else the task id), and the rest are left out.
 * A chosen item that no longer applies (the task was done or changed hands since, the receiver
 * left the team, the value is already there) is skipped. The proposal then becomes null, even
 * after a partial accept: what was left out goes with it, and undo brings it all back.
 *
 * - subtasks: the steps join the task, each keeping its proposed id (the morph keeps its identity);
 * - reassign: owners change (the receiver joins the members) and pinned starts move;
 * - leveling: pinned starts move;
 * - estimates: estimates are set;
 * - plan: the seeds become tasks at the end of the workflow, through the status table. A chosen
 *   seed that waits on a left-out one inherits what that one waited on, as removeTask bridges.
 *   An owner who left the team since leaves the task unassigned; the others join the members.
 *
 * The ids a proposal creates are fresh by invariant (plan §3.8 P3); they are checked again outside
 * the proposal itself, and a collision is `duplicate_id`, never re-minted.
 *
 * - Payload: proposalId, only?: (StepId | TaskId)[] 1–150
 * - Caption: "4 steps added to UI Design" · "1 task reassigned" · "2 steps added to UI Design · 2 left out"
 *   · rejected `stale_proposal`
 */

const Payload = z
  .object({
    op: z.literal("acceptProposal"),
    proposalId: ProposalId,
    only: z.array(z.union([StepId, TaskId])).min(1).max(PROPOSAL_BULK_MAX).optional(),
  })
  .strict();
type Payload = z.infer<typeof Payload>;

interface Split<T> {
  /** Chosen items that still apply */
  live: T[];
  /** Chosen items skipped because they no longer apply */
  stale: number;
  /** Items `only` left out */
  leftOut: number;
}

type Accepting =
  | ({ kind: "subtasks"; proposal: SubtasksProposal } & Split<StepSeed>)
  | ({ kind: "reassign"; proposal: ReassignProposal } & Split<ReassignMove>)
  | ({ kind: "leveling"; proposal: LevelingProposal } & Split<LevelingMove>)
  | ({ kind: "estimates"; proposal: EstimatesProposal } & Split<EstimateItem>)
  | ({ kind: "plan"; proposal: PlanProposal } & Split<TaskSeed>);

function split<T>(items: readonly T[], key: (item: T) => string, applies: (item: T) => boolean, only: Payload["only"]): Split<T> | Rejection {
  const wanted = only ? new Set<string>(only) : null;
  const chosen = wanted ? items.filter((item) => wanted.has(key(item))) : [...items];
  if (chosen.length === 0) return reject("not_found", "None of those are in the proposal anymore.");
  const live = chosen.filter(applies);
  return { live, stale: chosen.length - live.length, leftOut: items.length - chosen.length };
}

/** A start move still changes something on open work */
const movesStart = (t: Task | null, pinnedStart: IsoDate) => t !== null && t.status !== "done" && t.pinnedStart !== pinnedStart;

/**
 * What accepting would do on this document: the same answer for the recipe and the caption, so
 * the caption counts exactly what applied. `ws` is the workspace the recipe reads (Q7).
 */
function accepting(doc: ProjectDoc, ws: Pick<WorkspaceDoc, "people">, op: Payload): Accepting | Rejection {
  const p = doc.proposal;
  if (p === null) return reject("stale_proposal", "There's no proposal waiting anymore.");
  if (p.id !== op.proposalId) return reject("stale_proposal", "That proposal was replaced by a newer one.");
  const task = (id: TaskId): Task | null => (Object.hasOwn(doc.tasks, id) ? doc.tasks[id] : null);
  switch (p.kind) {
    case "subtasks": {
      const target = task(p.taskId);
      const s = split(p.items, (i) => i.stepId, () => target !== null && target.kind === "task", op.only);
      return isRejection(s) ? s : { kind: "subtasks", proposal: p, ...s };
    }
    case "reassign": {
      const applies = (m: ReassignMove) => {
        const t = task(m.taskId);
        if (m.type === "shift") return movesStart(t, m.pinnedStart);
        return t !== null && t.status !== "done" && t.ownerId === m.from && m.to !== m.from && isActivePerson(ws, m.to);
      };
      const s = split(p.moves, (m) => m.taskId, applies, op.only);
      return isRejection(s) ? s : { kind: "reassign", proposal: p, ...s };
    }
    case "leveling": {
      const s = split(p.moves, (m) => m.taskId, (m) => movesStart(task(m.taskId), m.pinnedStart), op.only);
      return isRejection(s) ? s : { kind: "leveling", proposal: p, ...s };
    }
    case "estimates": {
      const applies = (i: EstimateItem) => {
        const t = task(i.taskId);
        return t !== null && t.kind === "task" && t.estimateDays !== i.estimateDays;
      };
      const s = split(p.items, (i) => i.taskId, applies, op.only);
      return isRejection(s) ? s : { kind: "estimates", proposal: p, ...s };
    }
    case "plan": {
      const s = split(p.tasks, (seed) => seed.taskId, () => true, op.only);
      return isRejection(s) ? s : { kind: "plan", proposal: p, ...s };
    }
  }
}

/** Adds the person to the project's members, like assignTask; `limit` past MEMBERS_MAX */
function join(d: ProjectDoc, id: Task["ownerId"]): Rejection | void {
  if (id === null || d.memberIds.includes(id)) return;
  if (d.memberIds.length >= MEMBERS_MAX) return reject("limit", `A project has at most ${MEMBERS_MAX} members.`);
  d.memberIds.push(id);
}

/** The chosen seeds of a plan become tasks at the end of the workflow */
function addSeeds(
  d: ProjectDoc,
  base: ProjectDoc,
  all: readonly TaskSeed[],
  chosen: readonly TaskSeed[],
  ws: Pick<WorkspaceDoc, "people">,
  now: Task["createdAt"],
): Rejection | void {
  const count = Object.keys(base.tasks).length + chosen.length;
  if (count > TASKS_MAX) return reject("limit", `That would make ${count} tasks: a project holds at most ${TASKS_MAX}.`);
  const taken = freshOutsideProposal(base, chosen.flatMap((s) => [s.taskId, ...s.steps.map((st) => st.stepId)]));
  if (taken) return taken;
  const keep = new Set<TaskId>(chosen.map((s) => s.taskId));
  // A left-out seed stands for what it waited on, so the chosen seeds after it keep their place in the chain
  const bridged = new Map<TaskId, TaskId[]>();
  const resolve = (ids: readonly TaskId[]) =>
    unique(ids.flatMap((id) => (keep.has(id) || Object.hasOwn(base.tasks, id) ? [id] : (bridged.get(id) ?? []))));
  const workflow = workflowOf(base);
  const keys = nKeysBetween(workflow.length ? workflow[workflow.length - 1].order : null, null, chosen.length);
  let k = 0;
  for (const seed of all) {
    const dependsOn = resolve(seed.dependsOn);
    if (!keep.has(seed.taskId)) {
      bridged.set(seed.taskId, dependsOn);
      continue;
    }
    if (dependsOn.length > DEPS_MAX) return reject("limit", `${title(seed.title)} would wait on more than ${DEPS_MAX} tasks.`);
    const milestone = seed.kind === "milestone";
    // An owner who left the team since leaves the task unassigned (Q7)
    const ownerId = seed.ownerId !== null && isActivePerson(ws, seed.ownerId) ? seed.ownerId : null;
    const joined = join(d, ownerId);
    if (joined) return joined;
    const task: Task = {
      id: seed.taskId,
      title: seed.title,
      kind: seed.kind,
      description: null,
      status: "todo",
      priority: seed.priority,
      progress: 0,
      estimateDays: milestone ? 0 : seed.estimateDays,
      allocation: 1,
      pinnedStart: null,
      dueDate: null,
      dependsOn,
      ownerId,
      costCents: null,
      tags: [],
      links: [],
      emphasis: seed.emphasis,
      steps: milestone ? [] : seed.steps.map((s) => ({ id: s.stepId, title: s.title, done: false, ownerId: null, estimateDays: s.estimateDays })),
      order: keys[k++],
      createdAt: now,
      completedAt: null,
    };
    // Through the status table (plan §5.5), from To do at 0%. Seeds are coherent (proposePlan
    // checks them), so status then progress lands exactly on the seed's pair, and only a seed that
    // is In progress starts a project still in planning
    const refused = applyStatus(task, seed.status, d, now) ?? applyProgress(task, seed.progress, d, now);
    if (refused) return refused;
    d.tasks[seed.taskId] = task;
  }
}

export default defineOp({
  name: "acceptProposal",
  scope: "project",
  schema: Payload,

  reduce(d, op, ctx) {
    const base: ProjectDoc = baseOf(d);
    const a = accepting(base, ctx.workspace, op);
    if (isRejection(a)) return a;
    switch (a.kind) {
      case "subtasks": {
        if (a.live.length === 0) break;
        const task = d.tasks[a.proposal.taskId];
        const count = task.steps.length + a.live.length;
        if (count > STEPS_MAX) return reject("limit", `${title(task.title)} would have ${count} steps: a task holds at most ${STEPS_MAX}.`);
        const taken = freshOutsideProposal(base, a.live.map((s) => s.stepId));
        if (taken) return taken;
        // Each step keeps its proposed id, so the proposed row becomes the step (the morph keeps its identity)
        for (const s of a.live) task.steps.push({ id: s.stepId, title: s.title, done: false, ownerId: null, estimateDays: s.estimateDays });
        break;
      }
      case "reassign":
        for (const m of a.live) {
          const task = d.tasks[m.taskId];
          if (m.type === "shift") {
            setIfChanged(task, "pinnedStart", m.pinnedStart);
            continue;
          }
          // The receiver joins the project, as assignTask does
          const joined = join(d, m.to);
          if (joined) return joined;
          setIfChanged(task, "ownerId", m.to);
        }
        break;
      case "leveling":
        for (const m of a.live) setIfChanged(d.tasks[m.taskId], "pinnedStart", m.pinnedStart);
        break;
      case "estimates":
        for (const i of a.live) setIfChanged(d.tasks[i.taskId], "estimateDays", i.estimateDays);
        break;
      case "plan": {
        const refused = addSeeds(d, base, a.proposal.tasks, a.live, ctx.workspace, ctx.now);
        if (refused) return refused;
        break;
      }
    }
    d.proposal = null;
  },

  // "4 steps added to UI Design" · "1 task reassigned", then what was left out or skipped
  caption({ op, before, after, env }) {
    const a = accepting(before, env.workspace(), op);
    if (isRejection(a)) return null;
    const n = a.live.length;
    if (n === 0) return part(op.only ? "Proposal closed · none of the chosen items still apply" : "Proposal closed · nothing in it still applies");
    const parts: CaptionPart[] = [];
    switch (a.kind) {
      case "subtasks":
        parts.push(part(`${plural(n, "step")} added to ${title(after.tasks[a.proposal.taskId].title)}`, undefined, "done"));
        break;
      case "reassign": {
        const owners = a.live.filter((m) => m.type === "owner").length;
        if (owners > 0) parts.push(part(`${plural(owners, "task")} reassigned`, undefined, "done"));
        if (n > owners) parts.push(part(`${plural(n - owners, "start")} moved`, undefined, "done"));
        break;
      }
      case "leveling":
        parts.push(part(`${plural(n, "start")} moved`, undefined, "done"));
        break;
      case "estimates": {
        const [first] = a.live;
        parts.push(
          part(n === 1 ? `${title(after.tasks[first.taskId].title)} estimated at ${formatDays(first.estimateDays)}d` : `Estimates set for ${n} tasks`, undefined, "done"),
        );
        break;
      }
      case "plan":
        parts.push(part(`${plural(n, "task")} added`, undefined, "done"));
        break;
    }
    if (a.leftOut > 0) parts.push(part(`${a.leftOut} left out`));
    if (a.stale > 0) parts.push(part(`${a.stale} no longer appl${a.stale === 1 ? "ies" : "y"}`));
    return parts;
  },
  // Accepting always resolves the pending proposal or is refused (stale_proposal): never a no-op
  noopCaption: () => null,
  undoable: true,
  activity: "show",
  idempotent: false,
  deprecates: ["acceptProposal", "acceptReassign"],
  parser: {
    family: "control",
    examples: [
      { say: "Accept them", fixture: "demoProposal" },
      { say: "Accept the plan", fixture: "demoPlan" },
    ],
  },
  palette: { exempt: "The v0 palette has no accept phrase; the parser examples cover it." },
  transport: { tool: "proposal", action: "accept" },
  sampleOn: "demoProposal",
  sample: (fx) => {
    const pending = fx.project?.proposal;
    if (!pending) throw new Error(`Fixture ${fx.name} has no pending proposal`);
    return { op: "acceptProposal", proposalId: pending.id };
  },
});
