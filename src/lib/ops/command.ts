import { COMMAND_TEXT, OPS_PER_COMMAND, ORDER_KEY_REBALANCE } from "@/lib/domain/limits";
import { compareKeys, nKeys } from "@/lib/domain/order";
import type { Commit } from "@/lib/domain/schema/commit";
import type { PersonId, ProjectId, TaskId, WorkspaceId } from "@/lib/domain/schema/ids";
import { defaultLocalViewState, type LocalViewState } from "@/lib/domain/schema/local";
import type { IsoDate, OrderKey, Timestamp, ViewKind } from "@/lib/domain/schema/primitives";
import type { ProjectDoc } from "@/lib/domain/schema/project";
import type { WorkspaceDoc } from "@/lib/domain/schema/workspace";
import { addedViews as viewsAdded, homeView } from "@/lib/domain/views";
import { type Caption, composeCaption, type Expansion, type OpOutcome } from "@/lib/ops/caption";
import { type CaptionPlanning, makeCaptionEnv } from "@/lib/ops/caption-env";
import { applyLocal, type LocalIntent } from "@/lib/ops/local-intents";
import type { NoticeKey } from "@/lib/ops/notices";
import type { QueryNote } from "@/lib/ops/queries";
import { type AnyDoc, applyCommit, applyOp, type CommitResult } from "@/lib/ops/reduce";
import { defOf, isSystemOp, type Op } from "@/lib/ops/registry";
import { type ReduceCtx, reject } from "@/lib/ops/registry/_contract";
import { idsInWorkflow, longestOrderKey } from "@/lib/ops/registry/_helpers";

/**
 * Commands across documents (plan §5.7). A command is the unit of intent: registry ops for the
 * workspace and at most one project, local intents, query notes and notices. The runner applies
 * the workspace commit first (it may spawn the project the rest targets), then the project
 * commit, then the local effects, and composes one caption. No op ever touches two documents.
 */

export interface DocsState {
  readonly workspace: WorkspaceDoc;
  readonly projects: Readonly<Record<ProjectId, ProjectDoc>>;
}

export interface Command {
  ops: readonly Op[];
  local: readonly LocalIntent[];
  notes: readonly QueryNote[];
  notices: readonly NoticeKey[];
  reply?: { tone: "clarify"; text: string };
  source: "direct" | "agent" | "system";
  /** The command text, when there is one (stored with the commits) */
  text: string | null;
  /** false for direct edits: no caption unless something is refused or a proposal resolves (v0 parity) */
  caption?: boolean;
  /** The demo expansion the producer ran, so its ops speak as one (caption policy rule 3) */
  expansion?: Expansion;
}

export interface CommandCtx {
  now: Timestamp;
  actorId: string | null;
  /** The active project before the command */
  projectId: ProjectId | null;
  /** Its local view state */
  local: LocalViewState;
  today: IsoDate;
  /** Commit and group ids: crypto.randomUUID in the store, seeded in tests; never inside lib/ops */
  newId: () => string;
  /** The planning engine for captions (plan, lanes, focus); see caption-env.ts */
  planning?: CaptionPlanning;
}

export interface DocCommit {
  docId: WorkspaceId | ProjectId;
  /** The commit id (`newId()`) */
  id: string;
  result: CommitResult<AnyDoc>;
}

export interface CommandResult {
  state: DocsState;
  /** Whether any document changed: a history entry, a log entry and a save */
  changed: boolean;
  /** Shared by the command's commits; null when nothing changed */
  groupId: string | null;
  commits: DocCommit[];
  spawned: ProjectDoc[];
  local: LocalViewState;
  projectId: ProjectId | null;
  caption: Caption | null;
  /** Every op of the command, in the order it ran, with the document it saw */
  outcomes: OpOutcome[];
  /** Views the command created on the same project, in creation order */
  addedViews: ViewKind[];
}

const LIMIT_MESSAGE = `A command can change at most ${OPS_PER_COMMAND} things.`;
const NO_PROJECT_MESSAGE = "Create a project first.";

/** Live = neither archived nor deleted in the index (a project with no entry counts as live) */
function isLive(ws: WorkspaceDoc, id: ProjectId): boolean {
  const entry = ws.projects[id];
  return !entry || (entry.archivedAt === null && entry.deletedAt === null);
}

/** A project ops may target and the user may stay on: it exists and isn't deleted (archived is fine) */
function isOpen(ws: WorkspaceDoc, projects: Readonly<Record<ProjectId, ProjectDoc>>, id: ProjectId | null): id is ProjectId {
  return id !== null && Object.hasOwn(projects, id) && !(ws.projects[id]?.deletedAt ?? null);
}

