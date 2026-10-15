// The step 10a ops (plan §11 row 10, registry/README.md): tasks, steps, dependencies, pins,
// assignment, links, members, project fields and order. For each op: the happy path with its
// exact caption and undo by patches, the no-op (same reference plus noopCaption), and every
// rejection it can produce.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { seededMinter } from "@/lib/domain/ids";
import { checkProject } from "@/lib/domain/invariants/check";
import { LINKS_MAX, MEMBERS_MAX, ORDER_KEY_REBALANCE, STEPS_MAX } from "@/lib/domain/limits";
import { compareKeys, nKeys, sortedByOrder } from "@/lib/domain/order";
import type { ClosureId, LinkId, PersonId, StepId, TaskId } from "@/lib/domain/schema/ids";
import { type ProjectDoc, ProjectDocSchema, type Step, type Task } from "@/lib/domain/schema/project";
import type { CaptionPlanning } from "@/lib/ops/caption-env";
import { applyOp } from "@/lib/ops/reduce";
import { REGISTRY } from "@/lib/ops/registry";
import type { CaptionLane } from "@/lib/ops/registry/_contract";
import { longestOrderKey } from "@/lib/ops/registry/_helpers";
import { DEMO_PEOPLE, demoState, FIXTURE_NOW, makePerson, taskByTitle } from "../../../../../test/fixtures/v2/build";
import { namedFixture } from "../../../../../test/fixtures/v2/named";
import { PROPERTY_FIXTURES, stepArb } from "../../../../../test/property/arbitraries";
import { GENERATORS } from "../../../../../test/property/gen";
import { rebalancePayload } from "../../../../../test/property/gen/rebalanceOrder";
import { type GenState, startState } from "../../../../../test/property/materialise";
import {
  apply,
  captionOf,
  deepFreeze,
  expectApplied,
  expectInverse,
  expectNoop,
  expectRejection,
  projectOf,
  reduceCtx,
  run,
  type TestState,
  withDoc,
} from "./support";

const mint = seededMinter(1010);
const demo = (): TestState => deepFreeze(demoState());
const project = (s: TestState) => projectOf(s);
const id = (s: TestState, title: string): TaskId => taskByTitle(project(s), title).id;
const after = (r: { result: { kind: string; doc: unknown } }) => r.result.doc as ProjectDoc;
const order = (p: ProjectDoc) => sortedByOrder(p.tasks).map((t) => t.title);

/** A state whose active project is edited by `edit` */
function edited(state: TestState, edit: (p: ProjectDoc) => ProjectDoc): TestState {
  return deepFreeze(withDoc(state, edit(project(state))));
}

/** One task of the active project replaced by `edit(task)` */
function editTask(state: TestState, title: string, edit: (t: Task) => Task): TestState {
  return edited(state, (p) => {
    const t = taskByTitle(p, title);
    return { ...p, tasks: { ...p.tasks, [t.id]: edit(t) } };
  });
}

/** The demo with Giulia in the workspace: active, not a member of the project */
const GIULIA = mint("person");
function withGiulia(state: TestState = demoState()): TestState {
  const giulia = makePerson({ id: GIULIA, name: "Giulia", order: nKeys(4)[3] });
  return deepFreeze({ ...state, workspace: { ...state.workspace, people: { ...state.workspace.people, [giulia.id]: giulia } } });
}

/** The demo with Luca archived */
function lucaArchived(): TestState {
  const s = demoState();
  const luca = { ...s.workspace.people[DEMO_PEOPLE.luca], archived: true };
  return deepFreeze({ ...s, workspace: { ...s.workspace, people: { ...s.workspace.people, [luca.id]: luca } } });
}

/** UI Design's steps in the step tests: Wireframes, QA pass, Handoff */
const STEP = { wire: mint("step"), qa: mint("step"), handoff: mint("step") } as const;
const step = (id: StepId, title: string, o: Partial<Step> = {}): Step => ({ id, title, done: false, ownerId: null, estimateDays: null, ...o });
function withSteps(state: TestState = demo()): TestState {
  return editTask(state, "UI Design", (t) => ({
    ...t,
    steps: [step(STEP.wire, "Wireframes", { done: true, estimateDays: 1 }), step(STEP.qa, "QA pass"), step(STEP.handoff, "Handoff")],
  }));
}
const stepTitles = (p: ProjectDoc, s: TestState) => p.tasks[id(s, "UI Design")].steps.map((x) => x.title);

/** A planning seam whose Team lanes are fixed, for captions that read them */
function lanes(list: Partial<CaptionLane>[]): { ctx: { planning: CaptionPlanning } } {
  const full = list.map((l) => ({ personId: null, days: 0, capacity: null, over: null, free: null, ...l }));
  return { ctx: { planning: { plan: () => null, focus: () => null, lanes: () => full } } };
}

/* ------------------------------------------------------------------
   moveTask
   ------------------------------------------------------------------ */

