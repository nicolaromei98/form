// Full document validation (plan §5.2 validateDoc: strict schema, then the invariants and the
// size) runs after every op, so `applyCommit(updateTask)` can stay within 2 ms at 150 tasks
// (plan §10.7). This file holds the schema and invariant share of that budget, plus the graph
// primitives planning builds on, with the growth guard t(300) / t(150) < 3. Measured on the
// development Mac: schema about 0.4 ms, invariants about 0.3 ms (0.1 of it the JSON size), graph
// about 0.05 ms.
import { describe, expect, it } from "vitest";
import { checkProject, checkWorkspace } from "@/lib/domain/invariants/check";
import { descendantBits, successorMap, topoOrder } from "@/lib/domain/invariants/graph";
import { ProjectDocSchema, WorkspaceDocSchema } from "@/lib/domain/schema";
import { activeProject, generated } from "../fixtures/v2/build";
import { budget, time } from "./timing";

const PERF_FIXTURE = { stepsPerTask: 3, predsMean: 1.5, people: 8 };
const state150 = generated(150, PERF_FIXTURE);
const state300 = generated(300, PERF_FIXTURE);
const p150 = activeProject(state150);
const p300 = activeProject(state300);

function validate(project: typeof p150, workspace: typeof state150.workspace) {
  const parsed = ProjectDocSchema.safeParse(project);
  const ws = WorkspaceDocSchema.safeParse(workspace);
  return parsed.success && ws.success && checkProject(project).length === 0 && checkWorkspace(workspace).length === 0;
}

describe("validation at 150 tasks", () => {
  it("validates a project and its workspace in at most 1.5 ms", () => {
    expect(validate(p150, state150.workspace)).toBe(true);
    const t150 = time(() => validate(p150, state150.workspace), { runs: 30 });
    const t300 = time(() => validate(p300, state300.workspace), { runs: 30 });
    expect(t150.median).toBeLessThan(budget(1.5));
    expect(t300.median / t150.median).toBeLessThan(3);
  });

  it("runs the invariants alone in at most 0.75 ms", () => {
    const t150 = time(() => checkProject(p150), { runs: 30 });
    const t300 = time(() => checkProject(p300), { runs: 30 });
    expect(t150.median).toBeLessThan(budget(0.75));
    expect(t300.median / t150.median).toBeLessThan(3);
  });

  it("orders the graph and its descendants in at most 0.3 ms", () => {
    const graph = (p: typeof p150) => {
      const { order } = topoOrder(p);
      return descendantBits(order, successorMap(p));
    };
    const t150 = time(() => graph(p150), { runs: 30 });
    const t300 = time(() => graph(p300), { runs: 30 });
    expect(t150.median).toBeLessThan(budget(0.3));
    // Descendant bitsets are O((V+E)·V/32): doubling V can quadruple the word work, but stays small
    expect(t300.median / t150.median).toBeLessThan(4);
  });
});
