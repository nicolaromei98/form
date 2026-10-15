// The step 10e ops (plan §11 row 10, registry/README.md): proposals, with partial accept. For
// each op: the happy path with its exact caption and undo by patches, the no-op (by reference
// plus noopCaption, or proof that the op can't be one), and every rejection it can produce.
import { describe, expect, it } from "vitest";
import { seededMinter } from "@/lib/domain/ids";
import { STEPS_MAX, TASKS_MAX } from "@/lib/domain/limits";
import { nKeys, sortedByOrder } from "@/lib/domain/order";
import type { PersonId, ProposalId, StepId, TaskId } from "@/lib/domain/schema/ids";
import type { ProjectDoc, Step, Task } from "@/lib/domain/schema/project";
import type { Proposal } from "@/lib/domain/schema/proposal";
import type { CaptionPlanning } from "@/lib/ops/caption-env";
import { REGISTRY } from "@/lib/ops/registry";
import type { CaptionLane, FixtureName } from "@/lib/ops/registry/_contract";
import { byId, DEMO_PEOPLE, demoState, FIXTURE_NOW, makePerson, makeTask, taskByTitle } from "../../../../../test/fixtures/v2/build";
import { namedFixture } from "../../../../../test/fixtures/v2/named";
import {
  apply,
  captionOf,
  deepFreeze,
  expectApplied,
  expectInverse,
  expectNoop,
  expectRejection,
  projectOf,
  run,
  type TestState,
  withDoc,
} from "./support";

const mint = seededMinter(1050);
const demo = (): TestState => deepFreeze(demoState());
const fixture = (name: FixtureName): TestState => deepFreeze(namedFixture(name));
const project = (s: TestState) => projectOf(s);
const id = (s: TestState, title: string): TaskId => taskByTitle(project(s), title).id;
const after = (r: { result: { kind: string; doc: unknown } }) => r.result.doc as ProjectDoc;
const titles = (p: ProjectDoc) => sortedByOrder(p.tasks).map((t) => t.title);
const { marta, sara, luca } = DEMO_PEOPLE;

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

/** A pending proposal on the active project, built from the state's ids */
function pending(state: TestState, build: (s: TestState) => Record<string, unknown>): TestState {
  const proposal = { id: mint("proposal"), createdAt: FIXTURE_NOW, source: "agent", ...build(state) } as Proposal;
  return edited(state, (p) => ({ ...p, proposal }));
}

/** The pending proposal's id */
const pendingId = (s: TestState): ProposalId => project(s).proposal!.id;

/** The demo with this person archived */
function archived(state: TestState, person: PersonId): TestState {
  const p = { ...state.workspace.people[person], archived: true };
  return deepFreeze({ ...state, workspace: { ...state.workspace, people: { ...state.workspace.people, [person]: p } } });
}

/** The state with Giulia in the workspace: active, not a member of the project */
const GIULIA = mint("person");
function withGiulia(state: TestState): TestState {
  const giulia = makePerson({ id: GIULIA, name: "Giulia", order: nKeys(4)[3] });
  return deepFreeze({ ...state, workspace: { ...state.workspace, people: { ...state.workspace.people, [giulia.id]: giulia } } });
}

/** `count` plain steps */
const manySteps = (count: number): Step[] =>
  Array.from({ length: count }, (_, i) => ({ id: mint("step"), title: `Step ${i + 1}`, done: false, ownerId: null, estimateDays: null }));

/** The demo plus filler tasks up to `total` */
function withTasks(state: TestState, total: number): TestState {
  return edited(state, (p) => {
    const keys = nKeys(total);
    const kept = sortedByOrder(p.tasks).map((t, i) => ({ ...t, order: keys[i] }));
    const filler = keys.slice(kept.length).map((order, i) => makeTask({ id: mint("task"), title: `Filler ${i + 1}`, order }));
    return { ...p, tasks: byId([...kept, ...filler]) };
  });
}

/** A planning seam whose Team lanes are fixed, for captions that read overloads */
function lanes(list: Partial<CaptionLane>[]): { ctx: { planning: CaptionPlanning } } {
  const full = list.map((l) => ({ personId: null, days: 0, capacity: null, over: null, free: null, ...l }));
  return { ctx: { planning: { plan: () => null, focus: () => null, lanes: () => full } } };
}

/** The v0 op names each op folds in (plan §4.5) */
const deprecates = (name: string) => [...REGISTRY.get(name)!.deprecates];

/** A recipe can't be a no-op: its noopCaption says nothing */
const noNoopCaption = (name: string, s: TestState, op: Record<string, unknown>) =>
  REGISTRY.get(name)!.noopCaption({ op: op as { op: string }, before: project(s), env: undefined as never });

/* ------------------------------------------------------------------
   proposeSubtasks
   ------------------------------------------------------------------ */

