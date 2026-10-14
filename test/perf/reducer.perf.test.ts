// The reducer's budgets (plan §10.7): one updateTask commit with full validation (schema,
// invariants, size) within 2 ms at 150 tasks, a live gesture frame with touched-only validation
// within 0.5 ms, and the growth guard t(300) / t(150) < 3. Documents are frozen, as in the store.
import { describe, expect, it } from "vitest";
import { sortedByOrder } from "@/lib/domain/order";
import type { ProjectDoc } from "@/lib/domain/schema/project";
import { applyCommit } from "@/lib/ops/reduce";
import type { ReduceCtx } from "@/lib/ops/registry/_contract";
import { activeProject, FIXTURE_NOW, type FixtureState, generated } from "../fixtures/v2/build";
import { budget, time } from "./timing";

const PERF_FIXTURE = { stepsPerTask: 3, predsMean: 1.5, people: 8 };

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

function setup(n: number) {
  const state: FixtureState = deepFreeze(generated(n, PERF_FIXTURE));
  const project: ProjectDoc = activeProject(state);
  const ctx: ReduceCtx = {
    now: FIXTURE_NOW,
    actorId: null,
    source: "direct",
    workspace: state.workspace,
    readProject: () => null,
    ownership: () => 0,
  };
  // A task in the middle of the workflow that is still open
  const task = sortedByOrder(project.tasks).find((t, i) => i > n / 2 && t.kind === "task" && t.status !== "done")!;
  let flip = false;
  // Alternate two values so every call changes the document
  const priority = () => [{ op: "updateTask", taskId: task.id, field: "priority", value: (flip = !flip) ? "urgent" : "low" }];
  let p = 10;
  const progress = () => [{ op: "updateTask", taskId: task.id, field: "progress", value: (p = p === 10 ? 20 : 10) }];
  return { project, ctx, priority, progress };
}

describe("reducer at 150 tasks", () => {
  const s150 = setup(150);
  const s300 = setup(300);

  it("commits an updateTask with full validation in at most 2 ms", () => {
    expect(applyCommit(s150.project, s150.priority(), s150.ctx).changed).toBe(true);
    const t150 = time(() => applyCommit(s150.project, s150.priority(), s150.ctx), { runs: 30 });
    const t300 = time(() => applyCommit(s300.project, s300.priority(), s300.ctx), { runs: 30 });
    expect(t150.median).toBeLessThan(budget(2));
    expect(t300.median / t150.median).toBeLessThan(3);
  });

  it("applies a live gesture frame with touched validation in at most 0.5 ms", () => {
    const frame = () => applyCommit(s150.project, s150.progress(), s150.ctx, { validate: "touched" });
    expect(frame().changed).toBe(true);
    const t150 = time(frame, { runs: 30 });
    const t300 = time(() => applyCommit(s300.project, s300.progress(), s300.ctx, { validate: "touched" }), { runs: 30 });
    expect(t150.median).toBeLessThan(budget(0.5));
    expect(t300.median / t150.median).toBeLessThan(3);
  });
});
