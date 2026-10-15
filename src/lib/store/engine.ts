import { applyPatches, type Patch } from "immer";
import type { Minter } from "@/lib/domain/ids";
import { compareKeys } from "@/lib/domain/order";
import type { PersonId, ProjectId, WorkspaceId } from "@/lib/domain/schema/ids";
import { defaultLocalViewState, type LocalViewState } from "@/lib/domain/schema/local";
import type { IsoDate, Timestamp } from "@/lib/domain/schema/primitives";
import type { ProjectDoc } from "@/lib/domain/schema/project";
import type { WorkspaceDoc } from "@/lib/domain/schema/workspace";
import { homeView } from "@/lib/domain/views";
import { breakdownFor } from "@/lib/demo/library";
import { addSampleTeam, createDemoProject } from "@/lib/demo/seed";
import { type FastContext, paletteKey } from "@/lib/interpret/fast";
import type { CaptionPlanning } from "@/lib/ops/caption-env";
import { type Command, type CommandResult, type DocsState, runCommand } from "@/lib/ops/command";
import { paletteEntries } from "@/lib/ops/palette";
import { applyCommit } from "@/lib/ops/reduce";
import { defOf, type Op } from "@/lib/ops/registry";
import type { ReduceCtx } from "@/lib/ops/registry/_contract";
import { laneLoads, loadFor, planProject } from "@/lib/planning";

/**
 * The store engine (plan §1.1, §5.7, §5.8): everything the store does to documents, with no
 * framework. It wraps the command runner with the real planning engine and the parser context,
 * turns a command's commits into a history entry, undoes and redoes entries by their patches, and
 * runs gestures (a drag, a slider) as live previews recomputed from their base. The Zustand store
 * (`form.ts`) only holds what this returns; the Phase 2 sync queue reuses it unchanged.
 */

export type { Command, CommandResult, DocsState } from "@/lib/ops/command";

/* ------------------------------------------------------------------
   The planning engine behind captions and the parser
   ------------------------------------------------------------------ */

/**
 * The real planning engine for captions (plan §5.9, `caption-env.ts`): plans, Team lanes and
 * focus, memoised by document identity. The one implementation: the property suite and the golden
 * parser harness import it too.
 */
export const CAPTION_PLANNING: CaptionPlanning = {
  plan: (project, ws, today) => planProject(project, ws, today),
  lanes(project, ws, projects, today) {
    const plans = projects.map((p) => planProject(p, ws, today));
    let own = plans.find((p) => p.project.id === project.id);
    // An archived project isn't among the live ones; its lanes still read its own plan
    if (own === undefined) plans.push((own = planProject(project, ws, today)));
    return laneLoads(own, loadFor(ws, plans), ws);
  },
  focus: (project, ws, today) => planProject(project, ws, today).focus,
};

/* ------------------------------------------------------------------
   Projects in a state
   ------------------------------------------------------------------ */

/** Live: neither archived nor deleted in the index (a project the index doesn't list counts as live) */
export function isLiveProject(ws: WorkspaceDoc, id: ProjectId): boolean {
  const entry = Object.hasOwn(ws.projects, id) ? ws.projects[id] : null;
  return entry === null || (entry.archivedAt === null && entry.deletedAt === null);
}

/** A project the user can stay on: it exists and isn't deleted (archived is fine), as in the runner */
export function isOpenProject(state: DocsState, id: ProjectId | null): id is ProjectId {
  if (id === null || !Object.hasOwn(state.projects, id)) return false;
  return !(Object.hasOwn(state.workspace.projects, id) && state.workspace.projects[id].deletedAt !== null);
}

/** The live projects, by id */
export function liveProjects(state: DocsState): ProjectDoc[] {
  return (Object.keys(state.projects) as ProjectId[])
    .sort(compareKeys)
    .filter((id) => isLiveProject(state.workspace, id))
    .map((id) => state.projects[id]);
}

/** The most recently created live project, or null (the runner's fallback, plan §5.7 step 5) */
export function latestLiveProject(state: DocsState): ProjectId | null {
  const live = liveProjects(state);
  live.sort((a, b) => compareKeys(b.createdAt, a.createdAt) || compareKeys(a.id, b.id));
  return live[0]?.id ?? null;
}

/** The project to stay on: `wanted` when it is still open, else the latest live one */
export function resolveProject(state: DocsState, wanted: ProjectId | null): ProjectId | null {
  return isOpenProject(state, wanted) ? wanted : latestLiveProject(state);
}