describe("proposeSubtasks", () => {
  const item = (title: string, estimateDays: number | null = null) => ({ stepId: mint("step"), title, estimateDays });
  const propose = (taskId: TaskId, items: unknown[], o: Record<string, unknown> = {}) => ({
    op: "proposeSubtasks",
    proposalId: mint("proposal"),
    taskId,
    items,
    source: "parser",
    ...o,
  });
  /** The v0 breakdown of UI Design: 1.5 + 2 + 1.5 + 1 = its 6 days */
  const breakdown = () => [item("Wireframes & flows", 1.5), item("Key screens", 2), item("Component library", 1.5), item("Prototype & handoff", 1)];

  it("proposes steps for a task, keeping the minted ids, and says they fit its estimate", () => {
    const s = demo();
    const op = propose(id(s, "UI Design"), breakdown());
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).proposal).toEqual({
      id: op.proposalId,
      createdAt: FIXTURE_NOW,
      source: "parser",
      kind: "subtasks",
      taskId: id(s, "UI Design"),
      items: op.items,
    });
    // Nothing else moves until the proposal is accepted
    expect(after(r).tasks).toBe(project(s).tasks);
    const res = run(s, [op]);
    expect(res.caption).toEqual({
      text: "4 steps proposed for UI Design · fits its 6d estimate. Review them on the task.",
      tone: "proposal",
      undoable: true,
    });
    expect(deprecates("proposeSubtasks")).toEqual(["proposeSubtasks"]);
  });

  it("is honest about the estimates in its caption", () => {
    const s = demo();
    const ui = id(s, "UI Design");
    expect(captionOf(s, propose(ui, [item("Wireframes"), item("Screens")]))).toBe("2 steps proposed for UI Design · no estimates. Review them on the task.");
    expect(captionOf(s, propose(ui, [item("Wireframes")]))).toBe("1 step proposed for UI Design · no estimate. Review it on the task.");
    expect(captionOf(s, propose(ui, [item("Wireframes", 1), item("Screens", 2), item("Handoff")]))).toBe(
      "3 steps proposed for UI Design · 1 step without an estimate. Review them on the task.",
    );
    expect(captionOf(s, propose(ui, [item("Wireframes", 1), item("Screens", 2)]))).toBe("2 steps proposed for UI Design · 3d in all. Review them on the task.");
    const unknown = editTask(s, "UI Design", (t) => ({ ...t, estimateDays: null }));
    expect(captionOf(unknown, propose(ui, [item("Wireframes", 1), item("Screens", 5)]))).toBe(
      "2 steps proposed for UI Design · 6d in all. Review them on the task.",
    );
  });

  it("replaces the pending proposal, and undo restores it", () => {
    const s = fixture("demoPlan");
    const old = project(s).proposal;
    const r = apply(s, propose(id(s, "Development"), [item("Setup", 2)]));
    const applied = expectApplied(r.result);
    expectInverse(r.before, applied);
    expect(after(r).proposal).toMatchObject({ kind: "subtasks", taskId: id(s, "Development") });
    expect(project(withDoc(s, after(r))).proposal).not.toEqual(old);
  });

  it("is never a no-op: the same payload again is refused, not re-minted", () => {
    const s = demo();
    const op = propose(id(s, "UI Design"), breakdown());
    const once = withDoc(s, after(apply(s, op)));
    expect(REGISTRY.get("proposeSubtasks")!.idempotent).toBe(false);
    expect(noNoopCaption("proposeSubtasks", s, op)).toBeNull();
    expectRejection(apply(once, op).result, "duplicate_id");
  });

  it("refuses a missing task, a milestone and a step count past the limit", () => {
    const s = demo();
    expectRejection(apply(s, propose(mint("task"), [item("Setup")])).result, "not_found");
    const ms = editTask(s, "Development", (t) => ({ ...t, kind: "milestone", estimateDays: 0 }));
    const msg = expectRejection(apply(ms, propose(id(s, "Development"), [item("Setup")])).result, "invalid_state");
    expect(msg.message).toBe("Development is a milestone: it takes no steps.");
    const full = editTask(s, "UI Design", (t) => ({ ...t, steps: manySteps(STEPS_MAX - 2) }));
    const limit = expectRejection(apply(full, propose(id(s, "UI Design"), breakdown())).result, "limit");
    expect(limit.message).toBe("UI Design would have 42 steps: a task holds at most 40.");
  });

  it("refuses ids already taken: a step's, the pending proposal's or its steps'", () => {
    const s = fixture("demoProposal");
    const ui = id(s, "UI Design");
    const withStep = editTask(s, "Development", (t) => ({ ...t, steps: manySteps(1) }));
    const stepId = project(withStep).tasks[id(s, "Development")].steps[0].id;
    expectRejection(apply(withStep, propose(ui, [{ stepId, title: "Setup", estimateDays: null }])).result, "duplicate_id");
    expectRejection(apply(s, propose(ui, [item("Setup")], { proposalId: pendingId(s) })).result, "duplicate_id");
    const proposed = (project(s).proposal as Extract<Proposal, { kind: "subtasks" }>).items[0].stepId;
    expectRejection(apply(s, propose(ui, [{ stepId: proposed, title: "Setup", estimateDays: null }])).result, "duplicate_id");
  });

  it("refuses an invalid payload", () => {
    const s = demo();
    const ui = id(s, "UI Design");
    const twice = item("Setup");
    expectRejection(apply(s, propose(ui, [twice, twice])).result, "invalid_payload");
    expectRejection(apply(s, propose(ui, [])).result, "invalid_payload");
    expectRejection(apply(s, propose(ui, Array.from({ length: 13 }, (_, i) => item(`Step ${i + 1}`)))).result, "invalid_payload");
    expectRejection(apply(s, propose(ui, [item("Setup", 0)])).result, "invalid_payload");
    expectRejection(apply(s, propose(ui, [item("x".repeat(141))])).result, "invalid_payload");
    expectRejection(apply(s, propose(ui, [item("Setup")], { source: "system" })).result, "invalid_payload");
    const noSource: Record<string, unknown> = propose(ui, [item("Setup")]);
    delete noSource.source;
    expectRejection(apply(s, noSource).result, "invalid_payload");
  });
});

/* ------------------------------------------------------------------
   proposeReassign
   ------------------------------------------------------------------ */

