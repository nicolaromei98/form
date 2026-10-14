// Arbitraries of the property suite (plan §10.3). Runs are sequences of step *intents* over a
// fixture; `materialise.ts` turns each intent into a raw op against the state of that moment, so
// shrinking works on plain numbers and strings.
import fc from "fast-check";
import { OP_NAMES, type OpName, REGISTRY } from "@/lib/ops/registry";
import type { StepIntent } from "./gen/_pick";

/** Task, step, dependency and proposal ops are drawn three times as often */
const HEAVY = /Task|Step|Dependency|propose|Proposal/;

/**
 * The ops a run draws from: every implemented op (stubs refuse everything, so they are left out
 * until their family fills them), weighted.
 */
export const WEIGHTED_OP_NAMES: readonly OpName[] = OP_NAMES.filter((name) => !REGISTRY.get(name)!.stub).flatMap((name) =>
  HEAVY.test(name) ? [name, name, name] : [name],
);

export const stepArb: fc.Arbitrary<StepIntent> = fc.record({
  op: fc.constantFrom(...WEIGHTED_OP_NAMES),
  picks: fc.array(fc.nat(), { minLength: 6, maxLength: 6 }),
  text: fc.oneof(
    fc.string({ maxLength: 160, unit: "grapheme" }),
    fc.constantFrom("", "  x", "x".repeat(140), "x".repeat(141), "x".repeat(81), "Research", "UI Design"),
  ),
  nums: fc.array(fc.double({ min: -10, max: 400, noNaN: true }), { minLength: 4, maxLength: 4 }),
  flags: fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
});

/** The fixture states runs start from (`materialise.ts`, `startState`) */
export const PROPERTY_FIXTURES = ["empty", "demo", "generated60", "multiProject150"] as const;
export type PropertyFixture = (typeof PROPERTY_FIXTURES)[number];

/** A pending proposal the run starts with, so ops that prune proposals meet every kind */
export const START_PROPOSALS = [null, "subtasks", "reassign", "leveling", "estimates", "plan"] as const;
export type StartProposal = (typeof START_PROPOSALS)[number];

export interface Run {
  fixture: PropertyFixture;
  /** Turns the review step on before the run, so review@100 is reachable */
  requireReview: boolean;
  proposal: StartProposal;
  steps: StepIntent[];
}

export const runArb: fc.Arbitrary<Run> = fc.record({
  fixture: fc.constantFrom(...PROPERTY_FIXTURES),
  requireReview: fc.boolean(),
  proposal: fc.constantFrom(...START_PROPOSALS),
  // "max": lengths spread over 0–30, not fast-check's small default (about 10 at most)
  steps: fc.array(stepArb, { maxLength: 30, size: "max" }),
});
