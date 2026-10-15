// The engine of the property suite (plan §10.3). It plays a generated Run through the command
// runner one step at a time, as the store will: one command per step, the agent as the source,
// full validation, the real planning engine behind captions. It keeps what undo and redo need:
// each command's commits and the projects it spawned (plan §5.8 drops those on undo and brings
// them back on redo). The reducer, planning and coverage properties share it and differ only in
// what they check after each step.
import { applyPatches, type Patch } from "immer";
import { seededMinter } from "@/lib/domain/ids";
import { OPS_PER_COMMAND } from "@/lib/domain/limits";
import type { ProjectId } from "@/lib/domain/schema/ids";
import { defaultLocalViewState } from "@/lib/domain/schema/local";
import type { ProjectDoc } from "@/lib/domain/schema/project";
import type { WorkspaceDoc } from "@/lib/domain/schema/workspace";
import type { CaptionPlanning } from "@/lib/ops/caption-env";
import { type CommandCtx, type CommandResult, type DocsState, runCommand } from "@/lib/ops/command";
import type { AnyDoc } from "@/lib/ops/reduce";
import { defOf, type Op } from "@/lib/ops/registry";
import type { ReduceCtx } from "@/lib/ops/registry/_contract";
import { laneLoads, loadFor, planProject } from "@/lib/planning";
import { FIXTURE_NOW, FIXTURE_TODAY } from "../fixtures/v2/build";
import type { Run } from "./arbitraries";
import type { StepIntent } from "./gen/_pick";
import { type GenState, materialise, startState } from "./materialise";

export type { GenState } from "./materialise";

/* ------------------------------------------------------------------
   Values
   ------------------------------------------------------------------ */

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

/**
 * A JSON copy with every object's keys in another order (deterministic, by `salt`): what Postgres
 * `jsonb` may hand back. Arrays keep their order; only record and object keys move.
 */
export function shuffledCopy<T>(value: T, salt: number): T {
  const shuffle = (v: unknown, depth: number): unknown => {
    if (Array.isArray(v)) return v.map((x) => shuffle(x, depth + 1));
    if (v === null || typeof v !== "object") return v;
    const keys = Object.keys(v);
    const shift = (salt + depth) % Math.max(1, keys.length);
    const order = keys.map((_, i) => keys[(i + shift) % keys.length]);
    if ((salt + depth) % 2 === 0) order.reverse();
    return Object.fromEntries(order.map((k) => [k, shuffle((v as Record<string, unknown>)[k], depth + 1)]));
  };
  return shuffle(JSON.parse(JSON.stringify(value)), 0) as T;
}

