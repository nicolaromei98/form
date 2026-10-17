// The step 9 ops (plan §11 row 9): addTask, updateTask, removeTask, addDependency and setView.
// For each: the happy path with its exact caption, the no-op (same reference plus noopCaption),
// and every rejection it can produce. Bridging and cycle captions are exact.
import { describe, expect, it } from "vitest";
import { seededMinter } from "@/lib/domain/ids";
import { DEPS_MAX, TASKS_MAX } from "@/lib/domain/limits";
import { compareKeys, nKeys, sortedByOrder } from "@/lib/domain/order";
import type { PersonId, TaskId } from "@/lib/domain/schema/ids";
import type { ProjectDoc, Task } from "@/lib/domain/schema/project";
import { REGISTRY } from "@/lib/ops/registry";
import {
  byId,
  DEMO_PEOPLE,
  demoState,
  FIXTURE_NOW,
  makePerson,
  makeTask,
  taskByTitle,
} from "../../../../../test/fixtures/v2/build";
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

const mint = seededMinter(77);
const demo = (): TestState => deepFreeze(demoState());
const project = (s: TestState) => projectOf(s);
const id = (s: TestState, title: string): TaskId => taskByTitle(project(s), title).id;
const after = (r: { result: { kind: string; doc: unknown } }) => r.result.doc as ProjectDoc;

/** A state whose active project is edited by `edit` */
function edited(state: TestState, edit: (p: ProjectDoc) => ProjectDoc): TestState {
  return deepFreeze(withDoc(state, edit(project(state))));
}

const addTask = (o: Record<string, unknown> = {}) => ({
  op: "addTask",
  taskId: mint("task"),
  title: "Copywriting",
  kind: "task",
  place: "end",
  dependsOn: [],
  estimateDays: null,
  priority: "medium",
  ownerId: null,
  ...o,
});

/* ------------------------------------------------------------------
   addTask
   ------------------------------------------------------------------ */

describe("addTask", () => {
  it("adds a To-do task at the end, stamped with ctx.now, and says so", () => {
    const s = demo();
    const op = addTask({ dependsOn: [id(s, "Development"), id(s, "Development")], estimateDays: 2.5, priority: "high" });
    const r = apply(s, op);
    const applied = expectApplied(r.result);
    const task = after(r).tasks[op.taskId as TaskId];
    expect(task).toMatchObject({
      title: "Copywriting",
      kind: "task",
      status: "todo",
      progress: 0,
      estimateDays: 2.5,
      allocation: 1,
      priority: "high",
      dependsOn: [id(s, "Development")],
      createdAt: FIXTURE_NOW,
      completedAt: null,
    });
    expect(sortedByOrder(after(r).tasks).at(-1)!.id).toBe(op.taskId);
    expectInverse(r.before, applied);
    expect(captionOf(s, op)).toBe("Copywriting added");
  });

  it("places a task at the start, after an anchor, or at the end when the anchor is gone", () => {
    const s = demo();
    const order = (p: ProjectDoc) => sortedByOrder(p.tasks).map((t) => t.title);
    const start = addTask({ title: "Kickoff", place: "start" });
    expect(order(after(apply(s, start)))).toEqual(["Kickoff", "Research", "Visual Direction", "UI Design", "Development"]);
    const between = addTask({ title: "Moodboard", place: { after: id(s, "Research") } });
    expect(order(after(apply(s, between)))).toEqual(["Research", "Moodboard", "Visual Direction", "UI Design", "Development"]);
    const missing = addTask({ title: "Launch", place: { after: mint("task") } });
    expect(order(after(apply(s, missing)))).toEqual(["Research", "Visual Direction", "UI Design", "Development", "Launch"]);
  });

  it("normalises a milestone: estimate 0 and allocation 1", () => {
    const s = demo();
    const op = addTask({ title: "Launch", kind: "milestone", estimateDays: 3 });
    const task = after(apply(s, op)).tasks[op.taskId as TaskId];
    expect(task).toMatchObject({ kind: "milestone", estimateDays: 0, allocation: 1, steps: [] });
  });

  it("adds the owner to the project's members", () => {
    const giulia = makePerson({ id: mint("person"), name: "Giulia", order: nKeys(4)[3] });
    const s = deepFreeze({ ...demoState(), workspace: { ...demoState().workspace, people: { ...demoState().workspace.people, [giulia.id]: giulia } } });
    const op = addTask({ ownerId: giulia.id });
    const p = after(apply(s, op));
    expect(p.tasks[op.taskId as TaskId].ownerId).toBe(giulia.id);
    expect(p.memberIds).toEqual([...project(s).memberIds, giulia.id]);
  });

  it("refuses a taken id, never re-minting it (not idempotent)", () => {
    const s = demo();
    expectRejection(apply(s, addTask({ taskId: id(s, "Research") })).result, "duplicate_id");
    const op = addTask();
    const once = withDoc(s, after(apply(s, op)));
    expect(REGISTRY.get("addTask")!.idempotent).toBe(false);
    expectRejection(apply(once, op).result, "duplicate_id");
  });

  it("refuses itself, a missing predecessor, and a missing or archived owner", () => {
    const s = demo();
    const taskId = mint("task");
    expectRejection(apply(s, addTask({ taskId, dependsOn: [taskId] })).result, "self_dependency");
    expectRejection(apply(s, addTask({ dependsOn: [mint("task")] })).result, "not_found");
    expectRejection(apply(s, addTask({ ownerId: mint("person") })).result, "invalid_reference");
    const archived = deepFreeze({
      ...demoState(),
      workspace: {
        ...demoState().workspace,
        people: { ...demoState().workspace.people, [DEMO_PEOPLE.luca]: { ...demoState().workspace.people[DEMO_PEOPLE.luca], archived: true } },
      },
    });
    const msg = expectRejection(apply(archived, addTask({ ownerId: DEMO_PEOPLE.luca })).result, "archived");
    expect(msg.message).toBe("Luca has left the team.");
  });

  it("refuses a task estimate of 0 and an invalid payload", () => {
    const s = demo();
    expectRejection(apply(s, addTask({ estimateDays: 0 })).result, "invalid_payload");
    expectRejection(apply(s, addTask({ title: "x".repeat(141) })).result, "invalid_payload");
    expectRejection(apply(s, addTask({ estimateDays: 2.7 })).result, "invalid_payload");
    expectRejection(apply(s, { ...addTask(), extra: true }).result, "invalid_payload");
  });

  it("refuses a 501st task", () => {
    const keys = nKeys(TASKS_MAX);
    const tasks: Task[] = keys.map((order, i) => makeTask({ id: mint("task"), title: `Task ${i + 1}`, order }));
    const s = edited(demo(), (p) => ({ ...p, tasks: byId(tasks) }));
    const r = expectRejection(apply(s, addTask()).result, "limit");
    expect(r.message).toBe("A project holds at most 500 tasks.");
  });
});