describe("proposeReassign", () => {
  const owner = (taskId: TaskId, from: PersonId | null, to: PersonId, why = "Marta is 4d over capacity. Sara has room for its 6d.") => ({
    type: "owner",
    taskId,
    from,
    to,
    why,
  });
  const shift = (taskId: TaskId, pinnedStart = "2026-10-26", days = 3) => ({ type: "shift", taskId, pinnedStart, days, why: "It has 5 days of float." });
  const propose = (moves: unknown[], o: Record<string, unknown> = {}) => ({ op: "proposeReassign", proposalId: mint("proposal"), moves, source: "parser", ...o });

  it("proposes a handover and leads with the overload it answers", () => {
    const s = demo();
    const op = propose([owner(id(s, "UI Design"), marta, sara)]);
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).proposal).toEqual({ id: op.proposalId, createdAt: FIXTURE_NOW, source: "parser", kind: "reassign", moves: op.moves });
    // Nothing moves until the proposal is accepted
    expect(after(r).tasks).toBe(project(s).tasks);
    const res = run(s, [op], lanes([{ personId: marta, over: 4 }, { personId: sara, free: 4 }]));
    expect(res.caption).toEqual({ text: "Marta is 4d over capacity · 1 handover proposed. Review it on the team.", tone: "proposal", undoable: true });
    // Without the planning engine the caption says less, never something false
    expect(captionOf(s, op)).toBe("1 handover proposed. Review it on the team.");
    expect(deprecates("proposeReassign")).toEqual(["proposeReassign"]);
  });

  it("names the person the moves relieve, else the most overloaded one", () => {
    const s = demo();
    const both = lanes([
      { personId: luca, over: 6 },
      { personId: marta, over: 4 },
    ]);
    expect(captionOf(s, propose([owner(id(s, "UI Design"), marta, sara)]), both)).toBe("Marta is 4d over capacity · 1 handover proposed. Review it on the team.");
    expect(captionOf(s, propose([owner(id(s, "Development"), luca, sara)]), both)).toBe("Luca is 6d over capacity · 1 handover proposed. Review it on the team.");
    expect(captionOf(s, propose([owner(id(s, "Development"), luca, sara)]), lanes([{ personId: marta, over: 4.5 }]))).toBe(
      "Marta is 4.5d over capacity · 1 handover proposed. Review it on the team.",
    );
    // A shift relieves the task's owner
    expect(captionOf(s, propose([shift(id(s, "Development"))]), lanes([{ personId: luca, over: 2 }]))).toBe(
      "Luca is 2d over capacity · 1 shift proposed. Review it on the team.",
    );
  });

  it("counts handovers and shifts, and gives unassigned work an owner", () => {
    const s = demo();
    expect(captionOf(s, propose([owner(id(s, "UI Design"), marta, sara), shift(id(s, "Development"))]))).toBe(
      "1 handover and 1 shift proposed. Review it on the team.",
    );
    const unowned = editTask(s, "Development", (t) => ({ ...t, ownerId: null }));
    expect(captionOf(unowned, propose([owner(id(s, "Development"), null, sara)]))).toBe(
      "Unassigned work gets an owner · 1 handover proposed. Review it on the team.",
    );
    expect(captionOf(s, propose([owner(id(s, "UI Design"), marta, sara), owner(id(s, "Development"), luca, sara)]))).toBe(
      "2 handovers proposed. Review it on the team.",
    );
  });

  it("replaces the pending proposal, and undo restores it", () => {
    const s = fixture("demoProposal");
    const r = apply(s, propose([owner(id(s, "UI Design"), marta, sara)]));
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).proposal?.kind).toBe("reassign");
  });

  it("is never a no-op: the same payload again is refused", () => {
    const s = demo();
    const op = propose([owner(id(s, "UI Design"), marta, sara)]);
    expect(REGISTRY.get("proposeReassign")!.idempotent).toBe(false);
    expect(noNoopCaption("proposeReassign", s, op)).toBeNull();
    expectRejection(apply(withDoc(s, after(apply(s, op))), op).result, "duplicate_id");
  });

  it("refuses a missing or done task, and a handover that doesn't match the task's owner", () => {
    const s = demo();
    const ui = id(s, "UI Design");
    expectRejection(apply(s, propose([owner(mint("task"), null, sara)])).result, "not_found");
    const done = expectRejection(apply(s, propose([shift(id(s, "Research"))])).result, "invalid_state");
    expect(done.message).toBe("Research is done, so there's nothing to move.");
    const moved = expectRejection(apply(s, propose([owner(ui, sara, luca)])).result, "invalid_state");
    expect(moved.message).toBe("UI Design is with Marta now, not Sara.");
    const same = expectRejection(apply(s, propose([owner(ui, marta, marta)])).result, "invalid_state");
    expect(same.message).toBe("UI Design is already with Marta.");
  });

  it("refuses a receiver who isn't in the workspace or has left the team", () => {
    const s = demo();
    const ui = id(s, "UI Design");
    expectRejection(apply(s, propose([owner(ui, marta, mint("person"))])).result, "invalid_reference");
    const left = expectRejection(apply(archived(s, sara), propose([owner(ui, marta, sara)])).result, "archived");
    expect(left.message).toBe("Sara has left the team.");
  });

  it("refuses the pending proposal's id and an invalid payload", () => {
    const s = fixture("demoPlan");
    const ui = id(s, "UI Design");
    expectRejection(apply(s, propose([owner(ui, marta, sara)], { proposalId: pendingId(s) })).result, "duplicate_id");
    expectRejection(apply(s, propose([owner(ui, marta, sara), shift(ui)])).result, "invalid_payload");
    expectRejection(apply(s, propose([shift(ui, "2026-02-30")])).result, "invalid_payload");
    expectRejection(apply(s, propose([shift(ui, "2026-10-26", 0)])).result, "invalid_payload");
    expectRejection(apply(s, propose([owner(ui, marta, sara, "x".repeat(201))])).result, "invalid_payload");
    expectRejection(apply(s, propose([])).result, "invalid_payload");
  });
});

/* ------------------------------------------------------------------
   proposeLeveling
   ------------------------------------------------------------------ */