describe("moveTask", () => {
  const move = (taskId: TaskId, place: unknown, status?: string) => ({ op: "moveTask", taskId, place, ...(status ? { status } : {}) });

  it("moves a task after an anchor, keeping the others' keys", () => {
    const s = demo();
    const op = move(id(s, "UI Design"), { after: id(s, "Research") });
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(order(after(r))).toEqual(["Research", "UI Design", "Visual Direction", "Development"]);
    expect(after(r).tasks[id(s, "Research")].order).toBe(project(s).tasks[id(s, "Research")].order);
    expect(captionOf(s, op)).toBe("UI Design moved after Research");
  });

  it("moves to the start and to the end", () => {
    const s = demo();
    expect(order(after(apply(s, move(id(s, "UI Design"), "start"))))).toEqual(["UI Design", "Research", "Visual Direction", "Development"]);
    expect(captionOf(s, move(id(s, "UI Design"), "start"))).toBe("UI Design moved to the start");
    expect(order(after(apply(s, move(id(s, "Research"), "end"))))).toEqual(["Visual Direction", "UI Design", "Development", "Research"]);
    expect(captionOf(s, move(id(s, "Research"), "end"))).toBe("Research moved to the end");
  });

  it("drops a task in a board lane through the status table", () => {
    const s = demo();
    const dev = id(s, "Development");
    // Already after UI Design: only the lane changes
    const lane = apply(s, move(dev, { after: id(s, "UI Design") }, "active"));
    expectInverse(lane.before, expectApplied(lane.result));
    expect(after(lane).tasks[dev]).toMatchObject({ status: "active", progress: 0, order: project(s).tasks[dev].order });
    expect(captionOf(s, move(dev, { after: id(s, "UI Design") }, "active"))).toBe("Development → In progress");
    const both = apply(s, move(dev, "start", "done"));
    expect(after(both).tasks[dev]).toMatchObject({ status: "done", progress: 100, completedAt: FIXTURE_NOW });
    expect(captionOf(s, move(dev, "start", "review"))).toBe("Development → In review · moved to the start");
  });

  it("starts a project still in planning when a task lands In progress", () => {
    const s = edited(demo(), (p) => ({ ...p, status: "planning" }));
    expect(after(apply(s, move(id(s, "Development"), "end", "active"))).status).toBe("active");
  });

  it("is a no-op, by reference, when the task is already there", () => {
    const s = demo();
    const op = move(id(s, "UI Design"), { after: id(s, "Visual Direction") });
    const r = apply(s, op);
    expectNoop(r.result, r.before);
    expect(REGISTRY.get("moveTask")!.idempotent).toBe(true);
    expect(captionOf(s, op)).toBe("UI Design is already after Visual Direction");
    expect(captionOf(s, move(id(s, "Research"), "start"))).toBe("Research is already first");
    expect(captionOf(s, move(id(s, "Development"), "end", "todo"))).toBe("Development is already last");
    // The same move twice: the second is a no-op
    const moved = move(id(s, "Development"), { after: id(s, "Research") }, "active");
    const once = withDoc(s, after(apply(s, moved)));
    const again = apply(once, moved);
    expectNoop(again.result, again.before);
  });

  it("refuses a missing task, a missing anchor, itself as the anchor and a milestone In progress", () => {
    const s = demo();
    expectRejection(apply(s, move(mint("task"), "start")).result, "not_found");
    const anchor = expectRejection(apply(s, move(id(s, "UI Design"), { after: mint("task") })).result, "not_found");
    expect(anchor.message).toBe("The task it should follow isn't in this project anymore.");
    expectRejection(apply(s, move(id(s, "UI Design"), { after: id(s, "UI Design") })).result, "invalid_payload");
    expectRejection(apply(s, move(id(s, "UI Design"), "middle")).result, "invalid_payload");
    const ms = editTask(s, "Development", (t) => ({ ...t, kind: "milestone", estimateDays: 0 }));
    const r = expectRejection(apply(ms, move(id(s, "Development"), "start", "active")).result, "invalid_state");
    expect(r.message).toBe("Development is a milestone: it's either to do or done.");
  });

  it("grows keys at one spot until the runner rebalances them, in the same commit and order", () => {
    let s = demo();
    const research = id(s, "Research");
    let rebalanced = false;
    let moves = 0;
    while (!rebalanced && moves < 1000) {
      const mover = id(s, moves % 2 === 0 ? "Development" : "UI Design");
      const r = run(s, [move(mover, { after: research })]);
      moves++;
      const results = r.commits[0].result.results;
      const p = r.state.projects[s.projectId!];
      if ((results.at(-1)?.op as { op: string }).op === "rebalanceOrder") {
        rebalanced = true;
        expect(results).toHaveLength(2);
        expect(results.every((x) => x.kind === "applied")).toBe(true);
        expect(sortedByOrder(p.tasks).map((t) => t.order)).toEqual(nKeys(4));
        expect(r.caption?.text).toBe(`${mover === id(s, "UI Design") ? "UI Design" : "Development"} moved after Research`);
      } else {
        expect(longestOrderKey(p)).toBeLessThanOrEqual(ORDER_KEY_REBALANCE);
      }
      s = deepFreeze({ ...s, projects: r.state.projects as TestState["projects"] });
    }
    expect(rebalanced).toBe(true);
    expect(moves).toBeGreaterThan(100);
    expect(order(project(s))[0]).toBe("Research");
  });
});

/* ------------------------------------------------------------------
   removeDependency
   ------------------------------------------------------------------ */

describe("removeDependency", () => {
  const undep = (taskId: TaskId, dependsOnId: TaskId) => ({ op: "removeDependency", taskId, dependsOnId });

  it("stops a task waiting on another", () => {
    const s = demo();
    const op = undep(id(s, "Development"), id(s, "UI Design"));
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).tasks[id(s, "Development")].dependsOn).toEqual([]);
    expect(captionOf(s, op)).toBe("Development no longer waits on UI Design");
  });

  it("is a no-op when the dependency isn't there", () => {
    const s = demo();
    const op = undep(id(s, "Development"), id(s, "Research"));
    const r = apply(s, op);
    expectNoop(r.result, r.before);
    expect(captionOf(s, op)).toBe("Development doesn't wait on Research");
    const once = withDoc(s, after(apply(s, undep(id(s, "Development"), id(s, "UI Design")))));
    const again = apply(once, undep(id(s, "Development"), id(s, "UI Design")));
    expectNoop(again.result, again.before);
  });

  it("refuses missing tasks", () => {
    const s = demo();
    expectRejection(apply(s, undep(mint("task"), id(s, "UI Design"))).result, "not_found");
    expectRejection(apply(s, undep(id(s, "Development"), mint("task"))).result, "not_found");
    expectRejection(apply(s, { op: "removeDependency", taskId: id(s, "Development") }).result, "invalid_payload");
  });
});

/* ------------------------------------------------------------------
   pinStart and unpinStart
   ------------------------------------------------------------------ */

describe("pinStart", () => {
  const pin = (taskId: TaskId, date: string) => ({ op: "pinStart", taskId, date });

  it("pins a task's start", () => {
    const s = demo();
    const op = pin(id(s, "UI Design"), "2026-10-12");
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).tasks[id(s, "UI Design")].pinnedStart).toBe("2026-10-12");
    expect(captionOf(s, op)).toBe("UI Design starts 12 Oct");
  });

  it("is a no-op on the same day, and the later pin of one command speaks", () => {
    const s = demo();
    const op = pin(id(s, "UI Design"), "2026-10-12");
    const once = withDoc(s, after(apply(s, op)));
    const again = apply(once, op);
    expectNoop(again.result, again.before);
    expect(captionOf(once, op)).toBe("UI Design already starts 12 Oct");
    expect(run(s, [op, pin(id(s, "UI Design"), "2026-10-19")]).caption?.text).toBe("UI Design starts 19 Oct");
  });

  it("refuses a missing task and an impossible date", () => {
    const s = demo();
    expectRejection(apply(s, pin(mint("task"), "2026-10-12")).result, "not_found");
    expectRejection(apply(s, pin(id(s, "UI Design"), "2026-02-30")).result, "invalid_payload");
  });
});