/* ------------------------------------------------------------------
   updateTask
   ------------------------------------------------------------------ */

describe("updateTask", () => {
  const update = (taskId: TaskId, field: string, value: unknown) => ({ op: "updateTask", taskId, field, value });

  it("marks a task done through the status table: 100%, completed now", () => {
    const s = demo();
    const r = apply(s, update(id(s, "UI Design"), "status", "done"));
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).tasks[id(s, "UI Design")]).toMatchObject({ status: "done", progress: 100, completedAt: FIXTURE_NOW });
    expect(captionOf(s, update(id(s, "UI Design"), "status", "done"))).toBe("UI Design → Done");
  });

  it("is a no-op, by reference, when nothing changes", () => {
    const s = demo();
    const op = update(id(s, "Research"), "status", "done");
    const r = apply(s, op);
    expectNoop(r.result, r.before);
    expect(REGISTRY.get("updateTask")!.idempotent).toBe(true);
    const result = run(s, [op]);
    expect(result.changed).toBe(false);
    expect(result.state.projects).toBe(s.projects);
    expect(result.caption).toEqual({ text: "Research is already done", tone: "info", undoable: false });
  });

  it("reads 'Mark UI Design done at 40%' as one state change: UI Design → Done", () => {
    const s = demo();
    const ui = id(s, "UI Design");
    const result = run(s, [update(ui, "progress", 40), update(ui, "status", "done")]);
    expect(result.caption?.text).toBe("UI Design → Done");
    expect(projectOf({ ...s, projects: result.state.projects as TestState["projects"] }).tasks[ui]).toMatchObject({ status: "done", progress: 100 });
  });

  it("follows the review step: 100% is In review when it is on", () => {
    const s = edited(demo(), (p) => ({ ...p, requireReview: true }));
    const p = after(apply(s, update(id(s, "UI Design"), "progress", 100)));
    expect(p.tasks[id(s, "UI Design")]).toMatchObject({ status: "review", progress: 100, completedAt: null });
  });

  it("starts a project still in planning when a task becomes active", () => {
    const s = edited(demo(), (p) => ({ ...p, status: "planning" }));
    const p = after(apply(s, update(id(s, "Development"), "progress", 10)));
    expect(p.status).toBe("active");
    expect(p.tasks[id(s, "Development")].status).toBe("active");
    expect(captionOf(s, update(id(s, "Development"), "progress", 10))).toBe("Development → In progress · 10%");
  });

  it("captions each field in the v0 wording", () => {
    const s = demo();
    const ui = id(s, "UI Design");
    expect(captionOf(s, update(id(s, "Research"), "title", "Discovery"))).toBe("Renamed to Discovery");
    expect(captionOf(s, update(ui, "priority", "low"))).toBe("Priority low");
    expect(captionOf(s, update(ui, "emphasis", true))).toBe("UI Design emphasised");
    expect(captionOf(s, update(ui, "estimateDays", 10))).toBe("Estimate 10d");
    expect(captionOf(s, update(ui, "estimateDays", null))).toBe("UI Design · estimate cleared");
    expect(captionOf(s, update(ui, "costCents", 240_000))).toBe("Cost €2,400");
    expect(captionOf(s, update(ui, "progress", 40))).toBe("Progress 40%");
    expect(captionOf(s, update(ui, "dueDate", "2026-10-16"))).toBe("UI Design due 16 Oct");
    expect(captionOf(s, update(ui, "allocation", 0.5))).toBe("UI Design · 50% allocation");
    expect(captionOf(s, update(ui, "tags", ["design", "client", "design"]))).toBe("UI Design · tagged design, client");
    expect(captionOf(s, update(id(s, "Development"), "kind", "milestone"))).toBe("Development is now a milestone");
  });

  it("drops proposed steps and estimates for a task that becomes a milestone", () => {
    const s = demo();
    const dev = id(s, "Development");
    const visual = id(s, "Visual Direction");
    const base = { id: mint("proposal"), createdAt: FIXTURE_NOW, source: "agent" as const };
    const steps = edited(s, (p) => ({ ...p, proposal: { ...base, kind: "subtasks", taskId: dev, items: [{ stepId: mint("step"), title: "Setup", estimateDays: 2 }] } }));
    const r1 = apply(steps, update(dev, "kind", "milestone"));
    expectInverse(r1.before, expectApplied(r1.result));
    expect(after(r1).proposal).toBeNull();
    const estimates = edited(s, (p) => ({
      ...p,
      proposal: { ...base, kind: "estimates", items: [{ taskId: visual, estimateDays: 3 }, { taskId: dev, estimateDays: 5 }] },
    }));
    const r2 = apply(estimates, update(dev, "kind", "milestone"));
    expect(after(r2).proposal).toMatchObject({ kind: "estimates", items: [{ taskId: visual, estimateDays: 3 }] });
  });

  it("deduplicates tags on write, so the same list again is a no-op", () => {
    const s = demo();
    const op = update(id(s, "UI Design"), "tags", ["design", "design"]);
    const once = withDoc(s, after(apply(s, op)));
    expect(project(once).tasks[id(s, "UI Design")].tags).toEqual(["design"]);
    const again = apply(once, op);
    expectNoop(again.result, again.before);
  });

  it("refuses a missing task, a 0 estimate and milestone violations", () => {
    const s = demo();
    expectRejection(apply(s, update(mint("task"), "status", "done")).result, "not_found");
    expectRejection(apply(s, update(id(s, "UI Design"), "estimateDays", 0)).result, "invalid_payload");
    expectRejection(apply(s, update(id(s, "UI Design"), "progress", 101)).result, "invalid_payload");
    // UI Design has started: it can't become a milestone
    expectRejection(apply(s, update(id(s, "UI Design"), "kind", "milestone")).result, "invalid_state");
    const ms = withDoc(s, after(apply(s, update(id(s, "Development"), "kind", "milestone"))));
    const dev = id(s, "Development");
    expect(project(ms).tasks[dev]).toMatchObject({ kind: "milestone", estimateDays: 0, allocation: 1 });
    const wait = expectRejection(apply(ms, update(dev, "estimateDays", 2)).result, "invalid_state");
    expect(wait.message).toBe("Development is a milestone: it takes no time.");
    expectRejection(apply(ms, update(dev, "allocation", 0.5)).result, "invalid_state");
    expectRejection(apply(ms, update(dev, "status", "active")).result, "invalid_state");
    expectRejection(apply(ms, update(dev, "progress", 50)).result, "invalid_state");
  });
});

