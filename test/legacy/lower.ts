// Test-only lowering of v0 operations to v2 registry ops and local intents (plan §4.5, §10.4).
// The golden parser test compares applyV2(fastParse(cmd)) with applyV2(lower(legacyParse(cmd))).
//
// One exhaustive switch over the 35 v0 names, the plan §4.5 table:
// - the v2 state is the migration of the v0 document (`idMap` names every v0 id);
// - ids the v0 reducer would have minted are minted with `mint`;
// - a v0 op that has no v2 meaning (an id that is gone, an empty workload move) lowers to nothing,
//   as v0's reducer returned the document unchanged.
//
// Two lowerings say more than the table, so the visible v0 outcome survives the move to a
// workspace with project members (plan §6.5, Team rows are members):
// - addPerson also adds the person to the project (v0's people were the project's team), or only
//   adds an active namesake to it;
// - proposeReassign moves carry an empty `why`: v0 had none, and the canonical comparison leaves
//   it out (the caption carries the reason).
import type { Minter } from "@/lib/domain/ids";
import { CAPACITY_MAX_DAYS } from "@/lib/domain/limits";
import { sortedByOrder, sortedByZ } from "@/lib/domain/order";
import type { PersonId, ProjectId, ProposalId, StepId, TaskId } from "@/lib/domain/schema/ids";
import type { LocalViewState } from "@/lib/domain/schema/local";
import type { IsoDate, ViewKind } from "@/lib/domain/schema/primitives";
import type { ProjectDoc, Task } from "@/lib/domain/schema/project";
import type { WorkspaceDoc } from "@/lib/domain/schema/workspace";
import { addSampleTeam, createDemoProject } from "@/lib/demo/seed";
import { activeNamed } from "@/lib/interpret/fast/match";
import type { IdMap } from "@/lib/migrate/v0/idmap";
import { rewriteBriefKey } from "@/lib/migrate/v0/idmap";
import { addTaskOp, makeOp, type Op, updateTaskOp } from "@/lib/ops/build";
import type { DocsState } from "@/lib/ops/command";
import type { LocalIntent } from "@/lib/ops/local-intents";
import { OperationSchema, type Doc, type Operation } from "./v0/lib/schema";

/** A v0 operation name. */
export type LegacyOpName = Operation["op"];

/** The 35 v0 operation names, read from the frozen schema. */
export const LEGACY_OP_NAMES: readonly LegacyOpName[] = OperationSchema.options.map((o) => o.shape.op.value);

/** Everything the lowering reads. */
export interface LowerContext {
  /** The v0 document the legacy parser read. */
  legacy: Doc;
  /** The v0 selection the command referred to ("this", "it"). */
  selectedId: string | null;
  /** The v2 state the lowered ops apply to (the migration of `legacy`) */
  state: DocsState;
  /** Its active project */
  projectId: ProjectId | null;
  local: LocalViewState;
  /** v0 id → v2 id, from the migration of `legacy` */
  idMap: IdMap;
  /** Mints the ids the lowered ops carry (seeded in tests) */
  mint: Minter;
}

/** What one legacy interpretation becomes: registry ops plus local intents (show, select, zoom). */
export interface Lowered {
  ops: Op[];
  local: LocalIntent[];
}

type Ref = { kind: "task"; taskId: TaskId } | { kind: "step"; taskId: TaskId; stepId: StepId };

/** Exhaustiveness: a v0 name with no case fails to compile */
function never(op: never): never {
  throw new Error(`No lowering for ${JSON.stringify(op)}`);
}