describe("proposeLeveling", () => {
  const move = (taskId: TaskId, pinnedStart = "2026-10-26", days = 2) => ({ taskId, pinnedStart, days, why: "Luca is busy until then." });
  const propose = (moves: unknown[], o: Record<string, unknown> = {}) => ({ op: "proposeLeveling", proposalId: mint("proposal"), moves, source: "agent", ...o });

  it("proposes new starts without moving anything yet", () => {
    const s = demo();
    const op = propose([move(id(s, "Development")), move(id(s, "UI Design"), "2026-10-19", 1)]);
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).proposal).toEqual({ id: op.proposalId, createdAt: FIXTURE_NOW, source: "agent", kind: "leveling", moves: op.moves });
    expect(after(r).tasks).toBe(project(s).tasks);
    expect(run(s, [op]).caption).toEqual({ text: "Leveling proposed · 2 starts move", tone: "proposal", undoable: true });
    expect(captionOf(s, propose([move(id(s, "Development"))]))).toBe("Leveling proposed · 1 start moves");
    expect(deprecates("proposeLeveling")).toEqual([]);
  });

  it("replaces the pending proposal, and is never a no-op", () => {
    const s = fixture("demoProposal");
    const op = propose([move(id(s, "Development"))]);
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(REGISTRY.get("proposeLeveling")!.idempotent).toBe(false);
    expect(noNoopCaption("proposeLeveling", s, op)).toBeNull();
    expectRejection(apply(withDoc(s, after(r)), op).result, "duplicate_id");
  });

  it("refuses a missing or done task, a taken id and an invalid payload", () => {
    const s = fixture("demoPlan");
    const dev = id(s, "Development");
    expectRejection(apply(s, propose([move(mint("task"))])).result, "not_found");
    expectRejection(apply(s, propose([move(id(s, "Research"))])).result, "invalid_state");
    expectRejection(apply(s, propose([move(dev)], { proposalId: pendingId(s) })).result, "duplicate_id");
    expectRejection(apply(s, propose([move(dev), move(dev, "2026-11-02")])).result, "invalid_payload");
    expectRejection(apply(s, propose([move(dev, "2026-02-30")])).result, "invalid_payload");
    expectRejection(apply(s, propose([move(dev, "2026-10-26", 251)])).result, "invalid_payload");
  });
});

/* ------------------------------------------------------------------
   proposeEstimates
   ------------------------------------------------------------------ */

describe("proposeEstimates", () => {
  const propose = (items: unknown[], o: Record<string, unknown> = {}) => ({ op: "proposeEstimates", proposalId: mint("proposal"), items, source: "agent", ...o });

  it("suggests estimates, shown as such until accepted", () => {
    const s = fixture("demoUnestimated");
    const op = propose([{ taskId: id(s, "UI Design"), estimateDays: 6 }]);
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).proposal).toEqual({ id: op.proposalId, createdAt: FIXTURE_NOW, source: "agent", kind: "estimates", items: op.items });
    expect(after(r).tasks[id(s, "UI Design")].estimateDays).toBeNull();
    expect(run(s, [op]).caption).toEqual({ text: "Suggested estimate for UI Design · 6d", tone: "proposal", undoable: true });
    const many = propose([
      { taskId: id(s, "UI Design"), estimateDays: 6 },
      { taskId: id(s, "Development"), estimateDays: 7.5 },
    ]);
    expect(captionOf(s, many)).toBe("Suggested estimates for 2 tasks");
    expect(deprecates("proposeEstimates")).toEqual([]);
  });

  it("replaces the pending proposal, and is never a no-op", () => {
    const s = fixture("demoProposal");
    const op = propose([{ taskId: id(s, "Development"), estimateDays: 5 }]);
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(REGISTRY.get("proposeEstimates")!.idempotent).toBe(false);
    expect(noNoopCaption("proposeEstimates", s, op)).toBeNull();
    expectRejection(apply(withDoc(s, after(r)), op).result, "duplicate_id");
  });

  it("refuses a missing task, a milestone, a taken id and an invalid payload", () => {
    const s = fixture("demoPlan");
    const dev = id(s, "Development");
    expectRejection(apply(s, propose([{ taskId: mint("task"), estimateDays: 2 }])).result, "not_found");
    const ms = editTask(s, "Development", (t) => ({ ...t, kind: "milestone", estimateDays: 0 }));
    const msg = expectRejection(apply(ms, propose([{ taskId: dev, estimateDays: 2 }])).result, "invalid_state");
    expect(msg.message).toBe("Development is a milestone: it takes no time.");
    expectRejection(apply(s, propose([{ taskId: dev, estimateDays: 2 }], { proposalId: pendingId(s) })).result, "duplicate_id");
    expectRejection(apply(s, propose([{ taskId: dev, estimateDays: 0 }])).result, "invalid_payload");
    expectRejection(apply(s, propose([{ taskId: dev, estimateDays: 2.7 }])).result, "invalid_payload");
    expectRejection(apply(s, propose([{ taskId: dev, estimateDays: null }])).result, "invalid_payload");
    expectRejection(
      apply(
        s,
        propose([
          { taskId: dev, estimateDays: 2 },
          { taskId: dev, estimateDays: 3 },
        ]),
      ).result,
      "invalid_payload",
    );
  });
});

/* ------------------------------------------------------------------
   proposePlan
   ------------------------------------------------------------------ */

