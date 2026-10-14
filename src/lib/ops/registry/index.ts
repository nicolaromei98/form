import { z } from "zod";
import type { AnyOpDef, OpDef, Scope } from "@/lib/ops/registry/_contract";
import acceptProposal from "@/lib/ops/registry/project/acceptProposal";
import addBlock from "@/lib/ops/registry/project/addBlock";
import addBriefLine from "@/lib/ops/registry/project/addBriefLine";
import addDependency from "@/lib/ops/registry/project/addDependency";
import addLink from "@/lib/ops/registry/project/addLink";
import addMember from "@/lib/ops/registry/project/addMember";
import addMoodItems from "@/lib/ops/registry/project/addMoodItems";
import addStep from "@/lib/ops/registry/project/addStep";
import addTask from "@/lib/ops/registry/project/addTask";
import addView from "@/lib/ops/registry/project/addView";
import arrangeMood from "@/lib/ops/registry/project/arrangeMood";
import assignTask from "@/lib/ops/registry/project/assignTask";
import clearMood from "@/lib/ops/registry/project/clearMood";
import discardProposal from "@/lib/ops/registry/project/discardProposal";
import editBriefLine from "@/lib/ops/registry/project/editBriefLine";
import markBriefSent from "@/lib/ops/registry/project/markBriefSent";
import moveTask from "@/lib/ops/registry/project/moveTask";
import pinStart from "@/lib/ops/registry/project/pinStart";
import proposeEstimates from "@/lib/ops/registry/project/proposeEstimates";
import proposeLeveling from "@/lib/ops/registry/project/proposeLeveling";
import proposePlan from "@/lib/ops/registry/project/proposePlan";
import proposeReassign from "@/lib/ops/registry/project/proposeReassign";
import proposeSubtasks from "@/lib/ops/registry/project/proposeSubtasks";
import rebalanceOrder from "@/lib/ops/registry/project/rebalanceOrder";
import removeBlock from "@/lib/ops/registry/project/removeBlock";
import removeBriefLine from "@/lib/ops/registry/project/removeBriefLine";
import removeDependency from "@/lib/ops/registry/project/removeDependency";
import removeLink from "@/lib/ops/registry/project/removeLink";
import removeMember from "@/lib/ops/registry/project/removeMember";
import removeMoodItem from "@/lib/ops/registry/project/removeMoodItem";
import removeStep from "@/lib/ops/registry/project/removeStep";
import removeTask from "@/lib/ops/registry/project/removeTask";
import removeView from "@/lib/ops/registry/project/removeView";
import reorderStep from "@/lib/ops/registry/project/reorderStep";
import resetBrief from "@/lib/ops/registry/project/resetBrief";
import resetBriefLine from "@/lib/ops/registry/project/resetBriefLine";
import setBriefSharing from "@/lib/ops/registry/project/setBriefSharing";
import setFocus from "@/lib/ops/registry/project/setFocus";
import setView from "@/lib/ops/registry/project/setView";
import unassignTask from "@/lib/ops/registry/project/unassignTask";
import unpinStart from "@/lib/ops/registry/project/unpinStart";
import updateBriefLine from "@/lib/ops/registry/project/updateBriefLine";
import updateMoodItem from "@/lib/ops/registry/project/updateMoodItem";
import updateProject from "@/lib/ops/registry/project/updateProject";
import updateStep from "@/lib/ops/registry/project/updateStep";
import updateTask from "@/lib/ops/registry/project/updateTask";
import addClosure from "@/lib/ops/registry/workspace/addClosure";
import addPerson from "@/lib/ops/registry/workspace/addPerson";
import addTimeOff from "@/lib/ops/registry/workspace/addTimeOff";
import archivePerson from "@/lib/ops/registry/workspace/archivePerson";
import archiveProject from "@/lib/ops/registry/workspace/archiveProject";
import createProject from "@/lib/ops/registry/workspace/createProject";
import deletePerson from "@/lib/ops/registry/workspace/deletePerson";
import deleteProject from "@/lib/ops/registry/workspace/deleteProject";
import deleteTemplate from "@/lib/ops/registry/workspace/deleteTemplate";
import duplicateProject from "@/lib/ops/registry/workspace/duplicateProject";
import linkPersonToMe from "@/lib/ops/registry/workspace/linkPersonToMe";
import removeClosure from "@/lib/ops/registry/workspace/removeClosure";
import removeTimeOff from "@/lib/ops/registry/workspace/removeTimeOff";
import restorePerson from "@/lib/ops/registry/workspace/restorePerson";
import restoreProject from "@/lib/ops/registry/workspace/restoreProject";
import saveTemplate from "@/lib/ops/registry/workspace/saveTemplate";
import setWorkspaceCalendar from "@/lib/ops/registry/workspace/setWorkspaceCalendar";
import updatePerson from "@/lib/ops/registry/workspace/updatePerson";
import updateTemplate from "@/lib/ops/registry/workspace/updateTemplate";
import updateWorkspace from "@/lib/ops/registry/workspace/updateWorkspace";

