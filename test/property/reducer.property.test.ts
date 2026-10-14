// The reducer properties (plan §10.3, checks 1–9), over runs of up to 30 generated steps from four
// fixtures, through the command runner in full-validation mode. After every step:
//   1. both schemas parse, and nothing is ever refused as invalid_result;
//   2. the invariants hold;
//   3. the inverse patches undo the op and the patches redo it;
//   4. two runs on structured clones agree, and so does a run on a JSON copy with every
//      object's keys in another order (the jsonb guard);
//   5. inputs and ops are deeply frozen, so a mutating recipe throws;
//   6. a no-op returns the same reference, and an idempotent op applied twice is a no-op;
//   7. a rejection keeps the reference, with a known code and a 1–140 character message;
//   8. an applied op yields a 1–280 character caption;
//   9. documents stay within 1 MB.
// At the end of each run, undoing everything restores the start exactly and redoing restores the end.
// Only implemented ops are drawn (arbitraries.ts), so the step 10 families join automatically.
// Property 10 (planning) and the coverage meta-test arrive with step 16.
import fc from "fast-check";
import { applyPatches, type Patch } from "immer";
import { afterAll, describe, expect, it } from "vitest";
import { seededMinter } from "@/lib/domain/ids";
import { checkProject, checkWorkspace, docBytes } from "@/lib/domain/invariants/check";
import { DOC_BYTES_MAX } from "@/lib/domain/limits";
import type { ProjectId } from "@/lib/domain/schema/ids";
import { defaultLocalViewState } from "@/lib/domain/schema/local";
import { type ProjectDoc, ProjectDocSchema } from "@/lib/domain/schema/project";
import { type WorkspaceDoc, WorkspaceDocSchema } from "@/lib/domain/schema/workspace";
import { type CommandCtx, runCommand } from "@/lib/ops/command";
import { type AnyDoc, applyOp } from "@/lib/ops/reduce";
import { type Op, REGISTRY } from "@/lib/ops/registry";
import { type ReduceCtx, REJECT_CODES } from "@/lib/ops/registry/_contract";
import { FIXTURE_NOW, FIXTURE_TODAY } from "../fixtures/v2/build";
import { PROPERTY_FIXTURES, runArb, START_PROPOSALS, WEIGHTED_OP_NAMES } from "./arbitraries";
import { type GenState, materialise, startState } from "./materialise";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

/** A JSON copy with every object's keys in another (deterministic) order: what Postgres jsonb may hand back */
function shuffledCopy<T>(value: T, salt: number): T {
  const shuffle = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(shuffle);
    if (v === null || typeof v !== "object") return v;
    const keys = Object.keys(v);
    const order = keys.map((_, i) => keys[(i + salt) % keys.length]).reverse();
    return Object.fromEntries(order.map((k) => [k, shuffle((v as Record<string, unknown>)[k])]));
  };
  return shuffle(JSON.parse(JSON.stringify(value))) as T;
}

