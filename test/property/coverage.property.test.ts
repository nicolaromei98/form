// The coverage meta-test (plan §10.3): the generators exercise the whole registry. Over 2,000 runs
// (more when FC_RUNS asks for more), every op is applied at least 20 times, every idempotent op
// shows a no-op, and every reject code occurs, except invalid_result, which property 1 forbids.
// wrong_scope can't come out of the runner (it routes each op by its scope), so every step's op is
// also replayed against a document of the other scope, as a Phase 2 replay of a misrouted commit
// would be. Only outcomes are counted here; reducer.property.test.ts checks them.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyOp } from "@/lib/ops/reduce";
import { OP_NAMES, REGISTRY } from "@/lib/ops/registry";
import { REJECT_CODES, type RejectCode } from "@/lib/ops/registry/_contract";
import { runArb } from "./arbitraries";
import { executeRun, otherDoc, reduceCtx, runsTimeout, type StepRecord } from "./runner";

/** Plan §10.3: the meta-test's floor of runs and of applications per op */
const COVERAGE_RUNS = 2_000;
const MIN_APPLIED = 20;

describe("coverage of the property generators", () => {
  it(`apply every op ${MIN_APPLIED}+ times, show every idempotent no-op and reach every reject code`, () => {
    const outcomes = new Map<string, { applied: number; noop: number; rejected: number }>();
    const codes = new Map<RejectCode, number>();
    /** "op:code" → count, for the stats only */
    const refusals = new Map<string, number>();
    const count = (code: RejectCode) => codes.set(code, (codes.get(code) ?? 0) + 1);

    const visit = ({ step, raw, before, result }: StepRecord) => {
      // The step's own op is the first outcome; a system op the runner appends comes after it
      const first = result.outcomes[0].result;
      const row = outcomes.get(step.op) ?? { applied: 0, noop: 0, rejected: 0 };
      row[first.kind]++;
      outcomes.set(step.op, row);
      if (first.kind === "rejected") {
        const key = `${step.op}:${first.rejection.code}`;
        refusals.set(key, (refusals.get(key) ?? 0) + 1);
      }
      for (const o of result.outcomes) if (o.result.kind === "rejected") count(o.result.rejection.code);
      const other = otherDoc(before, raw);
      if (other !== null) {
        const misrouted = applyOp(other, raw, reduceCtx(before));
        if (misrouted.kind === "rejected") count(misrouted.rejection.code);
      }
    };

    const runs = Math.max(COVERAGE_RUNS, fc.readConfigureGlobal().numRuns ?? 0);
    fc.assert(
      fc.property(runArb, (run) => void executeRun(run, visit)),
      { numRuns: runs },
    );
    if (process.env.FORM_PROPERTY_STATS) {
      console.log(Object.fromEntries([...outcomes].sort(([a], [b]) => (a < b ? -1 : 1))));
      console.log(Object.fromEntries(codes));
      console.log(Object.fromEntries([...refusals].sort(([a], [b]) => (a < b ? -1 : 1))));
    }

    const missing: string[] = [];
    for (const name of OP_NAMES) {
      const row = outcomes.get(name) ?? { applied: 0, noop: 0, rejected: 0 };
      if (row.applied < MIN_APPLIED) missing.push(`${name} applied ${row.applied} times`);
      if (REGISTRY.get(name)!.idempotent && row.noop === 0) missing.push(`${name} never a no-op`);
    }
    for (const code of REJECT_CODES) {
      if (code !== "invalid_result" && !codes.has(code)) missing.push(`no ${code}`);
    }
    expect(missing).toEqual([]);
    expect(codes.get("invalid_result") ?? 0).toBe(0);
  }, runsTimeout(15));
});