describe("proposePlan", () => {
  const seed = (title: string, o: Record<string, unknown> = {}) => ({
    taskId: mint("task"),
    title,
    kind: "task",
    estimateDays: null,
    dependsOn: [],
    status: "todo",
    priority: "medium",
    progress: 0,
    ownerId: null,
    emphasis: false,
    steps: [],
    ...o,
  });
  const propose = (tasks: unknown[], o: Record<string, unknown> = {}) => ({ op: "proposePlan", proposalId: mint("proposal"), tasks, source: "agent", ...o });

  it("proposes new tasks without adding them yet", () => {
    const s = demo();
    const copy = seed("Copywriting", { dependsOn: [id(s, "UI Design")] });
    const launch = seed("Launch", { kind: "milestone", estimateDays: 0, dependsOn: [id(s, "Development"), copy.taskId] });
    const op = propose([copy, launch]);
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).proposal).toEqual({ id: op.proposalId, createdAt: FIXTURE_NOW, source: "agent", kind: "plan", tasks: [copy, launch] });
    expect(after(r).tasks).toBe(project(s).tasks);
    expect(run(s, [op]).caption).toEqual({ text: "Proposal · 2 tasks, no estimate yet", tone: "proposal", undoable: true });
    expect(deprecates("proposePlan")).toEqual([]);
  });

  it("normalises seeds on write: dependencies deduplicated, milestones take no time and no steps", () => {
    const s = demo();
    const dev = id(s, "Development");
    const launch = seed("Launch", { kind: "milestone", estimateDays: 3, dependsOn: [dev, dev], steps: [{ stepId: mint("step"), title: "Go", estimateDays: 1 }] });
    const stored = after(apply(s, propose([launch]))).proposal as Extract<Proposal, { kind: "plan" }>;
    expect(stored.tasks[0]).toMatchObject({ kind: "milestone", estimateDays: 0, dependsOn: [dev], steps: [] });
  });

  it("sums up what is known of the estimates", () => {
    const s = demo();
    expect(captionOf(s, propose([seed("Copy", { estimateDays: 2 }), seed("QA", { estimateDays: 3 })]))).toBe("Proposal · 2 tasks, 5d of work");
    expect(captionOf(s, propose([seed("Copy", { estimateDays: 2 }), seed("QA"), seed("SEO", { estimateDays: 1.5 })]))).toBe(
      "Proposal · 3 tasks, 1 without an estimate",
    );
    expect(captionOf(s, propose([seed("Copy"), seed("QA"), seed("SEO")]))).toBe("Proposal · 3 tasks, no estimates yet");
    expect(captionOf(s, propose([seed("Launch", { kind: "milestone", estimateDays: 0 })]))).toBe("Proposal · 1 milestone");
  });

  it("replaces the pending proposal, and is never a no-op", () => {
    const s = fixture("demoProposal");
    const op = propose([seed("Copywriting")]);
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(REGISTRY.get("proposePlan")!.idempotent).toBe(false);
    expect(noNoopCaption("proposePlan", s, op)).toBeNull();
    expectRejection(apply(withDoc(s, after(r)), op).result, "duplicate_id");
  });

  it("refuses ids already taken: a task's, a step's or the pending proposal's", () => {
    const s = fixture("demoPlan");
    expectRejection(apply(s, propose([seed("Copy", { taskId: id(s, "Research") })])).result, "duplicate_id");
    const withStep = editTask(s, "Development", (t) => ({ ...t, steps: manySteps(1) }));
    const stepId = project(withStep).tasks[id(s, "Development")].steps[0].id;
    expectRejection(apply(withStep, propose([seed("Copy", { steps: [{ stepId, title: "Draft", estimateDays: null }] })])).result, "duplicate_id");
    expectRejection(apply(s, propose([seed("Copy")], { proposalId: pendingId(s) })).result, "duplicate_id");
  });

  it("refuses a seed that waits on itself, on a later seed or on a missing task", () => {
    const s = demo();
    const copy = seed("Copywriting");
    const self = expectRejection(apply(s, propose([{ ...copy, dependsOn: [copy.taskId] }])).result, "self_dependency");
    expect(self.message).toBe("Copywriting can't wait on itself.");
    const later = seed("QA");
    const ahead = expectRejection(apply(s, propose([{ ...copy, dependsOn: [later.taskId] }, later])).result, "not_found");
    expect(ahead.message).toBe("Copywriting waits on a task that isn't in this project or comes later in the plan.");
    expectRejection(apply(s, propose([seed("Copy", { dependsOn: [mint("task")] })])).result, "not_found");
  });

  it("refuses an incoherent seed: a 0 estimate, Done at 40%, a started milestone", () => {
    const s = demo();
    const zero = expectRejection(apply(s, propose([seed("Copy", { estimateDays: 0 })])).result, "invalid_payload");
    expect(zero.message).toBe("An estimate is at least half a day.");
    const done = expectRejection(apply(s, propose([seed("Copy", { status: "done", progress: 40 })])).result, "invalid_state");
    expect(done.message).toBe("Copy: Done at 40%: Done means 100%.");
    const started = expectRejection(apply(s, propose([seed("Launch", { kind: "milestone", estimateDays: 0, status: "active", progress: 30 })])).result, "invalid_state");
    expect(started.message).toBe("Launch is a milestone: it's either to do or done.");
    // In review at 100% is coherent only with the review step
    expectRejection(apply(s, propose([seed("Copy", { status: "review", progress: 100 })])).result, "invalid_state");
    const review = edited(s, (p) => ({ ...p, requireReview: true }));
    expectApplied(apply(review, propose([seed("Copy", { status: "review", progress: 100 })])).result);
  });

  it("refuses an owner who isn't in the workspace or has left the team", () => {
    const s = demo();
    expectRejection(apply(s, propose([seed("Copy", { ownerId: mint("person") })])).result, "invalid_reference");
    expectRejection(apply(archived(s, luca), propose([seed("Copy", { ownerId: luca })])).result, "archived");
  });

  it("refuses a plan past the task limit and an invalid payload", () => {
    const s = withTasks(demo(), TASKS_MAX - 1);
    const limit = expectRejection(apply(s, propose([seed("Copy"), seed("QA")])).result, "limit");
    expect(limit.message).toBe("That plan would make 501 tasks: a project holds at most 500.");
    const d = demo();
    const twice = seed("Copy");
    expectRejection(apply(d, propose([twice, twice])).result, "invalid_payload");
    const step = { stepId: mint("step"), title: "Draft", estimateDays: null };
    expectRejection(apply(d, propose([seed("Copy", { steps: [step] }), seed("QA", { steps: [step] })])).result, "invalid_payload");
    expectRejection(apply(d, propose([])).result, "invalid_payload");
    expectRejection(apply(d, propose(Array.from({ length: 13 }, (_, i) => seed(`Task ${i + 1}`)))).result, "invalid_payload");
  });
});

/* ------------------------------------------------------------------
   acceptProposal
   ------------------------------------------------------------------ */