/** The most recently created live project, or null */
function latestLive(ws: WorkspaceDoc, projects: Readonly<Record<ProjectId, ProjectDoc>>): ProjectId | null {
  const live = (Object.keys(projects) as ProjectId[]).filter((id) => isLive(ws, id));
  live.sort((a, b) => compareKeys(projects[b].createdAt, projects[a].createdAt) || compareKeys(a, b));
  return live[0] ?? null;
}

/** Tasks and steps a person owns across every project (deletePerson, Q8) */
function ownershipOf(projects: Readonly<Record<ProjectId, ProjectDoc>>): (id: PersonId) => number {
  let counts: Map<PersonId, number> | null = null;
  return (id) => {
    if (!counts) {
      counts = new Map();
      for (const p of Object.values(projects)) {
        for (const t of Object.values(p.tasks)) {
          if (t.ownerId !== null) counts.set(t.ownerId, (counts.get(t.ownerId) ?? 0) + 1);
          for (const s of t.steps) if (s.ownerId !== null) counts.set(s.ownerId, (counts.get(s.ownerId) ?? 0) + 1);
        }
      }
    }
    return counts.get(id) ?? 0;
  };
}

/** Outcomes of a commit, each with the document it saw */
function outcomesOf(base: AnyDoc, commit: CommitResult<AnyDoc>): OpOutcome[] {
  let before = base;
  return commit.results.map((result) => {
    const outcome: OpOutcome = { def: defOf(result.op) ?? null, before, result };
    if (result.kind === "applied") before = result.doc;
    return outcome;
  });
}

const unrouted = (raw: unknown, message: string, code: "limit" | "no_project"): OpOutcome => ({
  def: defOf(raw) ?? null,
  before: null,
  result: { kind: "rejected", doc: null, op: raw, rejection: reject(code, message) },
});

/**
 * Appends the system rebalanceOrder op to a project commit when an order key grew past 48
 * characters (plan §5.4): fresh keys in workflow order, deterministic, visible in the patches.
 */
function withRebalance(commit: CommitResult<ProjectDoc>, ctx: ReduceCtx): CommitResult<ProjectDoc> {
  if (!commit.changed || longestOrderKey(commit.doc) <= ORDER_KEY_REBALANCE) return commit;
  const ids = idsInWorkflow(commit.doc);
  const keys = nKeys(ids.length);
  const op = { op: "rebalanceOrder", keys: Object.fromEntries(ids.map((id, i) => [id, keys[i]])) as Record<TaskId, OrderKey> };
  const result = applyOp(commit.doc, op, { ...ctx, source: "system" });
  if (result.kind !== "applied") return { ...commit, results: [...commit.results, result] };
  return {
    ...commit,
    doc: result.doc,
    results: [...commit.results, result],
    patches: [...commit.patches, ...result.patches],
    inverse: [...result.inverse, ...commit.inverse],
  };
}

/** Keeps the local state inside the project: an existing view and task, else sensible defaults */
function normaliseLocal(local: LocalViewState, before: ProjectDoc | null, after: ProjectDoc | null): LocalViewState {
  if (!after) return local.selectedTaskId === null ? local : { ...local, selectedTaskId: null };
  let { activeView, selectedTaskId } = local;
  if (!after.views.includes(activeView)) {
    // A removed view hands over to its left neighbour that still exists, else home
    const i = before ? before.views.indexOf(activeView) : -1;
    const left = i > 0 ? before!.views.slice(0, i).reverse().find((v) => after.views.includes(v)) : undefined;
    activeView = left ?? homeView(after.views);
  }
  if (selectedTaskId !== null && !Object.hasOwn(after.tasks, selectedTaskId)) selectedTaskId = null;
  return activeView === local.activeView && selectedTaskId === local.selectedTaskId ? local : { ...local, activeView, selectedTaskId };
}