export function lower(ops: readonly Operation[], ctx: LowerContext): Lowered {
  const out: Lowered = { ops: [], local: [] };
  const ws: WorkspaceDoc = ctx.state.workspace;
  const project: ProjectDoc | null = ctx.projectId !== null ? (ctx.state.projects[ctx.projectId] ?? null) : null;
  const views = new Set<ViewKind>(project?.views ?? []);
  const workflow: Task[] = project ? sortedByOrder(project.tasks) : [];
  let lastTask: TaskId | null = workflow.length ? workflow[workflow.length - 1].id : null;
  let pending: { id: ProposalId; subtasks: boolean } | null = project?.proposal ? { id: project.proposal.id, subtasks: project.proposal.kind === "subtasks" } : null;
  const moodIds = project ? sortedByZ(project.moodboard.items).map((it) => it.id) : [];
  const push = (...o: Op[]) => out.ops.push(...o);

  /** A v0 task id as a v2 task or step */
  const ref = (v0Id: string): Ref | null => {
    const task = ctx.idMap.tasks[v0Id];
    if (task && project && Object.hasOwn(project.tasks, task)) return { kind: "task", taskId: task };
    const step = ctx.idMap.steps[v0Id];
    if (step && project) {
      const parent = Object.values(project.tasks).find((t) => t.steps.some((s) => s.id === step));
      if (parent) return { kind: "step", taskId: parent.id, stepId: step };
    }
    return null;
  };
  const person = (v0Id: string): PersonId | null => ctx.idMap.people[v0Id] ?? null;
  const briefKey = (key: string): string | null => {
    const r = rewriteBriefKey(key, { task: (id) => ctx.idMap.tasks[id], person: (id) => ctx.idMap.people[id] });
    return "key" in r ? r.key : null;
  };

  for (const op of ops) {
    switch (op.op) {
      case "createProject": {
        push(
          ...createDemoProject(
            { workspace: ws, project },
            { title: op.title, startAs: op.representation ?? "cards", wantsMoodboard: false, replace: project !== null },
            ctx.mint,
          ),
        );
        break;
      }
      case "renameTool":
        push(makeOp({ op: "updateProject", field: "title", value: op.title }));
        break;
      case "setRepresentation":
        if (!views.has(op.representation)) {
          push(makeOp({ op: "addView", view: op.representation }));
          views.add(op.representation);
        }
        out.local.push({ kind: "show", view: op.representation });
        break;
      case "removeView":
        push(makeOp({ op: "removeView", view: op.representation }));
        break;
      case "setView": {
        const { focusId, ...rest } = op.patch;
        if (Object.keys(rest).length > 0) push(makeOp({ op: "setView", patch: rest }));
        if (focusId !== undefined) {
          const target = focusId === null ? null : ref(focusId);
          if (focusId === null || target?.kind === "task") push(makeOp({ op: "setFocus", taskId: target?.kind === "task" ? target.taskId : null }));
        }
        break;
      }
      case "setFields":
        push(makeOp({ op: "setView", patch: { fields: op.patch } }));
        break;
      case "updateTask": {
        const target = ref(op.id);
        const p = op.patch;
        if (target?.kind === "task") {
          const id = target.taskId;
          // Status last, so it wins (plan §4.5)
          if (p.title !== undefined) push(updateTaskOp(id, "title", p.title));
          if (p.priority !== undefined) push(updateTaskOp(id, "priority", p.priority));
          if (p.estimate !== undefined) push(updateTaskOp(id, "estimateDays", p.estimate));
          if (p.cost !== undefined) push(updateTaskOp(id, "costCents", p.cost === null ? null : Math.round(p.cost * 100)));
          if (p.emphasis !== undefined) push(updateTaskOp(id, "emphasis", p.emphasis));
          if (p.progress !== undefined) push(updateTaskOp(id, "progress", Math.round(p.progress)));
          if (p.status !== undefined) push(updateTaskOp(id, "status", p.status));
        } else if (target?.kind === "step") {
          const step = { op: "updateStep", taskId: target.taskId, stepId: target.stepId } as const;
          if (p.title !== undefined) push(makeOp({ ...step, field: "title", value: p.title }));
          if (p.status !== undefined) push(makeOp({ ...step, field: "done", value: p.status === "done" }));
          if (p.estimate !== undefined) push(makeOp({ ...step, field: "estimateDays", value: p.estimate }));
        }
        break;
      }
      case "addTask": {
        if (op.parentId === null) {
          const taskId = ctx.mint("task");
          push(
            addTaskOp({
              taskId,
              title: op.title,
              dependsOn: project?.autoChain && lastTask ? [lastTask] : [],
              estimateDays: op.estimate,
              priority: op.priority ?? "medium",
            }),
          );
          lastTask = taskId;
        } else {
          const parent = ref(op.parentId);
          if (parent?.kind === "task") {
            push(makeOp({ op: "addStep", taskId: parent.taskId, stepId: ctx.mint("step"), title: op.title, estimateDays: op.estimate, after: "end" }));
          }
        }
        break;
      }
      case "removeTask": {
        const target = ref(op.id);
        if (target?.kind === "task") push(makeOp({ op: "removeTask", taskId: target.taskId }));
        else if (target?.kind === "step") push(makeOp({ op: "removeStep", taskId: target.taskId, stepId: target.stepId }));
        break;
      }
      case "moveTask": {
        const target = ref(op.id);
        if (target?.kind !== "task") break;
        const rest = workflow.filter((t) => t.id !== target.taskId);
        const at = Math.min(op.toIndex, rest.length);
        push(makeOp({ op: "moveTask", taskId: target.taskId, place: at === 0 ? "start" : { after: rest[at - 1].id } }));
        break;
      }
      case "proposeSubtasks": {
        const target = ref(op.parentId);
        if (target?.kind !== "task") break;
        const proposalId = ctx.mint("proposal");
        push(
          makeOp({
            op: "proposeSubtasks",
            proposalId,
            taskId: target.taskId,
            items: op.items.map((i) => ({ stepId: ctx.mint("step"), title: i.title, estimateDays: i.estimate })),
            source: "parser",
          }),
        );
        pending = { id: proposalId, subtasks: true };
        break;
      }
      case "acceptProposal":
        if (pending?.subtasks) push(makeOp({ op: "acceptProposal", proposalId: pending.id }));
        pending = null;
        break;
      case "discardProposal":
        if (pending?.subtasks) push(makeOp({ op: "discardProposal", proposalId: pending.id }));
        pending = null;
        break;
      case "addBlock":
        push(makeOp({ op: "addBlock", block: op.block }));
        break;
      case "removeBlock":
        push(makeOp({ op: "removeBlock", block: op.block }));
        break;
      case "setStartDate":
        push(makeOp({ op: "updateProject", field: "startDate", value: op.date as IsoDate }), makeOp({ op: "updateProject", field: "startConfirmed", value: true }));
        break;
      case "addMoodItems":
        push(
          makeOp({
            op: "addMoodItems",
            items: op.items.map((i) => {
              const at = { ...(i.x !== undefined ? { x: i.x } : {}), ...(i.y !== undefined ? { y: i.y } : {}), ...(i.w !== undefined ? { w: i.w } : {}), ...(i.h !== undefined ? { h: i.h } : {}) };
              const itemId = ctx.mint("moodItem");
              if (i.kind === "image") return { itemId, kind: "image" as const, assetId: (i.asset ? ctx.idMap.assets[i.asset] : undefined) ?? ctx.mint("asset"), text: i.text ?? null, ...at };
              if (i.kind === "color") return { itemId, kind: "color" as const, hex: i.hex ?? "#000000", text: i.text ?? null, ...at };
              return { itemId, kind: "note" as const, text: i.text ?? "", ...at };
            }),
          }),
        );
        break;
      case "updateMoodItem": {
        const itemId = ctx.idMap.moodItems[op.id];
        if (itemId) push(makeOp({ op: "updateMoodItem", itemId, patch: { ...op.patch, ...(op.patch.hex === null ? { hex: undefined } : {}) } as never, toFront: op.raise ?? false }));
        break;
      }
      case "removeMoodItem": {
        const itemId = ctx.idMap.moodItems[op.id];
        if (itemId) push(makeOp({ op: "removeMoodItem", itemId }));
        break;
      }
      case "arrangeMood":
        push(makeOp({ op: "arrangeMood", layout: op.layout, itemIds: moodIds }));
        break;
      case "clearMood":
        push(makeOp({ op: "clearMood", itemIds: moodIds }));
        break;
      case "addPerson": {
        const existing = activeNamed(ws, op.name);
        if (existing !== null) {
          if (!project?.memberIds.includes(existing)) push(makeOp({ op: "addMember", personId: existing }));
          break;
        }
        const personId = ctx.mint("person");
        const capacity = op.capacity !== undefined && op.capacity <= CAPACITY_MAX_DAYS ? op.capacity : null;
        push(
          makeOp({ op: "addPerson", personId, name: op.name, role: op.role ?? null, email: null, capacityDaysPerWeek: capacity, dayRateCents: null }),
          makeOp({ op: "addMember", personId }),
        );
        break;
      }
      case "updatePerson": {
        const personId = person(op.id);
        if (!personId) break;
        if (op.patch.name !== undefined) push(makeOp({ op: "updatePerson", personId, field: "name", value: op.patch.name }));
        if (op.patch.role !== undefined) push(makeOp({ op: "updatePerson", personId, field: "role", value: op.patch.role }));
        if (op.patch.capacity !== undefined) push(makeOp({ op: "updatePerson", personId, field: "capacityDaysPerWeek", value: op.patch.capacity }));
        break;
      }
      case "removePerson": {
        const personId = person(op.id);
        if (personId) push(makeOp({ op: "archivePerson", personId }));
        break;
      }
      case "assignTask": {
        const target = ref(op.taskId);
        if (target?.kind !== "task") break;
        if (op.personId === null) push(makeOp({ op: "unassignTask", taskId: target.taskId }));
        else {
          const personId = person(op.personId);
          if (personId) push(makeOp({ op: "assignTask", taskId: target.taskId, personId }));
        }
        break;
      }
      case "addSampleTeam":
        push(...addSampleTeam(ws, project));
        break;
      case "proposeReassign": {
        const moves = op.moves.flatMap((m) => {
          const target = ref(m.taskId);
          const to = m.to === null ? null : person(m.to);
          if (target?.kind !== "task" || to === null || !project) return [];
          return [{ type: "owner" as const, taskId: target.taskId, from: project.tasks[target.taskId].ownerId, to, why: "" }];
        });
        if (moves.length === 0) break;
        const proposalId = ctx.mint("proposal");
        push(makeOp({ op: "proposeReassign", proposalId, moves, source: "parser" }));
        pending = { id: proposalId, subtasks: false };
        break;
      }
      case "acceptReassign":
        if (pending && !pending.subtasks) push(makeOp({ op: "acceptProposal", proposalId: pending.id }));
        pending = null;
        break;
      case "discardReassign":
        if (pending && !pending.subtasks) push(makeOp({ op: "discardProposal", proposalId: pending.id }));
        pending = null;
        break;
      case "editBriefLine": {
        const key = briefKey(op.key);
        if (key) push(makeOp({ op: "editBriefLine", key, text: op.text, basis: op.basis }));
        break;
      }
      case "resetBriefLine": {
        const key = briefKey(op.key);
        if (key) push(makeOp({ op: "resetBriefLine", keys: [key] }));
        break;
      }
      case "addBriefLine":
        push(makeOp({ op: "addBriefLine", lineId: ctx.mint("briefLine"), audience: op.audience, section: op.section, text: op.text }));
        break;
      case "updateBriefLine": {
        const lineId = ctx.idMap.briefLines[op.id];
        if (!lineId) break;
        // An empty edit removes the line (plan §4.4 row 56: at the producer)
        const text = op.text.replace(/\s+/g, " ").trim();
        push(text ? makeOp({ op: "updateBriefLine", lineId, text }) : makeOp({ op: "removeBriefLine", lineId }));
        break;
      }
      case "removeBriefLine": {
        const lineId = ctx.idMap.briefLines[op.id];
        if (lineId) push(makeOp({ op: "removeBriefLine", lineId }));
        break;
      }
      case "resetBrief":
        push(makeOp({ op: "resetBrief", audience: op.audience }));
        break;
      default:
        never(op);
    }
  }
  return out;
}