describe("acceptProposal", () => {
  const accept = (proposalId: ProposalId, only?: string[]) => ({ op: "acceptProposal", proposalId, ...(only ? { only } : {}) });
  type Subtasks = Extract<Proposal, { kind: "subtasks" }>;
  const proposedSteps = (s: TestState) => (project(s).proposal as Subtasks).items;

  describe("subtasks", () => {
    it("adds every step, each keeping its proposed id, and closes the proposal", () => {
      const s = fixture("demoProposal");
      const op = accept(pendingId(s));
      const r = apply(s, op);
      expectInverse(r.before, expectApplied(r.result));
      const ui = after(r).tasks[id(s, "UI Design")];
      expect(ui.steps).toEqual(proposedSteps(s).map((i) => ({ id: i.stepId, title: i.title, done: false, ownerId: null, estimateDays: i.estimateDays })));
      expect(after(r).proposal).toBeNull();
      expect(run(s, [op]).caption).toEqual({ text: "4 steps added to UI Design", tone: "done", undoable: true });
      expect(deprecates("acceptProposal")).toEqual(["acceptProposal", "acceptReassign"]);
    });

    it("accepts only the chosen steps; the rest go with the proposal", () => {
      const s = fixture("demoProposal");
      const [a, , c] = proposedSteps(s);
      const op = accept(pendingId(s), [c.stepId, a.stepId, mint("step")]);
      const r = apply(s, op);
      expectInverse(r.before, expectApplied(r.result));
      expect(after(r).tasks[id(s, "UI Design")].steps.map((x) => x.id)).toEqual([a.stepId, c.stepId]);
      expect(after(r).proposal).toBeNull();
      expect(captionOf(s, op)).toBe("2 steps added to UI Design · 2 left out");
    });

    it("speaks even for a direct edit, since it resolves a proposal", () => {
      const s = fixture("demoProposal");
      expect(run(s, [accept(pendingId(s))], { caption: false }).caption?.text).toBe("4 steps added to UI Design");
    });

    it("refuses steps past the limit, and an id taken outside the proposal", () => {
      const full = editTask(fixture("demoProposal"), "UI Design", (t) => ({ ...t, steps: manySteps(STEPS_MAX - 2) }));
      const limit = expectRejection(apply(full, accept(pendingId(full))).result, "limit");
      expect(limit.message).toBe("UI Design would have 42 steps: a task holds at most 40.");
      // A document that broke invariant P3: a proposed step id is already a step of another task
      const s = fixture("demoProposal");
      const clash = editTask(s, "Development", (t) => ({ ...t, steps: [{ id: proposedSteps(s)[1].stepId as StepId, title: "Clash", done: false, ownerId: null, estimateDays: null }] }));
      expectRejection(apply(clash, accept(pendingId(clash))).result, "duplicate_id");
    });
  });

  describe("reassign", () => {
    it("hands the task over (v0 acceptReassign)", () => {
      const s = fixture("demoPlan");
      const op = accept(pendingId(s));
      const r = apply(s, op);
      expectInverse(r.before, expectApplied(r.result));
      expect(after(r).tasks[id(s, "UI Design")].ownerId).toBe(sara);
      expect(after(r).memberIds).toBe(project(s).memberIds);
      expect(after(r).proposal).toBeNull();
      expect(captionOf(s, op)).toBe("1 task reassigned");
    });

    it("adds a receiver who isn't a member yet, and moves pinned starts", () => {
      const s = pending(withGiulia(demo()), (x) => ({
        kind: "reassign",
        moves: [
          { type: "owner", taskId: id(x, "UI Design"), from: marta, to: GIULIA, why: "Giulia has room." },
          { type: "shift", taskId: id(x, "Development"), pinnedStart: "2026-10-26", days: 3, why: "It has float." },
        ],
      }));
      const op = accept(pendingId(s));
      const r = apply(s, op);
      expectInverse(r.before, expectApplied(r.result));
      expect(after(r).memberIds).toEqual([...project(s).memberIds, GIULIA]);
      expect(after(r).tasks[id(s, "UI Design")].ownerId).toBe(GIULIA);
      expect(after(r).tasks[id(s, "Development")].pinnedStart).toBe("2026-10-26");
      expect(captionOf(s, op)).toBe("1 task reassigned · 1 start moved");
      expect(captionOf(s, accept(pendingId(s), [id(s, "Development")]))).toBe("1 start moved · 1 left out");
    });

    it("skips moves that no longer apply: the task changed hands, was done, or the receiver left", () => {
      const s = fixture("demoPlan");
      const op = accept(pendingId(s));
      const handed = editTask(s, "UI Design", (t) => ({ ...t, ownerId: luca }));
      const r = apply(handed, op);
      expectInverse(r.before, expectApplied(r.result));
      expect(after(r).tasks[id(s, "UI Design")].ownerId).toBe(luca);
      expect(after(r).proposal).toBeNull();
      expect(captionOf(handed, op)).toBe("Proposal closed · nothing in it still applies");
      const done = editTask(s, "UI Design", (t) => ({ ...t, status: "done", progress: 100, completedAt: FIXTURE_NOW }));
      expect(captionOf(done, op)).toBe("Proposal closed · nothing in it still applies");
      expect(captionOf(archived(s, sara), op)).toBe("Proposal closed · nothing in it still applies");
      expect(captionOf(handed, accept(pendingId(s), [id(s, "UI Design")]))).toBe("Proposal closed · none of the chosen items still apply");
    });

    it("counts what applied and what no longer does", () => {
      const s = pending(demo(), (x) => ({
        kind: "reassign",
        moves: [
          { type: "owner", taskId: id(x, "UI Design"), from: marta, to: sara, why: "Sara has room." },
          { type: "owner", taskId: id(x, "Development"), from: marta, to: sara, why: "Stale: Luca owns it." },
        ],
      }));
      const r = apply(s, accept(pendingId(s)));
      expect(after(r).tasks[id(s, "Development")].ownerId).toBe(luca);
      expect(captionOf(s, accept(pendingId(s)))).toBe("1 task reassigned · 1 no longer applies");
    });
  });

  describe("leveling and estimates", () => {
    it("moves the proposed starts", () => {
      const s = pending(demo(), (x) => ({
        kind: "leveling",
        moves: [
          { taskId: id(x, "UI Design"), pinnedStart: "2026-10-19", days: 1, why: "Marta is busy." },
          { taskId: id(x, "Development"), pinnedStart: "2026-10-26", days: 2, why: "Luca is busy." },
        ],
      }));
      const op = accept(pendingId(s));
      const r = apply(s, op);
      expectInverse(r.before, expectApplied(r.result));
      expect(after(r).tasks[id(s, "UI Design")].pinnedStart).toBe("2026-10-19");
      expect(after(r).tasks[id(s, "Development")].pinnedStart).toBe("2026-10-26");
      expect(captionOf(s, op)).toBe("2 starts moved");
      expect(captionOf(s, accept(pendingId(s), [id(s, "Development")]))).toBe("1 start moved · 1 left out");
    });

    it("sets the suggested estimates, skipping one that is already there", () => {
      const s = pending(fixture("demoUnestimated"), (x) => ({
        kind: "estimates",
        items: [
          { taskId: id(x, "UI Design"), estimateDays: 6 },
          { taskId: id(x, "Development"), estimateDays: 8 },
        ],
      }));
      const op = accept(pendingId(s));
      const r = apply(s, op);
      expectInverse(r.before, expectApplied(r.result));
      expect(after(r).tasks[id(s, "UI Design")].estimateDays).toBe(6);
      expect(captionOf(s, op)).toBe("UI Design estimated at 6d · 1 no longer applies");
      const two = pending(demo(), (x) => ({
        kind: "estimates",
        items: [
          { taskId: id(x, "UI Design"), estimateDays: 5 },
          { taskId: id(x, "Development"), estimateDays: 9.5 },
        ],
      }));
      expect(captionOf(two, accept(pendingId(two)))).toBe("Estimates set for 2 tasks");
    });
  });

  describe("plan", () => {
    const COPY = mint("task");
    const LAUNCH = mint("task");
    const DRAFT = mint("step");
    const seed = (taskId: TaskId, title: string, o: Record<string, unknown> = {}) => ({
      taskId,
      title,
      kind: "task",
      estimateDays: null,
      dependsOn: [],
      status: "todo",
      priority: "medium",
      progress: 0,
      ownerId: null,
      emphasis: false,
      steps: [],
      ...o,
    });
    /** Copywriting (Giulia, after UI Design) and Launch (after Development and Copywriting) */
    const planned = (state: TestState = withGiulia(demo())) =>
      pending(state, (x) => ({
        kind: "plan",
        tasks: [
          seed(COPY, "Copywriting", { estimateDays: 2, ownerId: GIULIA, dependsOn: [id(x, "UI Design")], steps: [{ stepId: DRAFT, title: "Draft", estimateDays: 1 }] }),
          seed(LAUNCH, "Launch", { kind: "milestone", estimateDays: 0, priority: "high", dependsOn: [id(x, "Development"), COPY] }),
        ],
      }));

    it("adds the seeds as tasks at the end of the workflow; owners join the project", () => {
      const s = planned();
      const op = accept(pendingId(s));
      const r = apply(s, op);
      expectInverse(r.before, expectApplied(r.result));
      const p = after(r);
      expect(titles(p)).toEqual(["Research", "Visual Direction", "UI Design", "Development", "Copywriting", "Launch"]);
      expect(p.tasks[COPY]).toMatchObject({
        title: "Copywriting",
        kind: "task",
        status: "todo",
        progress: 0,
        estimateDays: 2,
        allocation: 1,
        ownerId: GIULIA,
        dependsOn: [id(s, "UI Design")],
        steps: [{ id: DRAFT, title: "Draft", done: false, ownerId: null, estimateDays: 1 }],
        createdAt: FIXTURE_NOW,
        completedAt: null,
      });
      expect(p.tasks[LAUNCH]).toMatchObject({ kind: "milestone", estimateDays: 0, priority: "high", dependsOn: [id(s, "Development"), COPY] });
      expect(p.memberIds).toEqual([...project(s).memberIds, GIULIA]);
      expect(p.proposal).toBeNull();
      expect(captionOf(s, op)).toBe("2 tasks added");
    });

    it("bridges a chosen seed over a left-out one, as removeTask does", () => {
      const s = planned();
      const op = accept(pendingId(s), [LAUNCH]);
      const r = apply(s, op);
      expectInverse(r.before, expectApplied(r.result));
      expect(Object.hasOwn(after(r).tasks, COPY)).toBe(false);
      expect(after(r).tasks[LAUNCH].dependsOn).toEqual([id(s, "Development"), id(s, "UI Design")]);
      expect(after(r).memberIds).toBe(project(s).memberIds);
      expect(captionOf(s, op)).toBe("1 task added · 1 left out");
    });

    it("leaves a task unassigned when its owner left the team since", () => {
      const s = planned(archived(withGiulia(demo()), GIULIA));
      const p = after(apply(s, accept(pendingId(s))));
      expect(p.tasks[COPY].ownerId).toBeNull();
      expect(p.memberIds).toBe(project(s).memberIds);
    });

    it("lands each seed on its status and progress through the status table", () => {
      const base = edited(demo(), (p) => ({ ...p, status: "planning" }));
      const states = (list: [string, number][]) =>
        pending(base, () => ({ kind: "plan", tasks: list.map(([status, progress], i) => seed(mint("task"), `Seed ${i + 1}`, { status, progress })) }));
      const reviewed = states([
        ["review", 60],
        ["done", 100],
      ]);
      const p = after(apply(reviewed, accept(pendingId(reviewed))));
      const [first, second] = sortedByOrder(p.tasks).slice(-2);
      expect(first).toMatchObject({ status: "review", progress: 60, completedAt: null });
      expect(second).toMatchObject({ status: "done", progress: 100, completedAt: FIXTURE_NOW });
      // Nothing started, so the project stays in planning
      expect(p.status).toBe("planning");
      const started = states([["active", 30]]);
      const q = after(apply(started, accept(pendingId(started))));
      expect(sortedByOrder(q.tasks).at(-1)).toMatchObject({ status: "active", progress: 30 });
      expect(q.status).toBe("active");
    });

    it("refuses tasks past the limit, and ids taken outside the proposal", () => {
      const full = planned(withGiulia(withTasks(demo(), TASKS_MAX - 1)));
      const limit = expectRejection(apply(full, accept(pendingId(full))).result, "limit");
      expect(limit.message).toBe("That would make 501 tasks: a project holds at most 500.");
      // A document that broke invariant P3: a proposed step id is already a step
      const clash = editTask(planned(), "Development", (t) => ({ ...t, steps: [{ id: DRAFT, title: "Clash", done: false, ownerId: null, estimateDays: null }] }));
      expectRejection(apply(clash, accept(pendingId(clash))).result, "duplicate_id");
    });
  });

  it("is never a no-op: accepting twice finds no proposal (stale_proposal)", () => {
    const s = fixture("demoProposal");
    const op = accept(pendingId(s));
    expect(REGISTRY.get("acceptProposal")!.idempotent).toBe(false);
    expect(noNoopCaption("acceptProposal", s, op)).toBeNull();
    const msg = expectRejection(apply(withDoc(s, after(apply(s, op))), op).result, "stale_proposal");
    expect(msg.message).toBe("There's no proposal waiting anymore.");
  });

  it("refuses a proposal that was replaced by a newer one", () => {
    const s = fixture("demoProposal");
    const msg = expectRejection(apply(s, accept(mint("proposal"))).result, "stale_proposal");
    expect(msg.message).toBe("That proposal was replaced by a newer one.");
    expect(captionOf(s, accept(mint("proposal")))).toBe("Couldn't apply that: That proposal was replaced by a newer one.");
  });

  it("refuses a choice that names nothing in the proposal, and an invalid payload", () => {
    const s = fixture("demoPlan");
    const none = expectRejection(apply(s, accept(pendingId(s), [mint("task"), mint("step")])).result, "not_found");
    expect(none.message).toBe("None of those are in the proposal anymore.");
    expectRejection(apply(s, accept(pendingId(s), [])).result, "invalid_payload");
    expectRejection(apply(s, accept(pendingId(s), ["UI Design"])).result, "invalid_payload");
    expectRejection(apply(s, { ...accept(pendingId(s)), extra: true }).result, "invalid_payload");
  });
});

