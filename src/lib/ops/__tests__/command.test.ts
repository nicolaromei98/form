// Commands across documents (plan §5.7): partition, targets, the command limit, local effects
// and their normalisation, commits sharing a group id, and the rebalance check.
import { describe, expect, it } from "vitest";
import { seededMinter } from "@/lib/domain/ids";
import { ORDER_KEY_REBALANCE } from "@/lib/domain/limits";
import { nKeys } from "@/lib/domain/order";
import { CommitSchema } from "@/lib/domain/schema/commit";
import type { TaskId } from "@/lib/domain/schema/ids";
import { toCommits } from "@/lib/ops/command";
import { byId, demoState, emptyState, FIXTURE_NOW, indexEntry, makeProject, makeTask, taskByTitle } from "../../../../test/fixtures/v2/build";
import { deepFreeze, expectRejection, projectOf, run, type TestState } from "../registry/__tests__/support";

const mint = seededMinter(11);
const demo = (): TestState => deepFreeze(demoState());
const id = (s: TestState, title: string): TaskId => taskByTitle(projectOf(s), title).id;
const update = (taskId: TaskId, field: string, value: unknown) => ({ op: "updateTask", taskId, field, value });
const addTask = (title: string) => ({
  op: "addTask",
  taskId: mint("task"),
  title,
  kind: "task",
  place: "end",
  dependsOn: [],
  estimateDays: null,
  priority: "medium",
  ownerId: null,
});