describe("unpinStart", () => {
  const unpin = (taskId: TaskId) => ({ op: "unpinStart", taskId });
  const pinned = (s: TestState, title: string) => editTask(s, title, (t) => ({ ...t, pinnedStart: "2026-10-12" as Task["pinnedStart"] }));

  it("lets a task follow its dependencies again", () => {
    const s = pinned(demo(), "UI Design");
    const r = apply(s, unpin(id(s, "UI Design")));
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).tasks[id(s, "UI Design")].pinnedStart).toBeNull();
    expect(captionOf(s, unpin(id(s, "UI Design")))).toBe("UI Design follows its dependencies again");
    const first = pinned(demo(), "Research");
    expect(captionOf(first, unpin(id(s, "Research")))).toBe("Research starts with the project again");
  });

  it("is a no-op for a task with no pin", () => {
    const s = demo();
    const r = apply(s, unpin(id(s, "Development")));
    expectNoop(r.result, r.before);
    expect(captionOf(s, unpin(id(s, "Development")))).toBe("Development isn't pinned");
  });

  it("refuses a missing task", () => {
    expectRejection(apply(demo(), unpin(mint("task"))).result, "not_found");
  });
});

/* ------------------------------------------------------------------
   assignTask and unassignTask
   ------------------------------------------------------------------ */

describe("assignTask", () => {
  const assign = (taskId: TaskId, personId: PersonId) => ({ op: "assignTask", taskId, personId });

  it("gives a task to a person", () => {
    const s = demo();
    const op = assign(id(s, "Development"), DEMO_PEOPLE.sara);
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).tasks[id(s, "Development")].ownerId).toBe(DEMO_PEOPLE.sara);
    expect(after(r).memberIds).toEqual(project(s).memberIds);
    expect(captionOf(s, op)).toBe("Development → Sara");
  });

  it("brings the owner into the project", () => {
    const s = withGiulia();
    const p = after(apply(s, assign(id(s, "Development"), GIULIA)));
    expect(p.memberIds).toEqual([...project(s).memberIds, GIULIA]);
    expect(captionOf(s, assign(id(s, "Development"), GIULIA))).toBe("Development → Giulia");
  });

  it("adds the receiver's load when the planning engine answers, as v0 did", () => {
    const s = demo();
    const op = assign(id(s, "Development"), DEMO_PEOPLE.sara);
    expect(captionOf(s, op, lanes([{ personId: DEMO_PEOPLE.sara, days: 14, capacity: 20, over: 0 }]))).toBe("Development → Sara · Sara 14/20d");
    expect(captionOf(s, op, lanes([{ personId: DEMO_PEOPLE.sara, days: 22, capacity: 20, over: 2 }]))).toBe("Development → Sara · Sara is now 2d over");
    expect(captionOf(s, op, lanes([{ personId: DEMO_PEOPLE.sara, days: 6.5, capacity: null }]))).toBe("Development → Sara · Sara 6.5d");
  });

  it("is a no-op when the task is already theirs", () => {
    const s = demo();
    const op = assign(id(s, "Development"), DEMO_PEOPLE.luca);
    const r = apply(s, op);
    expectNoop(r.result, r.before);
    expect(captionOf(s, op)).toBe("Development is already with Luca");
  });

  it("refuses a missing task, a missing or archived person and a 101st member", () => {
    const s = demo();
    expectRejection(apply(s, assign(mint("task"), DEMO_PEOPLE.sara)).result, "not_found");
    const missing = expectRejection(apply(s, assign(id(s, "Development"), mint("person"))).result, "invalid_reference");
    expect(missing.message).toBe("That person isn't in the workspace.");
    const left = expectRejection(apply(lucaArchived(), assign(id(s, "UI Design"), DEMO_PEOPLE.luca)).result, "archived");
    expect(left.message).toBe("Luca has left the team.");
    const full = edited(withGiulia(), (p) => ({ ...p, memberIds: Array.from({ length: MEMBERS_MAX }, () => mint("person")) }));
    expectRejection(apply(full, assign(id(s, "Development"), GIULIA)).result, "limit");
    expectRejection(apply(s, { op: "assignTask", taskId: id(s, "Development"), personId: null }).result, "invalid_payload");
  });
});

describe("unassignTask", () => {
  const unassign = (taskId: TaskId) => ({ op: "unassignTask", taskId });

  it("takes the owner away and keeps them in the project", () => {
    const s = demo();
    const r = apply(s, unassign(id(s, "Visual Direction")));
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).tasks[id(s, "Visual Direction")].ownerId).toBeNull();
    expect(after(r).memberIds).toContain(DEMO_PEOPLE.marta);
    expect(captionOf(s, unassign(id(s, "Visual Direction")))).toBe("Visual Direction unassigned");
  });

  it("is a no-op for an unassigned task", () => {
    const s = demo();
    const once = withDoc(s, after(apply(s, unassign(id(s, "Visual Direction")))));
    const again = apply(once, unassign(id(s, "Visual Direction")));
    expectNoop(again.result, again.before);
    expect(captionOf(once, unassign(id(s, "Visual Direction")))).toBe("Visual Direction is already unassigned");
  });

  it("refuses a missing task", () => {
    expectRejection(apply(demo(), unassign(mint("task"))).result, "not_found");
  });
});

/* ------------------------------------------------------------------
   Steps
   ------------------------------------------------------------------ */

