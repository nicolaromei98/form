// Shared helpers of the registry and ops unit tests. Rejection codes are asserted only through
// `expectRejection(result, "code")`: the completeness test reads those calls to prove every
// RejectCode is produced by some unit test (plan §4.3 item 9).
import { applyPatches } from "immer";
import { expect } from "vitest";
import type { ProjectId } from "@/lib/domain/schema/ids";
import { defaultLocalViewState } from "@/lib/domain/schema/local";
import type { ProjectDoc } from "@/lib/domain/schema/project";
import type { WorkspaceDoc } from "@/lib/domain/schema/workspace";
import { type Command, type CommandCtx, type CommandResult, type DocsState, runCommand } from "@/lib/ops/command";
import { type AnyDoc, applyOp, type ApplyOptions, type OpResult } from "@/lib/ops/reduce";
import { defOf, type Op } from "@/lib/ops/registry";
import { type ReduceCtx, type RejectCode, type Rejection } from "@/lib/ops/registry/_contract";
import { FIXTURE_NOW, FIXTURE_TODAY } from "../../../../../test/fixtures/v2/build";

/** A fixture's documents: the store's DocsState plus the active project */
export interface TestState {
  workspace: WorkspaceDoc;
  projects: Record<ProjectId, ProjectDoc>;
  projectId: ProjectId | null;
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

/** The active project; throws when there is none */
export function projectOf(state: TestState): ProjectDoc {
  if (state.projectId === null) throw new Error("No active project");
  return state.projects[state.projectId];
}

/** The reducer context the runner would build for this state */
export function reduceCtx(state: TestState, o: Partial<ReduceCtx> = {}): ReduceCtx {
  return {
    now: FIXTURE_NOW,
    actorId: null,
    source: "direct",
    workspace: state.workspace,
    readProject: (id) => state.projects[id] ?? null,
    ownership: () => 0,
    ...o,
  };
}

/** The document an op applies to: the workspace for workspace ops, else the active project */
export function docFor(state: TestState, raw: unknown): AnyDoc {
  return defOf(raw)?.scope === "workspace" ? state.workspace : projectOf(state);
}

/** Applies one raw op to the document it targets, with full validation */
export function apply(state: TestState, raw: unknown, opts: ApplyOptions & { ctx?: Partial<ReduceCtx> } = {}) {
  const before = docFor(state, raw);
  const result = applyOp(before, raw, reduceCtx(state, opts.ctx), opts);
  return { before, result };
}

/** A state with one document replaced by an op's result */
export function withDoc(state: TestState, doc: AnyDoc): TestState {
  if (doc.docType === "workspace") return { ...state, workspace: doc };
  return { ...state, projects: { ...state.projects, [doc.id]: doc } };
}

export function expectApplied<D>(result: OpResult<D>): Extract<OpResult<D>, { kind: "applied" }> {
  if (result.kind !== "applied") throw new Error(`Expected applied, got ${result.kind}: ${JSON.stringify(result.kind === "rejected" ? result.rejection : null)}`);
  // The inverse patches undo it and the patches redo it (plan §10.3 property 3)
  return result;
}

/** A no-op returns the very same document (property 6) */
export function expectNoop<D>(result: OpResult<D>, before: D): void {
  expect(result.kind).toBe("noop");
  expect(result.doc).toBe(before);
}

/** A rejection with this code: same document, a 1–140 character message (property 7) */
export function expectRejection(result: OpResult<unknown> | { kind: "rejected"; rejection: Rejection } | { kind: string }, code: RejectCode): Rejection {
  if (result.kind !== "rejected" || !("rejection" in result)) throw new Error(`Expected a ${code} rejection, got ${result.kind}`);
  expect(result.rejection.code).toBe(code);
  expect(result.rejection.message.length).toBeGreaterThan(0);
  expect(result.rejection.message.length).toBeLessThanOrEqual(140);
  return result.rejection;
}

/** Undo and redo by patches restore exactly (property 3) */
export function expectInverse(before: AnyDoc, result: Extract<OpResult<AnyDoc>, { kind: "applied" }>): void {
  expect(applyPatches(result.doc, result.inverse)).toEqual(before);
  expect(applyPatches(before, result.patches)).toEqual(result.doc);
}

/** A deterministic uuid-shaped id source for the runner */
export function idSource(seed = 0): () => string {
  let n = seed;
  return () => {
    n += 1;
    return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  };
}

/** Runs a command against a fixture state, as the store would */
export function run(
  state: TestState,
  ops: readonly unknown[],
  o: Partial<Omit<Command, "ops">> & { ctx?: Partial<CommandCtx> } = {},
): CommandResult {
  const { ctx, ...cmd } = o;
  const project = state.projectId !== null ? state.projects[state.projectId] : null;
  const docs: DocsState = { workspace: state.workspace, projects: state.projects };
  return runCommand(
    docs,
    { ops: ops as Op[], local: [], notes: [], notices: [], source: "direct", text: null, ...cmd },
    {
      now: FIXTURE_NOW,
      actorId: null,
      projectId: state.projectId,
      local: defaultLocalViewState(project),
      today: FIXTURE_TODAY,
      newId: idSource(),
      ...ctx,
    },
  );
}

/** The caption text of a one-op command */
export function captionOf(state: TestState, raw: unknown, o: Parameters<typeof run>[2] = {}): string | null {
  return run(state, [raw], o).caption?.text ?? null;
}