/* ------------------------------------------------------------------
   discardProposal
   ------------------------------------------------------------------ */

describe("discardProposal", () => {
  const discard = (proposalId: ProposalId) => ({ op: "discardProposal", proposalId });

  it("discards the pending proposal; nothing in the project moves", () => {
    const s = fixture("demoProposal");
    const op = discard(pendingId(s));
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).proposal).toBeNull();
    expect(after(r).tasks).toBe(project(s).tasks);
    expect(run(s, [op]).caption).toEqual({ text: "Proposal discarded", tone: "done", undoable: true });
    expect(deprecates("discardProposal")).toEqual(["discardProposal", "discardReassign"]);
  });

  it("names what was discarded, in the v0 wording", () => {
    const plan = fixture("demoPlan");
    expect(captionOf(plan, discard(pendingId(plan)))).toBe("Plan discarded · nothing moved");
    const leveling = pending(demo(), (x) => ({ kind: "leveling", moves: [{ taskId: id(x, "Development"), pinnedStart: "2026-10-26", days: 2, why: "Busy." }] }));
    expect(captionOf(leveling, discard(pendingId(leveling)))).toBe("Leveling discarded · nothing moved");
    const estimates = pending(demo(), (x) => ({ kind: "estimates", items: [{ taskId: id(x, "Development"), estimateDays: 5 }] }));
    expect(captionOf(estimates, discard(pendingId(estimates)))).toBe("Suggested estimates discarded");
    const seeds = pending(demo(), () => ({
      kind: "plan",
      tasks: [{ taskId: mint("task"), title: "Copy", kind: "task", estimateDays: null, dependsOn: [], status: "todo", priority: "medium", progress: 0, ownerId: null, emphasis: false, steps: [] }],
    }));
    expect(captionOf(seeds, discard(pendingId(seeds)))).toBe("Proposal discarded");
  });

  it("speaks even for a direct edit, since it resolves a proposal", () => {
    const s = fixture("demoPlan");
    expect(run(s, [discard(pendingId(s))], { caption: false }).caption?.text).toBe("Plan discarded · nothing moved");
  });

  it("is a no-op, by reference, for a proposal that is no longer pending", () => {
    const s = fixture("demoProposal");
    const stale = discard(mint("proposal"));
    const r = apply(s, stale);
    expectNoop(r.result, r.before);
    expect(run(s, [stale]).caption).toEqual({ text: "That proposal was already replaced", tone: "info", undoable: false });
    const none = demo();
    const n = apply(none, stale);
    expectNoop(n.result, n.before);
    expect(captionOf(none, stale)).toBe("There's no proposal to discard");
  });

  it("is idempotent: discarding twice is a no-op the second time", () => {
    const s = fixture("demoPlan");
    const op = discard(pendingId(s));
    expect(REGISTRY.get("discardProposal")!.idempotent).toBe(true);
    const twice = apply(withDoc(s, after(apply(s, op))), op);
    expectNoop(twice.result, twice.before);
  });

  it("refuses an invalid payload", () => {
    const s = fixture("demoPlan");
    expectRejection(apply(s, discard("prp_" as ProposalId)).result, "invalid_payload");
    expectRejection(apply(s, { op: "discardProposal" }).result, "invalid_payload");
    expectRejection(apply(s, { ...discard(pendingId(s)), only: [] }).result, "invalid_payload");
  });
});