describe("addStep", () => {
  const add = (taskId: TaskId, o: Record<string, unknown> = {}) => ({
    op: "addStep",
    taskId,
    stepId: mint("step"),
    title: "QA pass",
    estimateDays: null,
    after: "end",
    ...o,
  });

  it("adds a step at the end of a task", () => {
    const s = demo();
    const op = add(id(s, "UI Design"), { estimateDays: 1.5 });
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).tasks[id(s, "UI Design")].steps).toEqual([{ id: op.stepId, title: "QA pass", done: false, ownerId: null, estimateDays: 1.5 }]);
    expect(captionOf(s, op)).toBe("Step added to UI Design");
  });

  it("places it first, after a step, or last when the anchor is gone", () => {
    const s = withSteps();
    const ui = id(s, "UI Design");
    expect(stepTitles(after(apply(s, add(ui, { title: "Brief", after: null }))), s)).toEqual(["Brief", "Wireframes", "QA pass", "Handoff"]);
    expect(stepTitles(after(apply(s, add(ui, { title: "Specs", after: STEP.wire }))), s)).toEqual(["Wireframes", "Specs", "QA pass", "Handoff"]);
    expect(stepTitles(after(apply(s, add(ui, { title: "Review", after: mint("step") }))), s)).toEqual(["Wireframes", "QA pass", "Handoff", "Review"]);
  });

  it("refuses a taken id, never re-minting it (not idempotent)", () => {
    const s = withSteps();
    expect(REGISTRY.get("addStep")!.idempotent).toBe(false);
    expectRejection(apply(s, add(id(s, "Research"), { stepId: STEP.qa })).result, "duplicate_id");
    // A step the pending proposal would create is taken too
    const proposal = deepFreeze(namedFixture("demoProposal"));
    const proposed = project(proposal).proposal!;
    const taken = proposed.kind === "subtasks" ? proposed.items[0].stepId : null;
    expectRejection(apply(proposal, add(id(proposal, "Research"), { stepId: taken })).result, "duplicate_id");
  });

  it("refuses a missing task, a milestone, a 41st step and an invalid step", () => {
    const s = demo();
    expectRejection(apply(s, add(mint("task"))).result, "not_found");
    const ms = editTask(s, "Development", (t) => ({ ...t, kind: "milestone", estimateDays: 0 }));
    const r = expectRejection(apply(ms, add(id(s, "Development"))).result, "invalid_state");
    expect(r.message).toBe("Development is a milestone: it has no steps.");
    const full = editTask(s, "UI Design", (t) => ({ ...t, steps: Array.from({ length: STEPS_MAX }, (_, i) => step(mint("step"), `Step ${i + 1}`)) }));
    expectRejection(apply(full, add(id(s, "UI Design"))).result, "limit");
    expectRejection(apply(s, add(id(s, "UI Design"), { title: " QA pass" })).result, "invalid_payload");
    expectRejection(apply(s, add(id(s, "UI Design"), { estimateDays: 0 })).result, "invalid_payload");
  });
});

describe("updateStep", () => {
  const update = (stepId: StepId, field: string, value: unknown, s: TestState) => ({
    op: "updateStep",
    taskId: id(s, "UI Design"),
    stepId,
    field,
    value,
  });

  it("ticks a step without touching its task", () => {
    const s = withSteps();
    const op = update(STEP.qa, "done", true, s);
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    const ui = after(r).tasks[id(s, "UI Design")];
    expect(ui.steps[1].done).toBe(true);
    expect(ui).toMatchObject({ status: "active", progress: 30 });
    expect(captionOf(s, op)).toBe("QA pass done");
  });

  it("captions each field", () => {
    const s = withSteps();
    expect(captionOf(s, update(STEP.wire, "done", false, s))).toBe("Wireframes reopened");
    expect(captionOf(s, update(STEP.qa, "title", "Visual QA", s))).toBe("Step renamed to Visual QA");
    expect(captionOf(s, update(STEP.qa, "ownerId", DEMO_PEOPLE.sara, s))).toBe("QA pass → Sara");
    expect(captionOf(s, update(STEP.qa, "estimateDays", 1.5, s))).toBe("QA pass · 1.5d");
    expect(captionOf(s, update(STEP.wire, "estimateDays", null, s))).toBe("Wireframes · estimate cleared");
    const owned = withDoc(s, after(apply(s, update(STEP.qa, "ownerId", DEMO_PEOPLE.sara, s))));
    expect(captionOf(owned, update(STEP.qa, "ownerId", null, s))).toBe("QA pass unassigned");
  });

  it("brings a step's owner into the project", () => {
    const s = withSteps(withGiulia());
    const p = after(apply(s, update(STEP.qa, "ownerId", GIULIA, s)));
    expect(p.tasks[id(s, "UI Design")].steps[1].ownerId).toBe(GIULIA);
    expect(p.memberIds).toContain(GIULIA);
  });

  it("is a no-op, by reference, when the field already has the value", () => {
    const s = withSteps();
    const cases: [StepId, string, unknown, string][] = [
      [STEP.wire, "done", true, "Wireframes is already done"],
      [STEP.qa, "done", false, "QA pass isn't done yet"],
      [STEP.qa, "title", "QA pass", "It's already called QA pass"],
      [STEP.qa, "ownerId", null, "QA pass is already unassigned"],
      [STEP.qa, "estimateDays", null, "QA pass has no estimate yet"],
      [STEP.wire, "estimateDays", 1, "Wireframes is already estimated at 1d"],
    ];
    for (const [stepId, field, value, text] of cases) {
      const r = apply(s, update(stepId, field, value, s));
      expectNoop(r.result, r.before);
      expect(captionOf(s, update(stepId, field, value, s))).toBe(text);
    }
    const owned = withDoc(s, after(apply(s, update(STEP.qa, "ownerId", DEMO_PEOPLE.sara, s))));
    expect(captionOf(owned, update(STEP.qa, "ownerId", DEMO_PEOPLE.sara, s))).toBe("QA pass is already with Sara");
  });

  it("refuses a missing task or step, a missing or archived owner and invalid values", () => {
    const s = withSteps();
    expectRejection(apply(s, { ...update(STEP.qa, "done", true, s), taskId: mint("task") }).result, "not_found");
    const gone = expectRejection(apply(s, update(mint("step"), "done", true, s)).result, "not_found");
    expect(gone.message).toBe("That step isn't in UI Design anymore.");
    expectRejection(apply(s, update(STEP.qa, "ownerId", mint("person"), s)).result, "invalid_reference");
    expectRejection(apply(withSteps(lucaArchived()), update(STEP.qa, "ownerId", DEMO_PEOPLE.luca, s)).result, "archived");
    expectRejection(apply(s, update(STEP.qa, "estimateDays", 0, s)).result, "invalid_payload");
    expectRejection(apply(s, update(STEP.qa, "status", "done", s)).result, "invalid_payload");
  });
});

describe("removeStep", () => {
  const remove = (s: TestState, stepId: StepId) => ({ op: "removeStep", taskId: id(s, "UI Design"), stepId });

  it("removes a step and the brief edits keyed to it, all undoable", () => {
    const s = edited(withSteps(), (p) => ({
      ...p,
      brief: {
        ...p.brief,
        edits: {
          [`team:moving:${STEP.qa}`]: { text: "QA is on.", basis: "QA pass is in progress." },
          "client:head:status": { text: "All good.", basis: "On track." },
        },
      },
    }));
    const r = apply(s, remove(s, STEP.qa));
    expectInverse(r.before, expectApplied(r.result));
    expect(stepTitles(after(r), s)).toEqual(["Wireframes", "Handoff"]);
    expect(Object.keys(after(r).brief.edits)).toEqual(["client:head:status"]);
    expect(captionOf(s, remove(s, STEP.qa))).toBe("QA pass removed");
  });

  it("refuses a missing step or task (not idempotent)", () => {
    const s = withSteps();
    expect(REGISTRY.get("removeStep")!.idempotent).toBe(false);
    const once = withDoc(s, after(apply(s, remove(s, STEP.qa))));
    expectRejection(apply(once, remove(s, STEP.qa)).result, "not_found");
    expectRejection(apply(s, { ...remove(s, STEP.qa), taskId: mint("task") }).result, "not_found");
  });
});