/** Keeps a local view state inside a project: one of its views, and a task it has */
export function normaliseLocalView(local: LocalViewState, project: ProjectDoc | null): LocalViewState {
  if (project === null) return local.selectedTaskId === null ? local : { ...local, selectedTaskId: null };
  const activeView = project.views.includes(local.activeView) ? local.activeView : homeView(project.views);
  const selectedTaskId = local.selectedTaskId !== null && Object.hasOwn(project.tasks, local.selectedTaskId) ? local.selectedTaskId : null;
  return activeView === local.activeView && selectedTaskId === local.selectedTaskId ? local : { ...local, activeView, selectedTaskId };
}

/* ------------------------------------------------------------------
   The parser's context (plan §8.4)
   ------------------------------------------------------------------ */

let paletteKeys: ReadonlySet<string> | null = null;

/** The palette's phrases as the parser compares them (Q17 tier 1.0), computed once */
export function parserPalette(): ReadonlySet<string> {
  return (paletteKeys ??= new Set(paletteEntries().map((e) => paletteKey(e.phrase))));
}

export interface ParserInput {
  docs: DocsState;
  projectId: ProjectId | null;
  local: LocalViewState;
  today: IsoDate;
  mint: Minter;
}

/**
 * What `fastParse` reads (plan §8.4): the active project, the live projects (balance reads load
 * across them; the active one is always included), the local state and selection, and the /demo
 * breakdown library and expansions (injected: the parser never imports lib/demo).
 */
export function parserContext({ docs, projectId, local, today, mint }: ParserInput): FastContext {
  const project = isOpenProject(docs, projectId) ? docs.projects[projectId] : null;
  const projects = liveProjects(docs);
  if (project !== null && !projects.includes(project)) projects.push(project);
  return {
    ws: docs.workspace,
    project,
    projects,
    local,
    selectedTaskId: local.selectedTaskId,
    mint,
    today,
    palette: parserPalette(),
    breakdown: breakdownFor,
    demo: { createProject: createDemoProject, sampleTeam: addSampleTeam },
  };
}

/* ------------------------------------------------------------------
   Running a command
   ------------------------------------------------------------------ */

export interface EngineCtx {
  now: Timestamp;
  actorId: string | null;
  today: IsoDate;
  /** Commit and group ids: crypto.randomUUID in the store, seeded in tests */
  newId: () => string;
}

/** Where a command runs: the active project and its local view state */
export interface Where {
  projectId: ProjectId | null;
  local: LocalViewState;
}

/** `runCommand` with the real planning engine behind captions */
export function run(docs: DocsState, cmd: Command, where: Where, ctx: EngineCtx): CommandResult {
  return runCommand(docs, cmd, { ...ctx, projectId: where.projectId, local: where.local, planning: CAPTION_PLANNING });
}

/* ------------------------------------------------------------------
   History (plan §5.8)
   ------------------------------------------------------------------ */

export interface EntryCommit {
  readonly docId: WorkspaceId | ProjectId;
  readonly patches: readonly Patch[];
  readonly inverse: readonly Patch[];
}

export interface HistoryEntry {
  readonly groupId: string;
  readonly label: string;
  /** The command's commits, workspace first */
  readonly commits: readonly EntryCommit[];
  /** Projects the command created: undo drops them, redo brings the same frozen documents back */
  readonly spawned: readonly ProjectDoc[];
  readonly localBefore: LocalViewState;
  readonly localAfter: LocalViewState;
  readonly projectBefore: ProjectId | null;
  readonly projectAfter: ProjectId | null;
  /** The documents after the entry; undo asserts it starts from exactly them (development only) */
  readonly after: DocsState;
}

/** The history entry of a command, or null when nothing changed (no entry, plan §5.3) */
export function historyEntry(result: CommandResult, label: string, before: Where): HistoryEntry | null {
  if (!result.changed || result.groupId === null) return null;
  return {
    groupId: result.groupId,
    label,
    commits: result.commits.map((c) => ({ docId: c.docId, patches: c.result.patches, inverse: c.result.inverse })),
    spawned: result.spawned,
    localBefore: before.local,
    localAfter: result.local,
    projectBefore: before.projectId,
    projectAfter: result.projectId,
    after: result.state,
  };
}

const isWorkspace = (state: DocsState, docId: WorkspaceId | ProjectId) => docId === state.workspace.id;