/** JSON with every object's keys sorted, so equal values print the same whatever their key order */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const entries = Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(",")}}`;
}

/** Patches as a multiset: a document with its keys in another order may list the same changes in another order */
export const sortedPatches = (patches: readonly Patch[]) => patches.map(canonical).sort();

/* ------------------------------------------------------------------
   Contexts
   ------------------------------------------------------------------ */

/** Commit and group ids for the runner, uuid-shaped and deterministic */
function idSource(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

/** Tasks and steps a person owns across every project (deletePerson, Q8), as the runner counts them */
function ownership(projects: Readonly<Record<ProjectId, ProjectDoc>>) {
  return (person: string): number => {
    let n = 0;
    for (const p of Object.values(projects)) {
      for (const t of Object.values(p.tasks)) {
        if (t.ownerId === person) n++;
        for (const s of t.steps) if (s.ownerId === person) n++;
      }
    }
    return n;
  };
}

/**
 * The context the runner gives the op of a one-op command on this state. A project op of such a
 * command sees the same workspace, since no workspace commit runs before it.
 */
export function reduceCtx(state: GenState): ReduceCtx {
  return {
    now: FIXTURE_NOW,
    actorId: null,
    source: "agent",
    workspace: state.workspace,
    readProject: (id) => (Object.hasOwn(state.projects, id) ? state.projects[id] : null),
    ownership: ownership(state.projects),
  };
}

/** The same context over `jsonb`-shaped copies: the workspace and every project it may read */
export function shuffledCtx(state: GenState, salt: number): ReduceCtx {
  const copies = new Map<ProjectId, ProjectDoc>();
  return {
    ...reduceCtx(state),
    workspace: shuffledCopy(state.workspace, salt),
    readProject: (id) => {
      if (!Object.hasOwn(state.projects, id)) return null;
      let copy = copies.get(id);
      if (!copy) copies.set(id, (copy = shuffledCopy(state.projects[id], salt + 1)));
      return copy;
    },
  };
}

/** Captions read the real planning engine, as in the store (plan §5.9, `caption-env.ts`) */
export const PLANNING: CaptionPlanning = {
  plan: (project, ws, today) => planProject(project, ws, today),
  lanes: (project, ws, projects, today) => {
    const plans = projects.map((p) => planProject(p, ws, today));
    return laneLoads(planProject(project, ws, today), loadFor(ws, plans), ws);
  },
  focus: (project, ws, today) => planProject(project, ws, today).focus,
};

function commandCtx(state: GenState): CommandCtx {
  const project = state.projectId !== null && Object.hasOwn(state.projects, state.projectId) ? state.projects[state.projectId] : null;
  return {
    now: FIXTURE_NOW,
    actorId: null,
    projectId: state.projectId,
    local: defaultLocalViewState(project),
    today: FIXTURE_TODAY,
    newId: idSource(),
    planning: PLANNING,
  };
}

/* ------------------------------------------------------------------
   Documents
   ------------------------------------------------------------------ */

export type DocKey = "workspace" | ProjectId;

export const docAt = (state: GenState, key: DocKey): AnyDoc => (key === "workspace" ? state.workspace : state.projects[key]);

export function withDoc(state: GenState, key: DocKey, doc: AnyDoc): GenState {
  if (key === "workspace") return { ...state, workspace: doc as WorkspaceDoc };
  return { ...state, projects: { ...state.projects, [key]: doc as ProjectDoc } };
}

/** The document of the other scope an op could be misrouted to: any project for a workspace op */
export function otherDoc(state: GenState, raw: unknown): AnyDoc | null {
  if (defOf(raw)?.scope !== "workspace") return state.workspace;
  const ids = Object.keys(state.projects).sort() as ProjectId[];
  const id = state.projectId !== null && Object.hasOwn(state.projects, state.projectId) ? state.projectId : ids[0];
  return id === undefined ? null : state.projects[id];
}

/* ------------------------------------------------------------------
   Runs
   ------------------------------------------------------------------ */

/**
 * One step in forty sends its op as many times as one command past the 12-op limit allows: the
 * runner refuses them all (`limit`) and nothing changes. System ops don't count toward the limit,
 * so a burst of rebalanceOrder runs in full.
 */
const BURST = OPS_PER_COMMAND + 1;
const isBurst = (step: StepIntent) => step.picks[4] % 40 === 17;

/** One step of a run: the command it became, the state before it and the state after it */
export interface StepRecord {
  index: number;
  step: StepIntent;
  /** The raw op, deeply frozen (property 5) */
  raw: unknown;
  /** The command's ops: `raw`, or `raw` repeated past the limit */
  ops: readonly unknown[];
  before: GenState;
  result: CommandResult;
  after: GenState;
}

/** What undoing or redoing one command replays */
export interface HistoryEntry {
  commits: { key: DocKey; patches: Patch[]; inverse: Patch[] }[];
  /** Projects the command created: undo drops them, redo brings the same documents back */
  spawned: ProjectDoc[];
}

export interface RunResult {
  initial: GenState;
  final: GenState;
  history: HistoryEntry[];
}

/**
 * Plays a run: each step's intent becomes a raw op against the current state, then a one-op
 * command. `visit` sees every step that produced an op, before the state moves on.
 */
export function executeRun(run: Run, visit?: (record: StepRecord) => void): RunResult {
  const mint = seededMinter(run.steps.length + 1);
  const initial = startState(run.fixture, run.requireReview, run.proposal);
  let state = initial;
  const history: HistoryEntry[] = [];

  run.steps.forEach((step, index) => {
    const raw = deepFreeze(materialise(step, state, mint));
    if (raw === null) return;
    const ops = isBurst(step) ? Array.from({ length: BURST }, () => raw) : [raw];
    const docs: DocsState = { workspace: state.workspace, projects: state.projects };
    const result = runCommand(docs, { ops: ops as Op[], local: [], notes: [], notices: [], source: "agent", text: null }, commandCtx(state));
    const after: GenState = { workspace: result.state.workspace, projects: result.state.projects, projectId: result.projectId };
    visit?.({ index, step, raw, ops, before: state, result, after });
    if (result.changed) {
      history.push({
        commits: result.commits.map((c) => ({
          key: c.result.doc.docType === "workspace" ? "workspace" : (c.docId as ProjectId),
          patches: c.result.patches,
          inverse: c.result.inverse,
        })),
        spawned: result.spawned,
      });
    }
    state = after;
  });
  return { initial, final: state, history };
}

/** Undoes every command, newest first: inverse patches per commit, then spawned projects dropped */
export function undoAll(state: GenState, history: readonly HistoryEntry[]): GenState {
  let out = state;
  for (const entry of [...history].reverse()) {
    for (const c of [...entry.commits].reverse()) out = withDoc(out, c.key, applyPatches(docAt(out, c.key), c.inverse));
    if (entry.spawned.length > 0) {
      const projects = { ...out.projects };
      for (const p of entry.spawned) delete projects[p.id];
      out = { ...out, projects };
    }
  }
  return out;
}

/** Redoes every command, oldest first: the workspace commit, its spawned projects, then the project commit */
export function redoAll(state: GenState, history: readonly HistoryEntry[]): GenState {
  let out = state;
  for (const entry of history) {
    for (const c of entry.commits) {
      out = withDoc(out, c.key, applyPatches(docAt(out, c.key), c.patches));
      if (c.key === "workspace") for (const p of entry.spawned) out = withDoc(out, p.id, p);
    }
  }
  return out;
}