/* ------------------------------------------------------------------
   removeTask
   ------------------------------------------------------------------ */

describe("removeTask", () => {
  const remove = (taskId: TaskId) => ({ op: "removeTask", taskId });

  it("bridges the chain and names the new link", () => {
    const s = demo();
    const r = apply(s, remove(id(s, "UI Design")));
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).tasks[id(s, "Development")].dependsOn).toEqual([id(s, "Visual Direction")]);
    expect(Object.hasOwn(after(r).tasks, id(s, "UI Design"))).toBe(false);
    expect(captionOf(s, remove(id(s, "UI Design")))).toBe("UI Design removed · Development now follows Visual Direction");
  });

  it("says nothing more when no dependent inherits anything", () => {
    const s = demo();
    expect(captionOf(s, remove(id(s, "Development")))).toBe("Development removed");
    // Research has no predecessor: Visual Direction simply stops waiting
    expect(captionOf(s, remove(id(s, "Research")))).toBe("Research removed");
  });

  it("names several inherited predecessors and counts the other dependents", () => {
    const s = edited(demo(), (p) => {
      const qa = makeTask({ id: mint("task"), title: "QA", order: nKeys(6)[5], dependsOn: [taskByTitle(p, "UI Design").id] });
      const ui = taskByTitle(p, "UI Design");
      const research = taskByTitle(p, "Research").id;
      return { ...p, tasks: { ...p.tasks, [qa.id]: qa, [ui.id]: { ...ui, dependsOn: [taskByTitle(p, "Visual Direction").id, research] } } };
    });
    expect(captionOf(s, remove(id(s, "UI Design")))).toBe(
      "UI Design removed · Development now follows Visual Direction and Research · 1 more task re-linked",
    );
  });

  it("clears the focus pin, prunes the proposal and deletes the brief edits keyed to the task, all undoable", () => {
    const base = namedFixture("demoProposal");
    const ui = taskByTitle(projectOf(base), "UI Design").id;
    const s = edited(base, (p) => ({
      ...p,
      viewConfig: { ...p.viewConfig, focusPin: ui },
      brief: {
        ...p.brief,
        edits: {
          [`client:risks:${ui}`]: { text: "", basis: "UI Design is urgent." },
          [`team:moving:${ui}`]: { text: "Screens are moving.", basis: "UI Design is in progress." },
          "client:head:status": { text: "All good.", basis: "On track." },
        },
      },
    }));
    const r = apply(s, remove(ui));
    const applied = expectApplied(r.result);
    expect(after(r).viewConfig.focusPin).toBeNull();
    expect(after(r).proposal).toBeNull();
    expect(Object.keys(after(r).brief.edits)).toEqual(["client:head:status"]);
    expectInverse(r.before, applied);
  });

  it("drops the task from a reassign proposal, which empties to nothing", () => {
    const s = deepFreeze(namedFixture("demoPlan"));
    const p = after(apply(s, remove(taskByTitle(projectOf(s), "UI Design").id)));
    expect(p.proposal).toBeNull();
  });

  it("bridges the seeds of a plan proposal that wait on the task", () => {
    const s = edited(demo(), (p) => ({
      ...p,
      proposal: {
        id: mint("proposal"),
        createdAt: FIXTURE_NOW,
        source: "agent",
        kind: "plan",
        tasks: [
          {
            taskId: mint("task"),
            title: "QA",
            kind: "task",
            estimateDays: null,
            dependsOn: [taskByTitle(p, "UI Design").id],
            status: "todo",
            priority: "medium",
            progress: 0,
            ownerId: null,
            emphasis: false,
            steps: [],
          },
        ],
      },
    }));
    const p = after(apply(s, remove(id(s, "UI Design"))));
    expect(p.proposal?.kind === "plan" && p.proposal.tasks[0].dependsOn).toEqual([id(s, "Visual Direction")]);
  });

  it("refuses a missing task, and a bridge past 50 dependencies", () => {
    const s = demo();
    expectRejection(apply(s, remove(mint("task"))).result, "not_found");
    expect(REGISTRY.get("removeTask")!.idempotent).toBe(false);

    // X waits on 30 tasks; D waits on X and on 30 others: bridging would give D 60
    const keys = nKeys(62);
    const ups = keys.slice(0, 30).map((order, i) => makeTask({ id: mint("task"), title: `Up ${i}`, order }));
    const side = keys.slice(30, 60).map((order, i) => makeTask({ id: mint("task"), title: `Side ${i}`, order }));
    const x = makeTask({ id: mint("task"), title: "X", order: keys[60], dependsOn: ups.map((t) => t.id) });
    const d = makeTask({ id: mint("task"), title: "D", order: keys[61], dependsOn: [x.id, ...side.map((t) => t.id)] });
    const big = edited(demo(), (p) => ({ ...p, tasks: byId([...ups, ...side, x, d]) }));
    const r = expectRejection(apply(big, remove(x.id)).result, "limit");
    expect(r.message).toBe(`Removing X would leave D waiting on over ${DEPS_MAX} tasks.`);
  });
});

