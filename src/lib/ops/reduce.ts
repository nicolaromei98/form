import { enablePatches, type Patch, produceWithPatches, setAutoFreeze } from "immer";
import type { z } from "zod";
import { checkProject, checkWorkspace } from "@/lib/domain/invariants/check";
import { coherenceProblems, milestoneProblems } from "@/lib/domain/invariants/transitions";
import { OPS_PER_COMMAND } from "@/lib/domain/limits";
import { MoodItemSchema, type ProjectDoc, ProjectDocSchema, TaskSchema } from "@/lib/domain/schema/project";
import { type WorkspaceDoc, WorkspaceDocSchema } from "@/lib/domain/schema/workspace";
import { type AnyDoc, fitText, type ReduceCtx, type Rejection, type RejectCode, reject } from "@/lib/ops/registry/_contract";
import { defOf, isSystemOp, type Op } from "@/lib/ops/registry";

/**
 * The deterministic reducer (plan §5.1–§5.3). Every source of change (the UI, the parser, the
 * agent, the migration, a replay) goes through `applyOp`: parse with the op's own schema, run its
 * Immer recipe, then validate the result. Committed documents are deeply frozen, a no-op returns
 * the input by reference, and a rejection leaves nothing half-applied.
 */

enablePatches();
// In every environment: committed documents are deeply frozen, so a stray mutation throws
setAutoFreeze(true);

export type { AnyDoc } from "@/lib/ops/registry/_contract";

export type OpResult<D> =
  | { kind: "applied"; doc: D; op: Op; patches: Patch[]; inverse: Patch[]; spawned?: ProjectDoc }
  | { kind: "noop"; doc: D; op: Op }
  | { kind: "rejected"; doc: D; op: unknown; rejection: Rejection };

export interface CommitResult<D> {
  doc: D;
  /** Whether any op applied */
  changed: boolean;
  results: OpResult<D>[];
  /** Every applied op's patches, in order */
  patches: Patch[];
  /** The per-op inverse lists in reverse order: applying them undoes the whole commit */
  inverse: Patch[];
  spawned: ProjectDoc[];
}

export interface ApplyOptions {
  /** "touched" only for live gesture frames (plan §5.8); a sealed gesture commits with "full" */
  validate?: "full" | "touched";
}

/** What made a result invalid: the first schema issue or invariant violation */
export interface DocProblem {
  code: string;
  path: (string | number)[];
  message: string;
}

/** A recipe's refusal travels out of Immer as an exception, so the draft is discarded whole */
class RejectSignal {
  constructor(readonly rejection: Rejection) {}
}

function rejected<D>(doc: D, op: unknown, code: RejectCode, message: string, meta?: Record<string, string>): OpResult<D> {
  return { kind: "rejected", doc, op, rejection: reject(code, message, meta) };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

/** One line for an invalid payload: the first issue, with where it is */
function payloadMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
  return fitText(`That change isn't valid (${where}${issue?.message ?? "unknown problem"}).`);
}

function schemaProblem(error: z.ZodError): DocProblem {
  const issue = error.issues[0];
  return { code: "schema", path: (issue?.path ?? []).map((p) => (typeof p === "symbol" ? String(p) : p)), message: issue?.message ?? "Invalid" };
}

/**
 * Full validation (plan §5.2): the strict schema, then the invariants and the size limit. The
 * property suite proves registry ops never fail it; it is the last line of defence.
 */
export function validateDoc(doc: AnyDoc): DocProblem | null {
  if (doc.docType === "project") {
    const parsed = ProjectDocSchema.safeParse(doc);
    if (!parsed.success) return schemaProblem(parsed.error);
    return checkProject(doc)[0] ?? null;
  }
  const parsed = WorkspaceDocSchema.safeParse(doc);
  if (!parsed.success) return schemaProblem(parsed.error);
  return checkWorkspace(doc)[0] ?? null;
}

/**
 * Live gesture frames only (plan §5.2): parse the tasks and mood items the patches touch and check
 * their own rules. A patch anywhere else, or one that adds or removes a whole record, falls back
 * to full validation.
 */
