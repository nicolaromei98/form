// The fast parser is total and builds only well-formed ops (plan §8.4, §10.3). Over random
// commands (corpus phrases, phrases with extra words, word soups from the parser's vocabulary and
// arbitrary text) on every named fixture, with any selection and view:
// 1. fastParse never throws, and is deterministic for a given minter;
// 2. every op it returns parses with its registry schema (strict);
// 3. running its command never meets `invalid_payload` or `invalid_result`: whatever the reducer
//    refuses, it refuses for the state (not found, limits…), never for a payload the parser broke;
// 4. a caption, when there is one, is 1–280 characters.
// Runs FC_RUNS times (10,000 in CI).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sortedByOrder } from "@/lib/domain/order";
import { FIXTURE_NAMES, type FixtureName } from "@/lib/ops/registry/_contract";
import { OpSchema } from "@/lib/ops/registry";
import { fastParse, toCommand } from "@/lib/interpret/fast";
import { namedFixture } from "../fixtures/v2/named";
import { CORPUS } from "../golden/corpus";
import { fastContext, run, type V2State } from "../golden/parser-harness";

const PHRASES = [...new Set(CORPUS.map((c) => c.say))];
const VOCAB = [
  ...new Set(
    PHRASES.join(" ")
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 0),
  ),
  "#e4572e",
  "#abc",
  "€2,400",
  "12k",
  "2 weeks",
  "0.5 days",
  "300 days",
  "8 days a week",
  "40%",
  "150%",
  ":",
  '"',
  "and",
  "Task 7",
  "Step 2",
  "Milestone 12",
  "Giulia",
  "Paolo",
  " ",
];

const command = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom(...PHRASES) },
  { weight: 3, arbitrary: fc.tuple(fc.constantFrom(...PHRASES), fc.array(fc.constantFrom(...VOCAB), { maxLength: 4 })).map(([p, ws]) => [p, ...ws].join(" ")) },
  { weight: 3, arbitrary: fc.array(fc.constantFrom(...VOCAB), { minLength: 1, maxLength: 10 }).map((ws) => ws.join(" ")) },
  { weight: 1, arbitrary: fc.string({ unit: "grapheme", maxLength: 120 }) },
);

/** A named fixture with a view of its project on screen and, maybe, a task selected */
const stateArb = fc.record({ fixture: fc.constantFrom<FixtureName>(...FIXTURE_NAMES), view: fc.nat(), selected: fc.option(fc.nat(), { nil: null }) }).map(({ fixture, view, selected }): V2State => {
  const f = namedFixture(fixture);
  const project = f.projectId !== null ? f.projects[f.projectId] : null;
  const tasks = project ? sortedByOrder(project.tasks) : [];
  return {
    docs: { workspace: f.workspace, projects: f.projects },
    projectId: f.projectId,
    local: {
      activeView: project ? project.views[view % project.views.length] : "cards",
      selectedTaskId: selected !== null && tasks.length > 0 ? tasks[selected % tasks.length].id : f.selectedTaskId,
      timelineZoom: "day",
    },
  };
});

describe("fastParse", () => {
  it("is total, deterministic and builds only well-formed ops", () => {
    fc.assert(
      fc.property(stateArb, command, fc.integer({ min: 1, max: 1_000_000 }), (state, say, seed) => {
        const result = fastParse(say, fastContext(state, seed));
        expect(fastParse(say, fastContext(state, seed))).toEqual(result);
        if (result.status !== "matched" || "control" in result) return;
        for (const op of result.ops) expect(OpSchema.safeParse(op).success, JSON.stringify(op)).toBe(true);
        const cmd = toCommand(result, say);
        if (!cmd) return;
        const r = run(state, cmd);
        for (const o of r.outcomes) {
          if (o.result.kind === "rejected") expect(["invalid_payload", "invalid_result"], `${say}: ${o.result.rejection.message}`).not.toContain(o.result.rejection.code);
        }
        if (r.caption) {
          expect(r.caption.text.length).toBeGreaterThan(0);
          expect(r.caption.text.length).toBeLessThanOrEqual(280);
        }
      }),
    );
  });

  it("never writes to its inputs: every corpus command on deeply frozen fixtures", () => {
    for (const fixture of FIXTURE_NAMES) {
      const f = deepFreeze(namedFixture(fixture));
      const project = f.projectId !== null ? f.projects[f.projectId] : null;
      const state: V2State = {
        docs: { workspace: f.workspace, projects: f.projects },
        projectId: f.projectId,
        local: deepFreeze({ activeView: project?.views[0] ?? "cards", selectedTaskId: f.selectedTaskId, timelineZoom: "day" }),
      };
      for (const say of PHRASES) expect(() => fastParse(say, fastContext(state, 1)), `${fixture}: ${say}`).not.toThrow();
    }
  });
});

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}