/* ------------------------------------------------------------------
   addDependency
   ------------------------------------------------------------------ */

describe("addDependency", () => {
  const dep = (taskId: TaskId, dependsOnId: TaskId) => ({ op: "addDependency", taskId, dependsOnId });

  it("makes a task wait on another", () => {
    const s = demo();
    const op = dep(id(s, "Development"), id(s, "Research"));
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).tasks[id(s, "Development")].dependsOn).toEqual([id(s, "UI Design"), id(s, "Research")]);
    expect(captionOf(s, op)).toBe("Development now waits on Research");
  });

  it("is a no-op when the dependency exists", () => {
    const s = demo();
    const op = dep(id(s, "Development"), id(s, "UI Design"));
    const r = apply(s, op);
    expectNoop(r.result, r.before);
    expect(captionOf(s, op)).toBe("Development already waits on UI Design");
  });

  it("names the loop it would close, shortest first", () => {
    const s = demo();
    const short = expectRejection(apply(s, dep(id(s, "UI Design"), id(s, "Development"))).result, "cycle");
    expect(short.message).toBe("That would create a loop: Development → UI Design → Development.");
    const long = expectRejection(apply(s, dep(id(s, "Research"), id(s, "Development"))).result, "cycle");
    expect(long.message).toBe("That would create a loop: Development → UI Design → Visual Direction → Research → Development.");
    expect(captionOf(s, dep(id(s, "UI Design"), id(s, "Development")))).toBe(
      "Couldn't apply that: That would create a loop: Development → UI Design → Development.",
    );
  });

  it("keeps a loop of long titles within 140 characters", () => {
    const s = edited(demo(), (p) => ({
      ...p,
      tasks: Object.fromEntries(Object.entries(p.tasks).map(([k, t]) => [k, { ...t, title: `${t.title} ${"and more words ".repeat(8).trim()}` }])),
    }));
    const r = expectRejection(apply(s, dep(sortedByOrder(project(s).tasks)[0].id, sortedByOrder(project(s).tasks)[3].id)).result, "cycle");
    expect(r.message.startsWith("That would create a loop: ")).toBe(true);
    expect(r.message.length).toBeLessThanOrEqual(140);
  });

  it("refuses itself, a missing task and a 51st dependency", () => {
    const s = demo();
    expectRejection(apply(s, dep(id(s, "UI Design"), id(s, "UI Design"))).result, "self_dependency");
    expectRejection(apply(s, dep(id(s, "UI Design"), mint("task"))).result, "not_found");
    expectRejection(apply(s, dep(mint("task"), id(s, "UI Design"))).result, "not_found");

    const keys = nKeys(DEPS_MAX + 2);
    const ups = keys.slice(0, DEPS_MAX + 1).map((order, i) => makeTask({ id: mint("task"), title: `Up ${i}`, order }));
    const t = makeTask({ id: mint("task"), title: "Busy", order: keys[DEPS_MAX + 1], dependsOn: ups.slice(0, DEPS_MAX).map((u) => u.id) });
    const busy = edited(demo(), (p) => ({ ...p, tasks: byId([...ups, t]) }));
    expectRejection(apply(busy, dep(t.id, ups[DEPS_MAX].id)).result, "limit");
  });
});