export function runCommand(state: DocsState, cmd: Command, ctx: CommandCtx): CommandResult {
  const projectsBefore = state.projects;
  const base: ReduceCtx = {
    now: ctx.now,
    actorId: ctx.actorId,
    source: cmd.source,
    workspace: state.workspace,
    readProject: (id) => (Object.hasOwn(projectsBefore, id) ? projectsBefore[id] : null),
    ownership: ownershipOf(projectsBefore),
  };

  // 1. Partition, stably: workspace ops first. Unknown names go with them and are refused there.
  const wsOps: unknown[] = [];
  const projectOps: unknown[] = [];
  for (const raw of cmd.ops) (defOf(raw)?.scope === "project" ? projectOps : wsOps).push(raw);
  const tooMany = cmd.ops.filter((o) => !isSystemOp(o)).length > OPS_PER_COMMAND;

  const outcomes: OpOutcome[] = [];
  let workspace = state.workspace;
  let projects = state.projects;
  let wsCommit: CommitResult<WorkspaceDoc> | null = null;
  let projectCommit: CommitResult<ProjectDoc> | null = null;
  let spawned: ProjectDoc[] = [];
  let target: ProjectId | null = ctx.projectId;

  if (tooMany) {
    for (const raw of [...wsOps, ...projectOps]) outcomes.push(unrouted(raw, LIMIT_MESSAGE, "limit"));
  } else {
    // 2. The workspace commit; spawned projects join the state
    if (wsOps.length > 0) {
      wsCommit = applyCommit(workspace, wsOps, base);
      outcomes.push(...outcomesOf(workspace, wsCommit));
      workspace = wsCommit.doc;
      spawned = wsCommit.spawned;
      if (spawned.length > 0) {
        const withSpawned: Record<ProjectId, ProjectDoc> = { ...projects };
        for (const p of spawned) withSpawned[p.id] = p;
        projects = withSpawned;
      }
    }
    // 3. The target: the last spawned project, else the active one, if it is still live
    if (spawned.length > 0) target = spawned[spawned.length - 1].id;
    const targetDoc = isOpen(workspace, projects, target) ? projects[target] : null;

    // 4. The project commit sees the workspace after its commit ("add Giulia and assign Development to her")
    if (projectOps.length > 0) {
      if (!targetDoc) {
        for (const raw of projectOps) outcomes.push(unrouted(raw, NO_PROJECT_MESSAGE, "no_project"));
      } else {
        const pctx: ReduceCtx = { ...base, workspace };
        projectCommit = withRebalance(applyCommit(targetDoc, projectOps, pctx), pctx);
        outcomes.push(...outcomesOf(targetDoc, projectCommit));
        if (projectCommit.changed) projects = { ...projects, [targetDoc.id]: projectCommit.doc };
      }
    }
  }

  // 5. Local effects: the active project, then show/select/zoom, then normalisation
  const projectId = isOpen(workspace, projects, target) ? target : latestLive(workspace, projects);
  const afterProject = projectId !== null ? projects[projectId] : null;
  const sameProject = projectId !== null && projectId === ctx.projectId;
  const beforeProject = sameProject && Object.hasOwn(projectsBefore, projectId) ? projectsBefore[projectId] : null;
  let local = sameProject ? ctx.local : defaultLocalViewState(afterProject);
  for (const intent of cmd.local) local = applyLocal(local, intent);
  local = normaliseLocal(local, beforeProject, afterProject);

  // 7. Commits: one per changed document, sharing a group id (before the caption, which needs to know)
  const changed = Boolean(wsCommit?.changed || projectCommit?.changed);
  const groupId = changed ? ctx.newId() : null;
  const commits: DocCommit[] = [];
  if (wsCommit?.changed) commits.push({ docId: workspace.id, id: ctx.newId(), result: wsCommit });
  if (projectCommit?.changed) commits.push({ docId: projectCommit.doc.id, id: ctx.newId(), result: projectCommit });
  const after: DocsState = changed ? { workspace, projects } : state;

  // 6. The caption, from the after state
  const added = beforeProject && afterProject ? viewsAdded(beforeProject.views, afterProject.views) : [];
  const env = makeCaptionEnv({ after, before: state, projectId, today: ctx.today, planning: ctx.planning });
  const caption = composeCaption({
    outcomes,
    local: cmd.local,
    addedViews: added,
    notes: cmd.notes,
    notices: cmd.notices,
    reply: cmd.reply,
    env,
    historyEntry: changed,
    quiet: cmd.caption === false,
    ...(cmd.expansion ? { expansion: cmd.expansion } : {}),
  });

  return { state: after, changed, groupId, commits, spawned, local, projectId, caption, outcomes, addedViews: added };
}

/**
 * The §10.2 wire shape of a command's commits (plan §3.6, `CommitSchema`): one per changed
 * document, sharing the group id, carrying only the ops that applied (a replay re-runs exactly
 * those, rejections included nowhere) and never a local intent. `baseVersion` is the document's
 * version before the commit: the store counts it now, the server in Phase 2.
 */
export function toCommits(
  result: CommandResult,
  cmd: Pick<Command, "source" | "text">,
  ctx: Pick<CommandCtx, "now" | "actorId">,
  baseVersion: (docId: WorkspaceId | ProjectId) => number,
): Commit[] {
  if (result.groupId === null) return [];
  return result.commits.map((c) => ({
    id: c.id,
    groupId: result.groupId!,
    docId: c.docId,
    baseVersion: baseVersion(c.docId),
    ops: c.result.results.filter((r) => r.kind === "applied").map((r) => r.op),
    source: cmd.source,
    command: cmd.text === null ? null : cmd.text.slice(0, COMMAND_TEXT),
    createdAt: ctx.now,
    actorId: ctx.actorId,
  }));
}