describe("runCommand", () => {
  it("commits a changed project with group and commit ids, and keeps the workspace", () => {
    const s = demo();
    const r = run(s, [update(id(s, "UI Design"), "priority", "low")]);
    expect(r.changed).toBe(true);
    expect(r.groupId).toBe("00000000-0000-4000-8000-000000000001");
    expect(r.commits).toHaveLength(1);
    expect(r.commits[0]).toMatchObject({ docId: s.projectId, id: "00000000-0000-4000-8000-000000000002" });
    expect(r.state.workspace).toBe(s.workspace);
    expect(r.caption).toEqual({ text: "Priority low", tone: "done", undoable: true });
  });

  it("changes nothing, by reference, when no op applies", () => {
    const s = demo();
    const r = run(s, [update(id(s, "Research"), "status", "done")]);
    expect(r.changed).toBe(false);
    expect(r.groupId).toBeNull();
    expect(r.commits).toEqual([]);
    expect(r.state).toEqual({ workspace: s.workspace, projects: s.projects });
    expect(r.state.projects).toBe(s.projects);
  });

  it("runs workspace ops first, stably, and refuses unknown ones there", () => {
    const s = demo();
    const r = run(s, [addTask("Copywriting"), { op: "renameTool", title: "x" }]);
    expect(r.outcomes.map((o) => o.result.kind)).toEqual(["rejected", "applied"]);
    expectRejection(r.outcomes[0].result, "unknown_op");
    expect(r.caption?.text).toBe("Copywriting added · Couldn't apply one change: FORM doesn't know that change.");
  });

  it("refuses project ops without a project", () => {
    const s = deepFreeze(emptyState());
    const r = run(s, [addTask("Copywriting")]);
    expect(r.changed).toBe(false);
    const rejection = expectRejection(r.outcomes[0].result, "no_project");
    expect(rejection.message).toBe("Create a project first.");
    expect(r.caption).toEqual({ text: "Couldn't apply that: Create a project first.", tone: "unsupported", undoable: false });
  });

  it("refuses every op of a command over 12 non-system ops, across documents", () => {
    const s = demo();
    const ops = Array.from({ length: 13 }, (_, i) => addTask(`Task ${i}`));
    const r = run(s, ops);
    expect(r.changed).toBe(false);
    expect(r.outcomes).toHaveLength(13);
    for (const o of r.outcomes) expectRejection(o.result, "limit");
  });

  it("applies local intents after the commits and keeps them inside the project", () => {
    const s = demo();
    const ui = id(s, "UI Design");
    const shown = run(s, [], { local: [{ kind: "show", view: "cards" }, { kind: "select", taskId: ui }, { kind: "zoom", zoom: "week" }] });
    expect(shown.changed).toBe(false);
    expect(shown.local).toEqual({ activeView: "cards", selectedTaskId: ui, timelineZoom: "week" });
    expect(shown.caption).toEqual({ text: "Tracker · Timeline · weeks", tone: "done", undoable: false });

    // A view the project doesn't have falls back home; a removed selection clears
    const away = run(s, [{ op: "removeTask", taskId: ui }], {
      local: [{ kind: "show", view: "team" }],
      ctx: { local: { activeView: "cards", selectedTaskId: ui, timelineZoom: "day" } },
    });
    expect(away.local).toEqual({ activeView: "cards", selectedTaskId: null, timelineZoom: "day" });
  });

  it("moves to the latest live project when the active one is deleted", () => {
    const s = demo();
    const older = makeProject({ id: mint("project"), workspaceId: s.workspace.id, title: "Older", createdAt: "2026-01-01T00:00:00Z" as typeof FIXTURE_NOW });
    const deleted = { ...indexEntry(s.projectId!), deletedAt: FIXTURE_NOW };
    const state = deepFreeze({
      workspace: { ...s.workspace, projects: { [s.projectId!]: deleted, [older.id]: indexEntry(older.id, older.createdAt) } },
      projects: { ...s.projects, [older.id]: older },
      projectId: s.projectId,
    });
    const r = run(state, [update(id(s, "UI Design"), "priority", "low")]);
    expectRejection(r.outcomes[0].result, "no_project");
    expect(r.projectId).toBe(older.id);
    expect(r.local.activeView).toBe("cards");
  });

  it("is quiet for direct edits unless something is refused", () => {
    const s = demo();
    expect(run(s, [update(id(s, "UI Design"), "priority", "low")], { caption: false }).caption).toBeNull();
    expect(run(s, [update(mint("task"), "priority", "low")], { caption: false }).caption?.text).toBe(
      "Couldn't apply that: That task isn't in this project anymore.",
    );
  });

  it("lets a clarify reply speak instead", () => {
    const s = demo();
    const r = run(s, [], { reply: { tone: "clarify", text: "Sort by what? Priority, progress, status, name or duration." } });
    expect(r.caption).toEqual({ text: "Sort by what? Priority, progress, status, name or duration.", tone: "clarify", undoable: false });
  });

  it("writes §10.2 commits: applied registry ops only, sharing the group id", () => {
    const s = demo();
    const ops = [update(id(s, "UI Design"), "priority", "low"), { op: "removeTask", taskId: mint("task") }, addTask("Copywriting")];
    const r = run(s, ops, { text: "Make UI Design low priority and add Copywriting", local: [{ kind: "show", view: "cards" }] });
    const commits = toCommits(r, { source: "agent", text: "Make UI Design low priority and add Copywriting" }, { now: FIXTURE_NOW, actorId: null }, () => 7);
    expect(commits).toHaveLength(1);
    expect(CommitSchema.safeParse(commits[0]).success).toBe(true);
    expect(commits[0]).toMatchObject({ groupId: r.groupId, docId: s.projectId, baseVersion: 7, source: "agent", createdAt: FIXTURE_NOW });
    expect(commits[0].ops.map((o) => (o as { op: string }).op)).toEqual(["updateTask", "addTask"]);
    expect(toCommits(run(s, [update(id(s, "Research"), "status", "done")]), { source: "direct", text: null }, { now: FIXTURE_NOW, actorId: null }, () => 0)).toEqual([]);
  });

  it("appends rebalanceOrder when an order key passes 48 characters", () => {
    const long = `a0${"V".repeat(ORDER_KEY_REBALANCE - 1)}`;
    const keys = nKeys(2);
    const a = makeTask({ id: mint("task"), title: "A", order: keys[0] });
    const b = makeTask({ id: mint("task"), title: "B", order: long < keys[1] ? long : keys[1] });
    const s = demo();
    const state = deepFreeze({ ...s, projects: { [s.projectId!]: { ...projectOf(s), tasks: byId([a, b]) } } });
    const r = run(state, [update(a.id, "priority", "low")]);
    const results = r.commits[0].result.results;
    expect(results.at(-1)?.op).toMatchObject({ op: "rebalanceOrder" });
    expect(results.at(-1)?.kind).toBe("applied");
    expect(r.caption?.text).toBe("Priority low");
  });
});