function docAt(state: DocsState, docId: WorkspaceId | ProjectId): WorkspaceDoc | ProjectDoc | undefined {
  if (isWorkspace(state, docId)) return state.workspace;
  return Object.hasOwn(state.projects, docId) ? state.projects[docId as ProjectId] : undefined;
}

function withDoc(state: DocsState, docId: WorkspaceId | ProjectId, doc: WorkspaceDoc | ProjectDoc): DocsState {
  if (doc.docType === "workspace") return { ...state, workspace: doc };
  return { ...state, projects: { ...state.projects, [docId as ProjectId]: doc } };
}

const DEV = process.env.NODE_ENV !== "production";

/** Undo is only sound from the exact documents the entry left (plan §5.8): checked in development */
function assertAt(state: DocsState, entry: HistoryEntry): void {
  if (!DEV) return;
  for (const c of entry.commits) {
    if (docAt(state, c.docId) !== docAt(entry.after, c.docId)) {
      throw new Error(`Undo of "${entry.label}" from a state it didn't leave (${c.docId})`);
    }
  }
}

/** Applies inverse patches per commit, newest first, then drops the projects the command created */
export function undo(state: DocsState, entry: HistoryEntry): DocsState {
  assertAt(state, entry);
  let out = state;
  for (const c of [...entry.commits].reverse()) {
    const doc = docAt(out, c.docId);
    if (doc === undefined) throw new Error(`Undo of "${entry.label}": ${c.docId} is gone`);
    out = withDoc(out, c.docId, applyPatches(doc, c.inverse as Patch[]));
  }
  if (entry.spawned.length > 0) {
    const projects = { ...out.projects };
    for (const p of entry.spawned) delete projects[p.id];
    out = { ...out, projects };
  }
  return out;
}

/** Applies the patches per commit, oldest first; spawned projects return after the workspace commit */
export function redo(state: DocsState, entry: HistoryEntry): DocsState {
  let out = state;
  for (const c of entry.commits) {
    const doc = docAt(out, c.docId);
    if (doc === undefined) throw new Error(`Redo of "${entry.label}": ${c.docId} is missing`);
    out = withDoc(out, c.docId, applyPatches(doc, c.patches as Patch[]));
    if (isWorkspace(out, c.docId) && entry.spawned.length > 0) {
      const projects = { ...out.projects };
      for (const p of entry.spawned) projects[p.id] = p;
      out = { ...out, projects };
    }
  }
  return out;
}

/**
 * Where the user lands after undoing (`side: "before"`) or redoing (`"after"`) an entry: the
 * entry's project when it is open again, and its view when the command changed the view (so
 * undoing "Add a timeline" removes the tab and returns to the previous one). A tab the user picked
 * afterwards is kept otherwise: tab switches are not history (Q6).
 */
export function landing(docs: DocsState, entry: HistoryEntry, side: "before" | "after", current: Where): Where {
  const wanted = side === "before" ? entry.projectBefore : entry.projectAfter;
  const target = side === "before" ? entry.localBefore : entry.localAfter;
  const projectId = resolveProject(docs, wanted);
  const project = projectId === null ? null : docs.projects[projectId];
  let local: LocalViewState;
  if (projectId !== null && projectId === current.projectId) {
    const viewChanged = entry.projectBefore === entry.projectAfter && entry.localBefore.activeView !== entry.localAfter.activeView;
    local = viewChanged ? { ...current.local, activeView: target.activeView } : current.local;
  } else if (projectId !== null && projectId === wanted) local = target;
  else local = defaultLocalViewState(project);
  return { projectId, local: normaliseLocalView(local, project) };
}

/**
 * Entity-granular paths a commit touched (plan §5.8, for the Phase 2 revert check): each patch
 * path is cut at its first array index (`["tasks", id, "steps"]`, `["brief", "lines"]`), so an
 * index shift inside an array can never hide a conflict. Sorted and unique.
 */
export function pathsTouched(patches: readonly Patch[]): (string | number)[][] {
  const seen = new Map<string, (string | number)[]>();
  for (const p of patches) {
    const cut = p.path.findIndex((seg) => typeof seg === "number");
    const path = cut < 0 ? [...p.path] : p.path.slice(0, cut);
    seen.set(JSON.stringify(path), path);
  }
  return [...seen.keys()].sort(compareKeys).map((k) => seen.get(k)!);
}

/* ------------------------------------------------------------------
   Gestures (plan §5.8)
   ------------------------------------------------------------------ */