describe("reorderStep", () => {
  const reorder = (s: TestState, stepId: StepId, afterId: StepId | null) => ({ op: "reorderStep", taskId: id(s, "UI Design"), stepId, after: afterId });

  it("moves a step first or after another", () => {
    const s = withSteps();
    const r = apply(s, reorder(s, STEP.handoff, null));
    expectInverse(r.before, expectApplied(r.result));
    expect(stepTitles(after(r), s)).toEqual(["Handoff", "Wireframes", "QA pass"]);
    expect(stepTitles(after(apply(s, reorder(s, STEP.wire, STEP.handoff))), s)).toEqual(["QA pass", "Handoff", "Wireframes"]);
    expect(stepTitles(after(apply(s, reorder(s, STEP.handoff, STEP.wire))), s)).toEqual(["Wireframes", "Handoff", "QA pass"]);
    expect(captionOf(s, reorder(s, STEP.handoff, null))).toBe("Handoff moved");
  });

  it("is a no-op when the step is already there", () => {
    const s = withSteps();
    for (const [stepId, afterId] of [
      [STEP.qa, STEP.wire],
      [STEP.wire, null],
    ] as const) {
      const r = apply(s, reorder(s, stepId, afterId));
      expectNoop(r.result, r.before);
    }
    expect(captionOf(s, reorder(s, STEP.qa, STEP.wire))).toBe("QA pass is already there");
  });

  it("refuses a missing step, task or anchor, and itself as the anchor", () => {
    const s = withSteps();
    expectRejection(apply(s, reorder(s, mint("step"), null)).result, "not_found");
    expectRejection(apply(s, reorder(s, STEP.qa, mint("step"))).result, "not_found");
    expectRejection(apply(s, { ...reorder(s, STEP.qa, null), taskId: mint("task") }).result, "not_found");
    expectRejection(apply(s, reorder(s, STEP.qa, STEP.qa)).result, "invalid_payload");
  });
});

/* ------------------------------------------------------------------
   Links
   ------------------------------------------------------------------ */

const link = (o: Record<string, unknown> = {}) => ({ id: mint("link"), label: "Figma", url: "https://www.figma.com/file/form", ...o });

describe("addLink", () => {
  const add = (target: unknown, l = link()) => ({ op: "addLink", target, link: l });

  it("adds a link to the project or to a task", () => {
    const s = demo();
    const op = add({ kind: "project" });
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).links).toEqual([op.link]);
    expect(captionOf(s, op)).toBe("Link added · Figma");
    const onTask = add({ kind: "task", taskId: id(s, "UI Design") }, link({ label: "Prototype" }));
    expect(after(apply(s, onTask)).tasks[id(s, "UI Design")].links).toEqual([onTask.link]);
    expect(captionOf(s, onTask)).toBe("Link added to UI Design · Prototype");
  });

  it("refuses a taken id (not idempotent), a missing task, a 21st link and an unsafe URL", () => {
    const s = demo();
    const op = add({ kind: "project" });
    const once = withDoc(s, after(apply(s, op)));
    expect(REGISTRY.get("addLink")!.idempotent).toBe(false);
    expectRejection(apply(once, add({ kind: "task", taskId: id(s, "UI Design") }, op.link)).result, "duplicate_id");
    expectRejection(apply(s, add({ kind: "task", taskId: mint("task") })).result, "not_found");
    const full = edited(s, (p) => ({ ...p, links: Array.from({ length: LINKS_MAX }, () => link()) }));
    const r = expectRejection(apply(full, add({ kind: "project" })).result, "limit");
    expect(r.message).toBe("The project already has 20 links.");
    expectRejection(apply(s, add({ kind: "project" }, link({ url: "javascript:alert(1)" }))).result, "invalid_payload");
  });
});

describe("removeLink", () => {
  const PROJECT_LINK = mint("link");
  const TASK_LINK = mint("link");
  const linked = () =>
    editTask(
      edited(demo(), (p) => ({ ...p, links: [link({ id: PROJECT_LINK, label: "Brief" })] })),
      "UI Design",
      (t) => ({ ...t, links: [link({ id: TASK_LINK })] }),
    );
  const remove = (target: unknown, linkId: LinkId) => ({ op: "removeLink", target, linkId });

  it("removes a link from the project or a task", () => {
    const s = linked();
    const r = apply(s, remove({ kind: "project" }, PROJECT_LINK));
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).links).toEqual([]);
    expect(captionOf(s, remove({ kind: "project" }, PROJECT_LINK))).toBe("Link removed");
    const onTask = remove({ kind: "task", taskId: id(s, "UI Design") }, TASK_LINK);
    expect(after(apply(s, onTask)).tasks[id(s, "UI Design")].links).toEqual([]);
  });

  it("refuses a missing link or task (not idempotent)", () => {
    const s = linked();
    expect(REGISTRY.get("removeLink")!.idempotent).toBe(false);
    // The task's link isn't on the project
    const r = expectRejection(apply(s, remove({ kind: "project" }, TASK_LINK)).result, "not_found");
    expect(r.message).toBe("That link isn't there anymore.");
    expectRejection(apply(s, remove({ kind: "task", taskId: mint("task") }, TASK_LINK)).result, "not_found");
    expectRejection(apply(s, remove({ kind: "board" }, TASK_LINK)).result, "invalid_payload");
  });
});

/* ------------------------------------------------------------------
   Members
   ------------------------------------------------------------------ */

