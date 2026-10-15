// The reducer properties (plan §10.3, checks 1–9), over runs of up to 30 generated steps from the
// property fixtures, through the command runner in full-validation mode (`runner.ts`). After
// every op of every command:
//   1. both schemas parse, and nothing is ever refused as invalid_result;
//   2. the invariants hold;
//   3. the inverse patches undo the op and the patches redo it;
//   4. two runs on structured clones agree, documents and patches, and so does a run on JSON
//      copies with every object's keys in another order (the jsonb guard), its context included;
//   5. inputs, ops and results are deeply frozen, so a mutating recipe throws;
//   6. a no-op returns the same reference, and an idempotent op applied twice is a no-op;
//   7. a rejection keeps the reference, with a known code and a 1–140 character message, and the
//      same op sent to a document of the other scope is refused (wrong_scope) untouched;
//   8. an applied op yields a 1–280 character caption; a system op alone yields none;
//   9. documents stay within 1 MB.
// Spawned projects (createProject, duplicateProject) are checked like any result. At the end of
// each run, undoing everything restores the start exactly (spawned projects dropped) and redoing
// everything restores the end. Property 10 is planning.property.test.ts; the coverage meta-test
// is coverage.property.test.ts.
import fc from "fast-check";
import { applyPatches } from "immer";
import { afterAll, describe, expect, it } from "vitest";
import { checkProject, checkWorkspace, docBytes } from "@/lib/domain/invariants/check";
import { DOC_BYTES_MAX } from "@/lib/domain/limits";
import type { ProjectId } from "@/lib/domain/schema/ids";
import { ProjectDocSchema } from "@/lib/domain/schema/project";
import { WorkspaceDocSchema } from "@/lib/domain/schema/workspace";
import { type AnyDoc, applyOp } from "@/lib/ops/reduce";
import { defOf, REGISTRY, SYSTEM_OPS } from "@/lib/ops/registry";
import { REJECT_CODES } from "@/lib/ops/registry/_contract";
import { PROPERTY_FIXTURES, runArb, START_PROPOSALS, WEIGHTED_OP_NAMES } from "./arbitraries";
import { startState } from "./materialise";
import {
  executeRun,
  otherDoc,
  redoAll,
  reduceCtx,
  runsTimeout,
  shuffledCopy,
  shuffledCtx,
  sortedPatches,
  type StepRecord,
  undoAll,
} from "./runner";