/* ------------------------------------------------------------------
   setView
   ------------------------------------------------------------------ */

describe("setView", () => {
  const set = (patch: Record<string, unknown>) => ({ op: "setView", patch });
  const vc = (r: ReturnType<typeof apply>) => after(r).viewConfig;

  it("changes view options, hidden from Activity, with the v0 wording", () => {
    const s = demo();
    const r = apply(s, set({ density: "compact", sort: "priority" }));
    expectInverse(r.before, expectApplied(r.result));
    expect(vc(r)).toMatchObject({ density: "compact", sort: "priority" });
    expect(REGISTRY.get("setView")!.activity).toBe("hide");
    expect(captionOf(s, set({ density: "compact", sort: "priority" }))).toBe("Compact · Sorted by priority");
    expect(captionOf(s, set({ hideDone: true, highlightUrgent: true }))).toBe("Completed hidden · Urgent highlighted");
    expect(captionOf(s, set({ fields: { estimate: false, owner: true } }))).toBe("Estimates hidden · Owners visible");
  });

  it("keeps the v0 coupling of columns and layout", () => {
    const s = demo();
    expect(vc(apply(s, set({ columns: 1 })))).toMatchObject({ layout: "list", columns: 1 });
    expect(vc(apply(s, set({ columns: 2 })))).toMatchObject({ layout: "grid", columns: 2 });
    expect(captionOf(s, set({ columns: 2 }))).toBe("2 columns");
    const oneColumn = withDoc(s, after(apply(s, set({ columns: 1 }))));
    expect(vc(apply(oneColumn, set({ layout: "grid" })))).toMatchObject({ layout: "grid", columns: null });
    const twoColumns = withDoc(s, after(apply(s, set({ columns: 2 }))));
    expect(vc(apply(twoColumns, set({ layout: "list" })))).toMatchObject({ layout: "list", columns: null });
    expect(captionOf(s, set({ layout: "list" }))).toBe("List");
  });

  it("is idempotent and a no-op by reference", () => {
    const s = demo();
    const op = set({ density: "compact" });
    const once = withDoc(s, after(apply(s, op)));
    const again = apply(once, op);
    expectNoop(again.result, again.before);
    expect(captionOf(once, op)).toBe("The cards are already compact");
    const empty = apply(s, set({}));
    expectNoop(empty.result, empty.before);
  });

  it("deduplicates filters and partial fields", () => {
    const s = demo();
    const r = apply(s, set({ filters: { ownerIds: [DEMO_PEOPLE.sara, DEMO_PEOPLE.sara, "none"], statuses: ["todo", "todo"] }, fields: { cost: true } }));
    expect(vc(r).filters).toMatchObject({ ownerIds: [DEMO_PEOPLE.sara, "none"], statuses: ["todo"], due: "any" });
    expect(vc(r).fields).toMatchObject({ priority: true, cost: true });
    expect(captionOf(s, set({ filters: { statuses: ["todo"] } }))).toBe("Filtered by status");
  });

  it("speaks for the brief through the show caption when the brief is shown", () => {
    const s = demo();
    expect(captionOf(s, set({ briefAudience: "team" }))).toBe("Brief for the team");
    expect(captionOf(s, set({ briefAudience: "team" }), { local: [{ kind: "show", view: "brief" }] })).toBe(
      "Status brief · for the team · composed from the project, nothing invented",
    );
    expect(captionOf(s, set({ briefAudience: "client" }))).toBe("Already the client brief");
  });

  it("refuses invalid options", () => {
    const s = demo();
    expectRejection(apply(s, set({ columns: 5 })).result, "invalid_payload");
    expectRejection(apply(s, set({ focusPin: null })).result, "invalid_payload");
    expectRejection(apply(s, { op: "setView" }).result, "invalid_payload");
  });
});