describe("addMember", () => {
  const add = (personId: PersonId) => ({ op: "addMember", personId });

  it("adds a person to the project's members", () => {
    const s = withGiulia();
    const r = apply(s, add(GIULIA));
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).memberIds).toEqual([...project(s).memberIds, GIULIA]);
    expect(captionOf(s, add(GIULIA))).toBe("Giulia joins the project");
  });

  it("refuses a person the workspace doesn't know, like an owner (Q7)", () => {
    const s = demo();
    const r = expectRejection(apply(s, add(mint("person"))).result, "invalid_reference");
    expect(r.message).toBe("That person isn't in the workspace.");
  });

  it("is a no-op for a member, even one the workspace no longer knows", () => {
    const s = demo();
    const r = apply(s, add(DEMO_PEOPLE.sara));
    expectNoop(r.result, r.before);
    expect(captionOf(s, add(DEMO_PEOPLE.sara))).toBe("Sara is already in the project");
    // deletePerson never edits project documents, so a deleted member stays a reference (read as missing)
    const people = Object.fromEntries(Object.entries(s.workspace.people).filter(([key]) => key !== DEMO_PEOPLE.sara));
    const gone: TestState = deepFreeze({ ...s, workspace: { ...s.workspace, people } });
    const again = apply(gone, add(DEMO_PEOPLE.sara));
    expectNoop(again.result, again.before);
  });

  it("refuses an archived person and a 101st member", () => {
    const s = edited(lucaArchived(), (p) => ({ ...p, memberIds: p.memberIds.filter((m) => m !== DEMO_PEOPLE.luca) }));
    const r = expectRejection(apply(s, add(DEMO_PEOPLE.luca)).result, "archived");
    expect(r.message).toBe("Luca has left the team.");
    const full = edited(withGiulia(), (p) => ({ ...p, memberIds: Array.from({ length: MEMBERS_MAX }, () => mint("person")) }));
    expectRejection(apply(full, add(GIULIA)).result, "limit");
  });
});

describe("removeMember", () => {
  const remove = (personId: PersonId) => ({ op: "removeMember", personId });

  it("takes a person out and unassigns their work here", () => {
    const s = demo();
    const r = apply(s, remove(DEMO_PEOPLE.luca));
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).memberIds).toEqual([DEMO_PEOPLE.marta, DEMO_PEOPLE.sara]);
    expect(after(r).tasks[id(s, "Development")].ownerId).toBeNull();
    expect(captionOf(s, remove(DEMO_PEOPLE.luca))).toBe("Luca leaves the project · 1 task unassigned");
  });

  it("names the steps it unassigns and the lead it clears", () => {
    const s = edited(withSteps(), (p) => {
      const ui = taskByTitle(p, "UI Design");
      const steps = ui.steps.map((x) => (x.id === STEP.qa ? { ...x, ownerId: DEMO_PEOPLE.marta } : x));
      return { ...p, leadId: DEMO_PEOPLE.marta, tasks: { ...p.tasks, [ui.id]: { ...ui, steps } } };
    });
    const r = apply(s, remove(DEMO_PEOPLE.marta));
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r)).toMatchObject({ leadId: null, memberIds: [DEMO_PEOPLE.sara, DEMO_PEOPLE.luca] });
    expect(after(r).tasks[id(s, "UI Design")]).toMatchObject({ ownerId: null });
    expect(after(r).tasks[id(s, "UI Design")].steps[1].ownerId).toBeNull();
    expect(captionOf(s, remove(DEMO_PEOPLE.marta))).toBe("Marta leaves the project · 2 tasks and 1 step unassigned · No lead now");
  });

  it("is a no-op for someone who isn't in the project", () => {
    const s = withGiulia();
    const r = apply(s, remove(GIULIA));
    expectNoop(r.result, r.before);
    expect(captionOf(s, remove(GIULIA))).toBe("Giulia isn't in the project");
    const once = withDoc(s, after(apply(s, remove(DEMO_PEOPLE.luca))));
    const again = apply(once, remove(DEMO_PEOPLE.luca));
    expectNoop(again.result, again.before);
  });

  it("refuses an invalid person id", () => {
    expectRejection(apply(demo(), { op: "removeMember", personId: "luca" }).result, "invalid_payload");
  });
});

/* ------------------------------------------------------------------
   updateProject
   ------------------------------------------------------------------ */