export function validateTouched(doc: AnyDoc, patches: readonly Patch[]): DocProblem | null {
  if (doc.docType !== "project") return validateDoc(doc);
  const tasks = new Set<string>();
  const items = new Set<string>();
  for (const p of patches) {
    const [top, id, next] = p.path;
    if (top === "tasks" && typeof id === "string" && p.path.length > 2) tasks.add(id);
    else if (top === "moodboard" && id === "items" && typeof next === "string" && p.path.length > 3) items.add(next);
    else return validateDoc(doc);
  }
  for (const id of tasks) {
    const task = doc.tasks[id as keyof ProjectDoc["tasks"]];
    const parsed = TaskSchema.safeParse(task);
    if (!parsed.success) return schemaProblem(parsed.error);
    const problem = [...coherenceProblems(task, doc.requireReview), ...milestoneProblems(task)][0];
    if (problem) return { code: "status_progress", path: ["tasks", id], message: problem };
  }
  for (const id of items) {
    const item = doc.moodboard.items[id as keyof ProjectDoc["moodboard"]["items"]];
    const parsed = MoodItemSchema.safeParse(item);
    if (!parsed.success) return schemaProblem(parsed.error);
    if (item.x + item.w > 1 + 1e-9) return { code: "mood_item", path: ["moodboard", "items", id], message: "Past the board's right edge." };
  }
  return null;
}

/** Applies one raw op to one document (plan §5.2) */
export function applyOp<D extends AnyDoc>(doc: D, raw: unknown, ctx: ReduceCtx, opts: ApplyOptions = {}): OpResult<D> {
  const def = defOf(raw);
  if (!def) return rejected(doc, raw, "unknown_op", "FORM doesn't know that change.");
  const parsed = def.schema.safeParse(raw);
  if (!parsed.success) return rejected(doc, raw, "invalid_payload", payloadMessage(parsed.error));
  // The op object is frozen too: a recipe that mutates its payload throws (property 5)
  const op = deepFreeze(parsed.data) as Op;
  if (def.scope !== doc.docType) return rejected(doc, op, "wrong_scope", "That change belongs to another document.");

  let next: AnyDoc;
  let patches: Patch[];
  let inverse: Patch[];
  try {
    [next, patches, inverse] = produceWithPatches(doc as AnyDoc, (draft) => {
      const refusal = def.reduce(draft as never, op, ctx);
      if (refusal) throw new RejectSignal(refusal);
    });
  } catch (e) {
    if (e instanceof RejectSignal) return { kind: "rejected", doc, op, rejection: reject(e.rejection.code, e.rejection.message, e.rejection.meta) };
    // Anything else is a bug in a recipe: the tests fail on it
    throw e;
  }
  if (patches.length === 0) return { kind: "noop", doc, op };

  const spawned = def.spawn?.(op, ctx);
  const problem = (opts.validate === "touched" ? validateTouched(next, patches) : validateDoc(next)) ?? (spawned ? validateDoc(spawned) : null);
  if (problem) {
    return rejected(doc, op, "invalid_result", "That change would break the workspace, so FORM didn't apply it.", {
      problem: problem.code,
      path: problem.path.join("/"),
      detail: fitText(problem.message, 200),
    });
  }
  return { kind: "applied", doc: next as D, op, patches, inverse, ...(spawned ? { spawned: deepFreeze(spawned) } : {}) };
}

/**
 * Applies a commit's ops in order, best-effort (plan §5.3): each sees the previous result, and a
 * rejected op is reported while later ops still run. More than 12 non-system ops reject them all.
 */
export function applyCommit<D extends AnyDoc>(doc: D, ops: readonly unknown[], ctx: ReduceCtx, opts: ApplyOptions = {}): CommitResult<D> {
  if (ops.filter((o) => !isSystemOp(o)).length > OPS_PER_COMMAND) {
    const results = ops.map((o) => rejected(doc, o, "limit", `A command can change at most ${OPS_PER_COMMAND} things.`));
    return { doc, changed: false, results, patches: [], inverse: [], spawned: [] };
  }
  let current = doc;
  const results: OpResult<D>[] = [];
  const patches: Patch[] = [];
  const inverses: Patch[][] = [];
  const spawned: ProjectDoc[] = [];
  for (const raw of ops) {
    const result = applyOp(current, raw, ctx, opts);
    results.push(result);
    if (result.kind !== "applied") continue;
    current = result.doc;
    patches.push(...result.patches);
    inverses.push(result.inverse);
    if (result.spawned) spawned.push(result.spawned);
  }
  return { doc: current, changed: inverses.length > 0, results, patches, inverse: inverses.reverse().flat(), spawned };
}

/** The document an op of this scope applies to */
export function isWorkspaceDoc(doc: AnyDoc): doc is WorkspaceDoc {
  return doc.docType === "workspace";
}