function expectValid(doc: AnyDoc): void {
  if (doc.docType === "project") {
    const parsed = ProjectDocSchema.safeParse(doc);
    expect(parsed.success, parsed.error?.message).toBe(true);
    expect(checkProject(doc)).toEqual([]);
  } else {
    const parsed = WorkspaceDocSchema.safeParse(doc);
    expect(parsed.success, parsed.error?.message).toBe(true);
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

/** Checks 1–9 on one step's command */
function checkStep({ raw, before: state, result: res, step }: StepRecord): void {
  const ctx = reduceCtx(state);
  let applied = 0;
  let spoke = false;

  res.outcomes.forEach((outcome, i) => {
    const result = outcome.result;
    const name = outcome.def?.name ?? "(unknown)";
    // The step's own op is the first outcome; a system op the runner appended comes after it
    const opRaw = i === 0 ? raw : result.op;
    if (i === 0) tally(step.op, result.kind);

    if (result.kind === "rejected") {
      // 1 and 7
      expect(result.rejection.code, result.rejection.message).not.toBe("invalid_result");
      expect(REJECT_CODES).toContain(result.rejection.code);
      expect(result.rejection.message.length).toBeGreaterThan(0);
      expect(result.rejection.message.length).toBeLessThanOrEqual(140);
      if (outcome.before === null) expect(["limit", "no_project"]).toContain(result.rejection.code);
      else expect(result.doc).toBe(outcome.before);
      return;
    }
    if (result.kind === "noop") {
      // 6
      expect(result.doc).toBe(outcome.before);
      return;
    }

    applied++;
    if (!SYSTEM_OPS.has(name)) spoke = true;
    const before = outcome.before!;
    const after = result.doc;
    // 1, 2 and 9
    expectValid(after);
    // 3
    expect(applyPatches(after, result.inverse)).toEqual(before);
    expect(applyPatches(before, result.patches)).toEqual(after);
    // 4: clones twice, then jsonb-shaped copies with shuffled keys (the context's documents too)
    for (let k = 0; k < 2; k++) {
      const again = applyOp(structuredClone(before), structuredClone(opRaw), ctx);
      expect(again.kind).toBe("applied");
      expect(again.doc).toEqual(after);
      if (again.kind === "applied") {
        expect(again.patches).toEqual(result.patches);
        expect(again.inverse).toEqual(result.inverse);
        expect(again.spawned).toEqual(result.spawned);
      }
    }
    const salt = step.picks[0] + i;
    const shuffled = applyOp(shuffledCopy(before, salt), shuffledCopy(opRaw, salt + 1), shuffledCtx(state, salt + 2));
    expect(shuffled.kind).toBe("applied");
    expect(shuffled.doc).toEqual(after);
    if (shuffled.kind === "applied") {
      expect(sortedPatches(shuffled.patches)).toEqual(sortedPatches(result.patches));
      expect(shuffled.spawned).toEqual(result.spawned);
    }
    // 6: an idempotent op applied twice
    if (REGISTRY.get(name)!.idempotent) expect(applyOp(after, opRaw, ctx).kind).toBe("noop");
    // 5: results are frozen, so they can be the next step's inputs
    expect(Object.isFrozen(after)).toBe(true);
    // Spawned projects: valid, frozen, and in the runner's state
    if (result.spawned) {
      expectValid(result.spawned);
      expect(Object.isFrozen(result.spawned)).toBe(true);
      expect(res.spawned).toContain(result.spawned);
      expect(res.state.projects[result.spawned.id]).toBe(result.spawned);
    }
  });

  // 7: the same op on a document of the other scope is refused untouched
  const other = otherDoc(state, raw);
  if (other !== null) {
    const misrouted = applyOp(other, raw, ctx);
    // Unknown names and payloads their schema refuses are turned away before the scope is read
    const def = defOf(raw);
    const expected = !def ? "unknown_op" : def.schema.safeParse(raw).success ? "wrong_scope" : "invalid_payload";
    expect(misrouted.kind === "rejected" ? misrouted.rejection.code : misrouted.kind).toBe(expected);
    expect(misrouted.doc).toBe(other);
  }

  // The command as a whole: a history entry exactly when something applied
  expect(res.changed).toBe(applied > 0);
  if (applied === 0) {
    expect(res.state.workspace).toBe(state.workspace);
    expect(res.state.projects).toBe(state.projects);
  }
  for (const c of res.commits) {
    const doc = c.result.doc.docType === "workspace" ? res.state.workspace : res.state.projects[c.docId as ProjectId];
    expect(doc).toBe(c.result.doc);
  }
  // 8
  if (spoke) {
    expect(res.caption?.text.length ?? 0).toBeGreaterThan(0);
    expect(res.caption!.text.length).toBeLessThanOrEqual(280);
  } else if (applied > 0) expect(res.caption).toBeNull();
}

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
        const { initial, final, history } = executeRun(run, checkStep);
        // Undo everything, then redo everything
        const undone = undoAll(final, history);
        expect(undone.workspace).toEqual(initial.workspace);
        expect(undone.projects).toEqual(initial.projects);
        const redone = redoAll(undone, history);
        expect(redone.workspace).toEqual(final.workspace);
        expect(redone.projects).toEqual(final.projects);
      }),
    );
  }, runsTimeout());

  afterAll(() => {
    if (process.env.FORM_PROPERTY_STATS) console.log(Object.fromEntries([...seen].sort(([a], [b]) => (a < b ? -1 : 1))));
    // Every op was checked applied and refused at least once. The no-ops of idempotent ops, rarer
    // for some, and the stricter counts are the coverage meta-test's (2,000 runs or more).
    if (Number(process.env.FC_RUNS ?? 500) < 500) return;
    for (const op of new Set(WEIGHTED_OP_NAMES)) {
      const row = seen.get(op) ?? { applied: 0, noop: 0, rejected: 0 };
      expect(row.applied, `${op} applied`).toBeGreaterThan(0);
      expect(row.rejected, `${op} rejected`).toBeGreaterThan(0);
    }
  });
});