describe("updateProject", () => {
  const update = (field: string, value: unknown) => ({ op: "updateProject", field, value });

  it("renames the project", () => {
    const s = demo();
    const r = apply(s, update("title", "Studio site"));
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).title).toBe("Studio site");
    expect(captionOf(s, update("title", "Studio site"))).toBe("Renamed to Studio site");
    expect(REGISTRY.get("updateProject")!.deprecates).toEqual(["renameTool", "setStartDate"]);
  });

  it("sets and confirms the start: v0 setStartDate reads once", () => {
    const s = demo();
    expect(captionOf(s, update("startDate", "2026-09-21"))).toBe("Start · 21 Sep");
    const both = run(s, [update("startDate", "2026-09-21"), update("startConfirmed", true)]);
    expect(both.caption?.text).toBe("Start · 21 Sep · confirmed");
    expect(both.state.projects[s.projectId!]).toMatchObject({ startDate: "2026-09-21", startConfirmed: true });
    expect(captionOf(s, update("startDate", null))).toBe("Start date cleared");
  });

  it("turns the review step off: tasks In review at 100% become Done, named in the caption", () => {
    const review = (t: Task): Task => ({ ...t, status: "review", progress: 100 });
    const one = editTask(edited(demo(), (p) => ({ ...p, requireReview: true })), "Visual Direction", review);
    const r = apply(one, update("requireReview", false));
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).tasks[id(one, "Visual Direction")]).toMatchObject({ status: "done", progress: 100, completedAt: FIXTURE_NOW });
    expect(captionOf(one, update("requireReview", false))).toBe("Review step off · Visual Direction → Done");
    const two = editTask(one, "UI Design", review);
    expect(captionOf(two, update("requireReview", false))).toBe("Review step off · 2 tasks → Done");
    expect(captionOf(demo(), update("requireReview", true))).toBe("Review step on");
    const on = edited(demo(), (p) => ({ ...p, requireReview: true }));
    expect(captionOf(on, update("requireReview", false))).toBe("Review step off");
  });

  it("captions every other field", () => {
    const s = withGiulia();
    expect(captionOf(s, update("client", { name: "Acme", contactName: null, contactEmail: null }))).toBe("Client · Acme");
    expect(captionOf(s, update("client", { name: null, contactName: null, contactEmail: "pm@acme.com" }))).toBe("Client details updated");
    expect(captionOf(s, update("kind", "brand-identity"))).toBe("Project type · Brand identity");
    expect(captionOf(s, update("goal", "Launch before the fair."))).toBe("Goal updated");
    expect(captionOf(s, update("status", "on-hold"))).toBe("Project · On hold");
    expect(captionOf(s, update("startConfirmed", true))).toBe("Start · 28 Sep · confirmed");
    expect(captionOf(s, update("deadline", "2026-11-30"))).toBe("Deadline · 30 Nov");
    expect(captionOf(s, update("deadlineKind", "hard"))).toBe("Hard deadline");
    expect(captionOf(s, update("currency", "USD"))).toBe("Currency · USD");
    expect(captionOf(s, update("budgetCents", 1_200_000))).toBe("Budget · €12,000");
    expect(captionOf(s, update("autoChain", false))).toBe("New tasks start unlinked");
    expect(captionOf(s, update("tags", ["web", "client", "web"]))).toBe("Project tagged web, client");
    const lead = apply(s, update("leadId", GIULIA));
    expect(after(lead)).toMatchObject({ leadId: GIULIA, memberIds: [...project(s).memberIds, GIULIA] });
    expect(captionOf(s, update("leadId", GIULIA))).toBe("Lead · Giulia");
    const led = withDoc(s, after(lead));
    expect(captionOf(led, update("leadId", null))).toBe("No lead");
    const withClient = withDoc(s, after(apply(s, update("client", { name: "Acme", contactName: null, contactEmail: null }))));
    expect(captionOf(withClient, update("client", null))).toBe("Client removed");
    const withGoal = withDoc(s, after(apply(s, update("goal", "Launch."))));
    expect(captionOf(withGoal, update("goal", null))).toBe("Goal cleared");
  });

  it("keeps the calendar override sorted, filed by id, and null when it overrides nothing", () => {
    const s = demo();
    const r = apply(s, update("calendarOverride", { workingDays: [5, 1, 2, 2, 3, 4], closures: null }));
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).calendarOverride).toEqual({ workingDays: [1, 2, 3, 4, 5], closures: null });
    expect(captionOf(s, update("calendarOverride", { workingDays: [5, 1, 2, 2, 3, 4], closures: null }))).toBe("Working days · Mon–Fri");
    const again = apply(withDoc(s, after(r)), update("calendarOverride", { workingDays: [1, 2, 3, 4, 5], closures: null }));
    expectNoop(again.result, again.before);

    const closure = mint("closure");
    const short = update("calendarOverride", {
      workingDays: [1, 3, 5],
      closures: { [closure]: { id: closure, from: "2026-12-24", to: "2027-01-06", label: "Holidays" } },
    });
    expect(captionOf(s, short)).toBe("Working days · Mon, Wed, Fri · 1 closure");
    expect(captionOf(s, update("calendarOverride", { workingDays: [1, 2, 3, 4, 6], closures: {} }))).toBe("Working days · Mon–Thu, Sat · no closures");
    const nothing = apply(s, update("calendarOverride", { workingDays: null, closures: null }));
    expectNoop(nothing.result, nothing.before);
    expect(captionOf(s, update("calendarOverride", null))).toBe("The working days already follow the workspace");
    const overridden = withDoc(s, after(apply(s, short)));
    expect(captionOf(overridden, update("calendarOverride", { workingDays: null, closures: null }))).toBe("Working days · same as workspace");
  });

  it("is a no-op, by reference, when the field already has the value", () => {
    const s = demo();
    const cases: [string, unknown, string][] = [
      ["title", "New website", "It's already called New website"],
      ["client", null, "The project has no client"],
      ["kind", "website", "The project type is already Website"],
      ["goal", null, "The project has no goal yet"],
      ["status", "active", "The project status is already Active"],
      ["startDate", "2026-09-28", "The project already starts 28 Sep"],
      ["startConfirmed", false, "The start isn't confirmed"],
      ["deadline", null, "The project has no deadline"],
      ["deadlineKind", "soft", "The deadline is already soft"],
      ["currency", "EUR", "The project is already in EUR"],
      ["budgetCents", null, "The project has no budget"],
      ["leadId", null, "The project has no lead"],
      ["requireReview", false, "The review step is already off"],
      ["autoChain", true, "New tasks already follow the last one"],
      ["tags", [], "The project's tags are unchanged"],
    ];
    for (const [field, value, text] of cases) {
      const r = apply(s, update(field, value));
      expectNoop(r.result, r.before);
      expect(captionOf(s, update(field, value)), field).toBe(text);
    }
  });

  it("refuses a start after the deadline, a missing or archived lead and an invalid calendar", () => {
    const s = edited(demo(), (p) => ({ ...p, deadline: "2026-10-30" as ProjectDoc["deadline"] }));
    const late = expectRejection(apply(s, update("startDate", "2026-11-02")).result, "invalid_state");
    expect(late.message).toBe("The start can't be after the deadline (30 Oct).");
    const early = expectRejection(apply(s, update("deadline", "2026-09-01")).result, "invalid_state");
    expect(early.message).toBe("The deadline can't be before the start (28 Sep).");
    expectRejection(apply(s, update("leadId", mint("person"))).result, "invalid_reference");
    expectRejection(apply(lucaArchived(), update("leadId", DEMO_PEOPLE.luca)).result, "archived");
    const [a, b] = [mint("closure"), mint("closure")];
    const misfiled = { [a]: { id: b, from: "2026-12-24", to: "2026-12-26", label: "Holidays" } };
    expectRejection(apply(s, update("calendarOverride", { workingDays: null, closures: misfiled })).result, "invalid_payload");
    const backwards = { [a]: { id: a, from: "2026-12-26", to: "2026-12-24", label: "Holidays" } };
    expectRejection(apply(s, update("calendarOverride", { workingDays: null, closures: backwards })).result, "invalid_payload");
    const many = Object.fromEntries(
      Array.from({ length: 201 }, () => mint("closure")).map((c) => [c, { id: c, from: "2026-12-24", to: "2026-12-24", label: "Closed" }]),
    ) as Record<ClosureId, unknown>;
    expectRejection(apply(s, update("calendarOverride", { workingDays: null, closures: many })).result, "limit");
    expectRejection(apply(s, update("title", "x".repeat(81))).result, "invalid_payload");
    expectRejection(apply(s, update("archived", true)).result, "invalid_payload");
  });
});

/* ------------------------------------------------------------------
   rebalanceOrder
   ------------------------------------------------------------------ */

