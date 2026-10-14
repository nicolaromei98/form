// The deterministic reducer (plan §5.1–§5.3): parse, recipe, validation; references kept for
// no-ops and rejections; frozen results; commits best-effort with inverses in reverse order.
import { applyPatches } from "immer";
import { describe, expect, it } from "vitest";
import { seededMinter } from "@/lib/domain/ids";
import type { TaskId } from "@/lib/domain/schema/ids";
import type { ProjectDoc } from "@/lib/domain/schema/project";
import { applyCommit, applyOp, validateDoc, validateTouched } from "@/lib/ops/reduce";
import { OpSchema, ProjectOpSchema, REGISTRY, WorkspaceOpSchema } from "@/lib/ops/registry";
import { demoState, FIXTURE_NOW, taskByTitle } from "../../../../test/fixtures/v2/build";
import { apply, deepFreeze, expectApplied, expectRejection, projectOf, reduceCtx, type TestState, withDoc } from "../registry/__tests__/support";

const mint = seededMinter(5);
const demo = (): TestState => deepFreeze(demoState());
const id = (s: TestState, title: string): TaskId => taskByTitle(projectOf(s), title).id;
const update = (taskId: TaskId, field: string, value: unknown) => ({ op: "updateTask", taskId, field, value });

describe("applyOp", () => {
  it("refuses what isn't a registry op, by reference", () => {
    const s = demo();
    for (const raw of [{ op: "renameTool", title: "x" }, { op: 3 }, null, "addTask", []]) {
      const r = apply(s, raw);
      expectRejection(r.result, "unknown_op");
      expect(r.result.doc).toBe(r.before);
    }
  });

  it("refuses a payload its schema rejects, naming where", () => {
    const s = demo();
    const r = expectRejection(apply(s, update(id(s, "UI Design"), "progress", 140)).result, "invalid_payload");
    expect(r.message).toMatch(/^That change isn't valid \(value: /);
    expectRejection(apply(s, { op: "removeTask" }).result, "invalid_payload");
  });

  it("refuses an op on the wrong document", () => {
    const s = demo();
    const r = applyOp(s.workspace, { op: "removeTask", taskId: id(s, "UI Design") }, reduceCtx(s));
    expectRejection(r, "wrong_scope");
    expect(r.doc).toBe(s.workspace);
  });

  it("refuses with invalid_result when the result breaks an invariant, keeping the input", () => {
    // A document that is already broken elsewhere: the focus pin names no task
    const s = deepFreeze(withDoc(demo(), { ...projectOf(demo()), viewConfig: { ...projectOf(demo()).viewConfig, focusPin: mint("task") } }));
    const r = apply(s, update(id(s, "UI Design"), "priority", "low"));
    const rejection = expectRejection(r.result, "invalid_result");
    expect(rejection.message).toBe("That change would break the workspace, so FORM didn't apply it.");
    expect(rejection.meta?.problem).toBe("focus_pin");
    expect(r.result.doc).toBe(r.before);
  });

  it("returns frozen documents and freezes the op it applied", () => {
    const s = demo();
    const r = expectApplied(apply(s, update(id(s, "UI Design"), "priority", "low")).result);
    expect(Object.isFrozen(r.doc)).toBe(true);
    expect(Object.isFrozen((r.doc as ProjectDoc).tasks[id(s, "UI Design")])).toBe(true);
    expect(Object.isFrozen(r.op)).toBe(true);
    // Untouched subtrees are shared, not copied
    expect((r.doc as ProjectDoc).tasks[id(s, "Research")]).toBe(projectOf(s).tasks[id(s, "Research")]);
  });

  it("validates only the touched tasks on a live gesture frame", () => {
    const s = demo();
    const r = expectApplied(apply(s, update(id(s, "UI Design"), "progress", 60), { validate: "touched" }).result);
    expect(validateTouched(r.doc, r.patches)).toBeNull();
    expect(validateDoc(r.doc)).toBeNull();
    // A whole-record change falls back to full validation
    const broken = { ...projectOf(s), viewConfig: { ...projectOf(s).viewConfig, focusPin: mint("task") } };
    expect(validateTouched(broken, [{ op: "add", path: ["tasks", "tsk_x"], value: {} }])?.code).toBe("focus_pin");
  });
});

describe("applyCommit", () => {
  it("applies ops in order, best-effort, and inverts the whole commit", () => {
    const s = demo();
    const ui = id(s, "UI Design");
    const ops = [update(ui, "priority", "low"), { op: "removeTask", taskId: mint("task") }, update(ui, "progress", 60)];
    const c = applyCommit(projectOf(s), ops, reduceCtx(s));
    expect(c.results.map((r) => r.kind)).toEqual(["applied", "rejected", "applied"]);
    expect(c.changed).toBe(true);
    expect(c.doc.tasks[ui]).toMatchObject({ priority: "low", progress: 60 });
    expect(applyPatches(projectOf(s), c.patches)).toEqual(c.doc);
    expect(applyPatches(c.doc, c.inverse)).toEqual(projectOf(s));
  });

  it("is unchanged, by reference, when nothing applies", () => {
    const s = demo();
    const c = applyCommit(projectOf(s), [update(id(s, "Research"), "status", "done"), { op: "nope" }], reduceCtx(s));
    expect(c.changed).toBe(false);
    expect(c.doc).toBe(projectOf(s));
    expect(c.patches).toEqual([]);
  });

  it("refuses every op of a commit over 12 non-system ops", () => {
    const s = demo();
    const ops = Array.from({ length: 13 }, () => update(id(s, "UI Design"), "priority", "low"));
    const c = applyCommit(projectOf(s), ops, reduceCtx(s));
    expect(c.changed).toBe(false);
    for (const r of c.results) expectRejection(r, "limit");
  });
});

describe("the op schemas", () => {
  it("parse every op through one discriminated union, split by scope", () => {
    const s = demo();
    const op = update(id(s, "UI Design"), "status", "done");
    expect(OpSchema.safeParse(op).success).toBe(true);
    expect(ProjectOpSchema.safeParse(op).success).toBe(true);
    expect(WorkspaceOpSchema.safeParse(op).success).toBe(false);
    expect(OpSchema.safeParse({ ...op, extra: 1 }).success).toBe(false);
    expect(OpSchema.safeParse({ op: "renameTool" }).success).toBe(false);
    expect(REGISTRY.size).toBe(66);
  });

  it("stamp time only from ctx.now", () => {
    const s = demo();
    const later = "2027-01-01T00:00:00Z" as typeof FIXTURE_NOW;
    const r = expectApplied(apply(s, update(id(s, "UI Design"), "status", "done"), { ctx: { now: later } }).result);
    expect((r.doc as ProjectDoc).tasks[id(s, "UI Design")].completedAt).toBe(later);
  });
});