/** JSON with every object's keys sorted, so equal values print the same whatever their key order */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const entries = Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(",")}}`;
}

/** Patches as a multiset: a shuffled document may list the same changes in another order */
const sortedPatches = (patches: readonly Patch[]) => patches.map(canonical).sort();

function idSource(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

/** The context runCommand gives a one-op command on this state */
function reduceCtx(state: GenState): ReduceCtx {
  return {
    now: FIXTURE_NOW,
    actorId: null,
    source: "agent",
    workspace: state.workspace,
    readProject: (id) => state.projects[id] ?? null,
    ownership: (person) => {
      let n = 0;
      for (const p of Object.values(state.projects)) {
        for (const t of Object.values(p.tasks)) {
          if (t.ownerId === person) n++;
          for (const s of t.steps) if (s.ownerId === person) n++;
        }
      }
      return n;
    },
  };
}

type DocKey = "workspace" | ProjectId;
const docAt = (state: GenState, key: DocKey): AnyDoc => (key === "workspace" ? state.workspace : state.projects[key]);
function withDoc(state: GenState, key: DocKey, doc: AnyDoc): GenState {
  if (key === "workspace") return { ...state, workspace: doc as WorkspaceDoc };
  return { ...state, projects: { ...state.projects, [key]: doc as ProjectDoc } };
}

function expectValid(doc: AnyDoc): void {
  if (doc.docType === "project") {
    expect(ProjectDocSchema.safeParse(doc).success).toBe(true);
    expect(checkProject(doc)).toEqual([]);
  } else {
    expect(WorkspaceDocSchema.safeParse(doc).success).toBe(true);
    expect(checkWorkspace(doc)).toEqual([]);
  }
  expect(docBytes(doc)).toBeLessThanOrEqual(DOC_BYTES_MAX);
}

/** Outcome counts per op, to prove the generators reach every outcome */
const seen = new Map<string, { applied: number; noop: number; rejected: number }>();
const tally = (op: string, kind: "applied" | "noop" | "rejected") => {
  const row = seen.get(op) ?? { applied: 0, noop: 0, rejected: 0 };
  row[kind]++;
  seen.set(op, row);
};

describe("reducer properties", () => {
  it("start from valid fixtures", () => {
    for (const fixture of PROPERTY_FIXTURES) {
      for (const requireReview of [false, true]) {
        for (const proposal of START_PROPOSALS) {
          const state = startState(fixture, requireReview, proposal);
          expectValid(state.workspace);
          for (const p of Object.values(state.projects)) expectValid(p);
          if (proposal && state.projectId) expect(state.projects[state.projectId].proposal?.kind).toBe(proposal);
        }
      }
    }
  });

  it("hold after every op, and undo and redo whole runs", () => {
    fc.assert(
      fc.property(runArb, (run) => {
        const mint = seededMinter(run.steps.length + 1);
        const initial = startState(run.fixture, run.requireReview, run.proposal);
        let state = initial;
        const history: { key: DocKey; patches: Patch[]; inverse: Patch[] }[] = [];

        for (const step of run.steps) {
          const raw = deepFreeze(materialise(step, state, mint));
          if (raw === null) continue;
          const project = state.projectId !== null ? state.projects[state.projectId] : null;
          const ctx: CommandCtx = {
            now: FIXTURE_NOW,
            actorId: null,
            projectId: state.projectId,
            local: defaultLocalViewState(project),
            today: FIXTURE_TODAY,
            newId: idSource(),
          };
          const docs = { workspace: state.workspace, projects: state.projects };
          const res = runCommand(docs, { ops: [raw as Op], local: [], notes: [], notices: [], source: "agent", text: null }, ctx);
          expect(res.outcomes).toHaveLength(1);
          const outcome = res.outcomes[0];
          const result = outcome.result;
          tally(step.op, result.kind);

          if (result.kind === "rejected") {
            // 1 and 7
            expect(result.rejection.code, result.rejection.message).not.toBe("invalid_result");
            expect(REJECT_CODES).toContain(result.rejection.code);
            expect(result.rejection.message.length).toBeGreaterThan(0);
            expect(result.rejection.message.length).toBeLessThanOrEqual(140);
            if (result.doc !== null) expect(result.doc).toBe(outcome.before);
            expect(res.changed).toBe(false);
            expect(res.state).toBe(docs);
            continue;
          }
          if (result.kind === "noop") {
            // 6
            expect(result.doc).toBe(outcome.before);
            expect(res.changed).toBe(false);
            expect(res.state).toBe(docs);
            continue;
          }

          const before = outcome.before!;
          const after = result.doc;
          const key: DocKey = after.docType === "workspace" ? "workspace" : after.id;
          // 1, 2 and 9
          expectValid(after);
          // 3
          expect(applyPatches(after, result.inverse)).toEqual(before);
          expect(applyPatches(before, result.patches)).toEqual(after);
          // 4: clones, then a jsonb-shaped copy with shuffled keys
          const rctx = reduceCtx(state);
          for (let i = 0; i < 2; i++) {
            const again = applyOp(structuredClone(before), structuredClone(raw), rctx);
            expect(again.kind).toBe("applied");
            expect(again.doc).toEqual(after);
            if (again.kind === "applied") expect(again.patches).toEqual(result.patches);
          }
          const shuffled = applyOp(shuffledCopy(before, step.picks[0]), shuffledCopy(raw, 1), rctx);
          expect(shuffled.kind).toBe("applied");
          expect(shuffled.doc).toEqual(after);
          if (shuffled.kind === "applied") expect(sortedPatches(shuffled.patches)).toEqual(sortedPatches(result.patches));
          // 6: an idempotent op applied twice
          if (REGISTRY.get((raw as { op: string }).op)!.idempotent) expect(applyOp(after, raw, rctx).kind).toBe("noop");
          // 8
          expect(res.caption?.text.length ?? 0).toBeGreaterThan(0);
          expect(res.caption!.text.length).toBeLessThanOrEqual(280);
          // 5: the next step's inputs are frozen documents
          expect(Object.isFrozen(after)).toBe(true);

          expect(res.state.projects[key as ProjectId] ?? res.state.workspace).toBe(after);
          history.push({ key, patches: result.patches, inverse: result.inverse });
          state = { workspace: res.state.workspace, projects: res.state.projects, projectId: res.projectId ?? state.projectId };
        }

        // Undo everything, then redo everything
        let undone = state;
        for (const h of [...history].reverse()) undone = withDoc(undone, h.key, applyPatches(docAt(undone, h.key), h.inverse));
        expect(undone.workspace).toEqual(initial.workspace);
        expect(undone.projects).toEqual(initial.projects);
        let redone = undone;
        for (const h of history) redone = withDoc(redone, h.key, applyPatches(docAt(redone, h.key), h.patches));
        expect(redone.workspace).toEqual(state.workspace);
        expect(redone.projects).toEqual(state.projects);
      }),
    );
  });

  afterAll(() => {
    // The generators reach every outcome of every implemented op
    const ops = new Set(WEIGHTED_OP_NAMES);
    for (const op of ops) {
      const row = seen.get(op);
      if (!row || Number(process.env.FC_RUNS ?? 500) < 200) continue;
      expect(row.applied, `${op} applied`).toBeGreaterThan(0);
      expect(row.rejected, `${op} rejected`).toBeGreaterThan(0);
      if (REGISTRY.get(op)!.idempotent) expect(row.noop, `${op} no-op`).toBeGreaterThan(0);
    }
    if (process.env.FORM_PROPERTY_STATS) console.log(Object.fromEntries(seen));
  });
});