describe("rebalanceOrder", () => {
  const keysFor = (p: ProjectDoc, keys: readonly string[]) => Object.fromEntries(sortedByOrder(p.tasks).map((t, i) => [t.id, keys[i]]));
  const rebalance = (keys: Record<string, string>) => ({ op: "rebalanceOrder", keys });

  it("re-keys every task in workflow order, silently and hidden from Activity", () => {
    const s = demo();
    const op = rebalance(keysFor(project(s), nKeys(5).slice(1)));
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(sortedByOrder(after(r).tasks).map((t) => t.order)).toEqual(["a1", "a2", "a3", "a4"]);
    expect(order(after(r))).toEqual(order(project(s)));
    expect(REGISTRY.get("rebalanceOrder")!.activity).toBe("hide");
    expect(captionOf(s, op)).toBeNull();
  });

  it("is a no-op when every key is already there", () => {
    const s = demo();
    const r = apply(s, rebalance(keysFor(project(s), nKeys(4))));
    expectNoop(r.result, r.before);
    expect(captionOf(s, rebalance(keysFor(project(s), nKeys(4))))).toBeNull();
  });

  it("only re-keys: every task once, unique keys, the same order", () => {
    const s = demo();
    const p = project(s);
    const extra = { ...keysFor(p, nKeys(4)), [mint("task")]: "a9" };
    expectRejection(apply(s, rebalance(extra)).result, "not_found");
    const missing = keysFor(p, nKeys(4));
    delete missing[id(s, "Development")];
    expectRejection(apply(s, rebalance(missing)).result, "invalid_payload");
    expectRejection(apply(s, rebalance(keysFor(p, ["a1", "a1", "a2", "a3"]))).result, "invalid_payload");
    const r = expectRejection(apply(s, rebalance(keysFor(p, [...nKeys(4)].reverse()))).result, "invalid_state");
    expect(r.message).toBe("Re-keying must keep the workflow order.");
    expectRejection(apply(s, rebalance(keysFor(p, ["a0", "a1", "a2", "a30"]))).result, "invalid_payload");
  });

  // The reducer suite draws it among all 66; here it always follows a few generated moves that
  // lengthen keys, from the property fixtures.
  it("holds the reducer properties over generated payloads", () => {
    const seen = { applied: 0, noop: 0, rejected: 0 };
    fc.assert(
      fc.property(fc.constantFrom(...PROPERTY_FIXTURES), fc.array(stepArb, { minLength: 1, maxLength: 8 }), (fixture, steps) => {
        const m = seededMinter(steps.length);
        let state: GenState = startState(fixture, false);
        for (const s of steps.slice(1)) {
          const raw = GENERATORS.moveTask({ ...s, op: "moveTask" }, state, m);
          const p = state.projectId ? state.projects[state.projectId] : null;
          if (!p) break;
          const moved = applyOp(p, raw, reduceCtx({ ...state, projectId: state.projectId }));
          if (moved.kind === "applied") state = { ...state, projects: { ...state.projects, [p.id]: moved.doc } };
        }
        if (state.projectId === null) return;
        const before = state.projects[state.projectId];
        const raw = deepFreeze(rebalancePayload(steps[0], state, m));
        const result = applyOp(before, raw, reduceCtx({ ...state, projectId: state.projectId }));
        seen[result.kind]++;
        if (result.kind !== "applied") {
          expect(result.doc).toBe(before);
          if (result.kind === "rejected") expect(result.rejection.code).not.toBe("invalid_result");
          return;
        }
        expect(ProjectDocSchema.safeParse(result.doc).success).toBe(true);
        expect(checkProject(result.doc)).toEqual([]);
        expectInverse(before, result);
        expect(sortedByOrder(result.doc.tasks).map((t) => t.id)).toEqual(sortedByOrder(before.tasks).map((t) => t.id));
        expect(applyOp(result.doc, raw, reduceCtx({ ...state, projectId: state.projectId })).kind).toBe("noop");
        const reversed = JSON.parse(JSON.stringify(before)) as ProjectDoc;
        const shuffled = { ...reversed, tasks: Object.fromEntries(Object.entries(reversed.tasks).reverse()) };
        expect(applyOp(shuffled, raw, reduceCtx({ ...state, projectId: state.projectId })).doc).toEqual(result.doc);
      }),
      { numRuns: 300 },
    );
    expect(seen.applied).toBeGreaterThan(0);
    expect(seen.noop).toBeGreaterThan(0);
    expect(seen.rejected).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------
   Determinism across the family
   ------------------------------------------------------------------ */

describe("the 10a ops", () => {
  it("never depend on record key order", () => {
    const s = withSteps(withGiulia());
    const reversed = edited(s, (p) => ({ ...p, tasks: Object.fromEntries(Object.entries(p.tasks).reverse()) }));
    const ui = id(s, "UI Design");
    const ops = [
      { op: "moveTask", taskId: id(s, "Development"), place: { after: id(s, "Research") }, status: "active" },
      { op: "removeDependency", taskId: id(s, "Development"), dependsOnId: ui },
      { op: "pinStart", taskId: ui, date: "2026-10-12" },
      { op: "assignTask", taskId: id(s, "Development"), personId: GIULIA },
      { op: "unassignTask", taskId: ui },
      { op: "addStep", taskId: ui, stepId: mint("step"), title: "Specs", estimateDays: 1, after: STEP.wire },
      { op: "updateStep", taskId: ui, stepId: STEP.qa, field: "ownerId", value: GIULIA },
      { op: "removeStep", taskId: ui, stepId: STEP.qa },
      { op: "reorderStep", taskId: ui, stepId: STEP.handoff, after: null },
      { op: "addLink", target: { kind: "task", taskId: ui }, link: link() },
      { op: "addMember", personId: GIULIA },
      { op: "removeMember", personId: DEMO_PEOPLE.marta },
      { op: "updateProject", field: "requireReview", value: true },
      { op: "rebalanceOrder", keys: Object.fromEntries(sortedByOrder(project(s).tasks).map((t, i) => [t.id, nKeys(5)[i + 1]])) },
    ];
    for (const op of ops) {
      const a = apply(s, op).result;
      const b = apply(reversed, op).result;
      expect(a.kind, op.op).toBe("applied");
      expect(b.doc).toEqual(a.doc);
      if (a.kind === "applied" && b.kind === "applied") {
        const sorted = (patches: typeof a.patches) => patches.map((x) => JSON.stringify(x)).sort(compareKeys);
        expect(sorted(b.patches)).toEqual(sorted(a.patches));
      }
    }
  });

  it("fold the v0 names they replace", () => {
    const deprecates = (name: string) => REGISTRY.get(name)!.deprecates;
    expect(deprecates("moveTask")).toEqual(["moveTask"]);
    expect(deprecates("assignTask")).toEqual(["assignTask"]);
    expect(deprecates("unassignTask")).toEqual(["assignTask"]);
    expect(deprecates("addStep")).toEqual(["addTask"]);
    expect(deprecates("updateStep")).toEqual(["updateTask"]);
    expect(deprecates("removeStep")).toEqual(["removeTask"]);
  });
});