export interface Gesture {
  /** The documents the gesture started from: every frame is recomputed from them */
  readonly base: DocsState;
  readonly projectId: ProjectId | null;
  readonly local: LocalViewState;
  /** The gesture's ops so far, coalesced */
  readonly ops: readonly Op[];
  /** The live documents: the base with the ops, touched validation only */
  readonly state: DocsState;
}

export function beginGesture(base: DocsState, where: Where): Gesture {
  return { base, projectId: where.projectId, local: where.local, ops: [], state: base };
}

/** The entity and field an op edits: ops with the same key overwrite each other in a gesture */
function coalesceKey(op: Op): string {
  const o = op as unknown as Record<string, unknown>;
  const ids = Object.keys(o)
    .filter((k) => k.endsWith("Id"))
    .sort()
    .map((k) => `${k}=${String(o[k])}`);
  return [o.op, ...ids, typeof o.field === "string" ? o.field : ""].join("|");
}

/** Two ops on the same key: the later wins; patch-shaped ops merge their patches (later keys win) */
function merge(earlier: Op, later: Op): Op {
  const a = earlier as unknown as Record<string, unknown>;
  const b = later as unknown as Record<string, unknown>;
  const isPatch = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
  if (!isPatch(a.patch) || !isPatch(b.patch)) return later;
  const merged: Record<string, unknown> = { ...b, patch: { ...a.patch, ...b.patch } };
  if (typeof a.toFront === "boolean" && typeof b.toFront === "boolean") merged.toFront = a.toFront || b.toFront;
  return merged as unknown as Op;
}

/**
 * Coalesces a gesture's ops by (op, entity, field), last value wins (plan §5.8). Each key keeps
 * the position of its last appearance, so the final order follows the user's last intent.
 */
export function coalesce(ops: readonly Op[]): Op[] {
  const byKey = new Map<string, Op>();
  for (const op of ops) {
    const key = coalesceKey(op);
    const prev = byKey.get(key);
    byKey.delete(key);
    byKey.set(key, prev === undefined ? op : merge(prev, op));
  }
  return [...byKey.values()];
}

function ownership(projects: Readonly<Record<ProjectId, ProjectDoc>>): (id: PersonId) => number {
  return (id) => {
    let n = 0;
    for (const p of Object.values(projects)) {
      for (const t of Object.values(p.tasks)) {
        if (t.ownerId === id) n++;
        for (const s of t.steps) if (s.ownerId === id) n++;
      }
    }
    return n;
  };
}

/**
 * One live frame: the frame's ops join the gesture's (coalesced), and the documents are
 * recomputed from the base with touched validation (plan §5.2). Workspace ops apply first, so a
 * project op sees them. A frame never spawns a project.
 */
export function liveGesture(g: Gesture, ops: readonly Op[], ctx: Pick<EngineCtx, "now" | "actorId">): Gesture {
  const all = coalesce([...g.ops, ...ops]);
  const base = g.base;
  const reduce: ReduceCtx = {
    now: ctx.now,
    actorId: ctx.actorId,
    source: "direct",
    workspace: base.workspace,
    readProject: (id) => (Object.hasOwn(base.projects, id) ? base.projects[id] : null),
    ownership: ownership(base.projects),
  };
  const wsOps = all.filter((op) => defOf(op)?.scope !== "project");
  const projectOps = all.filter((op) => defOf(op)?.scope === "project");
  let workspace = base.workspace;
  if (wsOps.length > 0) workspace = applyCommit(workspace, wsOps, reduce, { validate: "touched" }).doc;
  let projects = base.projects;
  if (projectOps.length > 0 && isOpenProject(base, g.projectId)) {
    const commit = applyCommit(base.projects[g.projectId], projectOps, { ...reduce, workspace }, { validate: "touched" });
    if (commit.changed) projects = { ...projects, [g.projectId]: commit.doc };
  }
  const state = workspace === base.workspace && projects === base.projects ? base : { workspace, projects };
  return { ...g, ops: all, state };
}

/**
 * Seals a gesture (plan §5.8): one full-validation command from the base with the coalesced ops
 * (and `ops`, the last frame's), or null for `ops === null`, which restores the base. A gesture
 * that ends where it began changes nothing, so it leaves no history entry.
 */
export function endGesture(g: Gesture, ops: readonly Op[] | null, ctx: EngineCtx): CommandResult | null {
  if (ops === null) return null;
  const all = coalesce([...g.ops, ...ops]);
  const cmd: Command = { ops: all, local: [], notes: [], notices: [], source: "direct", text: null, caption: false };
  return run(g.base, cmd, { projectId: g.projectId, local: g.local }, ctx);
}