/* ------------------------------------------------------------------
   Determinism across the five
   ------------------------------------------------------------------ */

describe("the five ops", () => {
  it("never depend on record key order", () => {
    const s = demo();
    const reversed = edited(s, (p) => ({ ...p, tasks: Object.fromEntries(Object.entries(p.tasks).reverse()) }));
    const ops = [
      addTask({ place: { after: id(s, "Research") } }),
      { op: "removeTask", taskId: id(s, "UI Design") },
      { op: "addDependency", taskId: id(s, "Development"), dependsOnId: id(s, "Research") },
    ];
    for (const op of ops) {
      const a = apply(s, op).result;
      const b = apply(reversed, op).result;
      expect(b.doc).toEqual(a.doc);
      if (a.kind === "applied" && b.kind === "applied") {
        const sorted = (patches: typeof a.patches) => patches.map((x) => JSON.stringify(x)).sort(compareKeys);
        expect(sorted(b.patches)).toEqual(sorted(a.patches));
      }
    }
  });

  it("name Development's owner the same way after any of them", () => {
    // Owners are references only: the reducer never resolves or rewrites them (Q7)
    const s = demo();
    const r = apply(s, { op: "updateTask", taskId: id(s, "Development"), field: "status", value: "active" });
    expect(after(r).tasks[id(s, "Development")].ownerId).toBe(DEMO_PEOPLE.luca as PersonId);
  });
});