/**
 * The operation registry (plan §4): the 66 ops, imported explicitly so the bundler keeps the
 * graph static. This file is written once (step 9) and never edited by the step 10 families:
 * each fills its own op files, and the types below follow their schemas.
 */

/** In plan §4.4 order: the 20 workspace ops, then the 46 project ops */
const DEFS = [
  updateWorkspace,
  setWorkspaceCalendar,
  addClosure,
  removeClosure,
  addPerson,
  updatePerson,
  archivePerson,
  restorePerson,
  deletePerson,
  linkPersonToMe,
  addTimeOff,
  removeTimeOff,
  saveTemplate,
  updateTemplate,
  deleteTemplate,
  createProject,
  duplicateProject,
  archiveProject,
  restoreProject,
  deleteProject,
  updateProject,
  addMember,
  removeMember,
  addLink,
  removeLink,
  addTask,
  updateTask,
  removeTask,
  moveTask,
  addDependency,
  removeDependency,
  pinStart,
  unpinStart,
  assignTask,
  unassignTask,
  addStep,
  updateStep,
  removeStep,
  reorderStep,
  proposeSubtasks,
  proposeReassign,
  proposeLeveling,
  proposeEstimates,
  proposePlan,
  acceptProposal,
  discardProposal,
  addView,
  removeView,
  setView,
  setFocus,
  addBlock,
  removeBlock,
  editBriefLine,
  resetBriefLine,
  addBriefLine,
  updateBriefLine,
  removeBriefLine,
  resetBrief,
  markBriefSent,
  setBriefSharing,
  addMoodItems,
  updateMoodItem,
  removeMoodItem,
  arrangeMood,
  clearMood,
  rebalanceOrder,
] as const;

type Def = (typeof DEFS)[number];
type PayloadOf<D> = D extends OpDef<string, Scope, infer P> ? P : never;
type ScopedPayload<D, S extends Scope> = D extends OpDef<string, S, infer P> ? P : never;

/** Every registry op payload */
export type Op = PayloadOf<Def>;
export type OpName = Op["op"];
export type WorkspaceOp = ScopedPayload<Def, "workspace">;
export type ProjectOp = ScopedPayload<Def, "project">;
/** The payload of one op: `OpOf<"addTask">` */
export type OpOf<N extends OpName> = Extract<Op, { op: N }>;

/** Every op name, in plan §4.4 order */
export const OP_NAMES: readonly OpName[] = DEFS.map((d) => d.name);

/** Name → definition. `REGISTRY.get(name)` is undefined for anything that isn't a registry op. */
export const REGISTRY: ReadonlyMap<string, AnyOpDef> = new Map(DEFS.map((d) => [d.name, d as unknown as AnyOpDef]));

/** Ops only the command runner emits: they don't count toward the 12 per command and have no caption */
export const SYSTEM_OPS: ReadonlySet<string> = new Set<OpName>(["rebalanceOrder"]);

/** The definition behind a raw payload, if its `op` names one */
export function defOf(raw: unknown): AnyOpDef | undefined {
  const name = typeof raw === "object" && raw !== null ? (raw as { op?: unknown }).op : undefined;
  return typeof name === "string" ? REGISTRY.get(name) : undefined;
}

export function isSystemOp(raw: unknown): boolean {
  const def = defOf(raw);
  return def !== undefined && SYSTEM_OPS.has(def.name);
}

/** Every op schema is a strict object or a discriminated union of them, so each one is discriminable on "op" */
const schemas = (scope?: Scope) =>
  DEFS.filter((d) => scope === undefined || d.scope === scope).map((d) => d.schema) as unknown as Parameters<
    typeof z.discriminatedUnion
  >[1];

/** Any registry op, parsed by its own strict schema (a discriminated union on "op") */
export const OpSchema = z.discriminatedUnion("op", schemas()) as unknown as z.ZodType<Op>;
export const WorkspaceOpSchema = z.discriminatedUnion("op", schemas("workspace")) as unknown as z.ZodType<WorkspaceOp>;
export const ProjectOpSchema = z.discriminatedUnion("op", schemas("project")) as unknown as z.ZodType<ProjectOp>;

export type { AnyOpDef } from "@/lib/ops/registry/_contract";
