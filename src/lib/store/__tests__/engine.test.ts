// The store engine (plan §5.7, §5.8): commands with the real planning engine, history entries,
// undo and redo by patches across documents (spawned projects included), the landing view after
// undo, gestures recomputed from their base, and the Phase 2 touched paths.
import { applyPatches, type Patch } from "immer";
import { describe, expect, it } from "vitest";
import { seededMinter } from "@/lib/domain/ids";
import { ORDER_KEY_REBALANCE } from "@/lib/domain/limits";
import { nKeys } from "@/lib/domain/order";
import { defaultLocalViewState, type LocalViewState } from "@/lib/domain/schema/local";
import type { ProjectId, TaskId } from "@/lib/domain/schema/ids";
import { createDemoProject } from "@/lib/demo/seed";
import { fastParse, toCommand } from "@/lib/interpret/fast";
import type { Command } from "@/lib/ops/command";
import { makeOp, updateTaskOp } from "@/lib/ops/build";
import type { Op } from "@/lib/ops/registry";
import {
  beginGesture,
  CAPTION_PLANNING,
  coalesce,
  type DocsState,
  endGesture,
  type EngineCtx,
  historyEntry,
  landing,
  liveGesture,
  parserContext,
  pathsTouched,
  redo,
  run,
  undo,
  type Where,
} from "@/lib/store/engine";
import { activeProject, byId, demoState, emptyState, FIXTURE_NOW, FIXTURE_TODAY, makeTask, taskByTitle } from "../../../../test/fixtures/v2/build";

function ctx(): EngineCtx {
  let n = 0;
  return { now: FIXTURE_NOW, actorId: null, today: FIXTURE_TODAY, newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` };
}

const command = (ops: readonly Op[], o: Partial<Command> = {}): Command => ({ ops, local: [], notes: [], notices: [], source: "direct", text: null, ...o });

function demo(views: LocalViewState["activeView"][] = ["cards"]) {
  const state = demoState({ views });
  const docs: DocsState = { workspace: state.workspace, projects: state.projects };
  const project = activeProject(state);
  const where: Where = { projectId: project.id, local: defaultLocalViewState(project) };
  return { docs, project, where };
}

describe("CAPTION_PLANNING", () => {
  it("reads the demo lanes and focus from the planning engine", () => {
    const { docs, project } = demo();
    const lanes = CAPTION_PLANNING.lanes(project, docs.workspace, [project], FIXTURE_TODAY);
    const marta = lanes.find((l) => l.personId === "per_demomarta")!;
    expect([marta.days, marta.capacity, marta.over]).toEqual([10, 6, 4]);
    expect(CAPTION_PLANNING.focus(project, docs.workspace, FIXTURE_TODAY)?.pick?.taskId).toBe(taskByTitle(project, "UI Design").id);
  });

  it("gives an archived project its own lanes", () => {
    const { docs, project } = demo();
    const lanes = CAPTION_PLANNING.lanes(project, docs.workspace, [], FIXTURE_TODAY);
    expect(lanes.find((l) => l.personId === "per_demomarta")?.days).toBe(10);
  });
});

describe("history entries", () => {
  it("are made only when something changed", () => {
    const { docs, project, where } = demo();
    const research = taskByTitle(project, "Research");
    const noop = run(docs, command([updateTaskOp(research.id, "status", "done")]), where, ctx());
    expect(noop.changed).toBe(false);
    expect(historyEntry(noop, "noop", { ...where, docs })).toBeNull();
    const applied = run(docs, command([updateTaskOp(research.id, "priority", "high")]), where, ctx());
    const entry = historyEntry(applied, "priority", { ...where, docs })!;
    expect(entry.commits).toHaveLength(1);
    expect(entry.after).toBe(applied.state);
    expect(entry.localBefore).toBe(where.local);
  });

  it("undo and redo across the workspace and project commits of one command", () => {
    const { docs, project, where } = demo();
    const dev = taskByTitle(project, "Development");
    const giulia = seededMinter(9)("person");
    const ops: Op[] = [
      makeOp({ op: "addPerson", personId: giulia, name: "Giulia", role: null, email: null, capacityDaysPerWeek: null, dayRateCents: null }),
      makeOp({ op: "assignTask", taskId: dev.id, personId: giulia }),
    ];
    const result = run(docs, command(ops), where, ctx());
    expect(result.commits.map((c) => c.docId)).toEqual([docs.workspace.id, project.id]);
    const entry = historyEntry(result, "assign", { ...where, docs })!;
    const undone = undo(result.state, entry);
    expect(undone).toEqual(docs);
    const redone = redo(undone, entry);
    expect(redone).toEqual(result.state);
  });

  it("drops spawned projects on undo and brings the same documents back on redo", () => {
    const empty = emptyState();
    const docs: DocsState = { workspace: empty.workspace, projects: {} };
    const where: Where = { projectId: null, local: defaultLocalViewState(null) };
    const ops = createDemoProject({ workspace: docs.workspace, project: null }, { title: "New website", startAs: "timeline", wantsMoodboard: true, replace: false }, seededMinter(3));
    const result = run(docs, command(ops), where, ctx());
    expect(result.spawned).toHaveLength(1);
    const spawned = result.spawned[0];
    const entry = historyEntry(result, "create", { ...where, docs })!;
    expect(entry.projectAfter).toBe(spawned.id);

    const undone = undo(result.state, entry);
    expect(undone.projects).toEqual({});
    expect(undone.workspace).toEqual(docs.workspace);
    const redone = redo(undone, entry);
    expect(redone).toEqual(result.state);
    // The moodboard block was added to the spawned project in the same command
    expect(redone.projects[spawned.id].blocks).toContain("moodboard");
    expect(landing(redone, entry, "after", { projectId: null, local: where.local })).toEqual({ projectId: spawned.id, local: result.local });
    expect(landing(undone, entry, "before", { projectId: spawned.id, local: result.local }).projectId).toBeNull();
  });

  it("undo the runner's appended rebalanceOrder with the commit's own patches", () => {
    const { docs, project } = demo();
    const mint = seededMinter(8);
    const long = `a0${"V".repeat(ORDER_KEY_REBALANCE - 1)}`;
    const keys = nKeys(2);
    const a = makeTask({ id: mint("task"), title: "A", order: keys[0] });
    const b = makeTask({ id: mint("task"), title: "B", order: long < keys[1] ? long : keys[1] });
    const start: DocsState = { ...docs, projects: { [project.id]: { ...project, tasks: byId([a, b]) } } };
    const where: Where = { projectId: project.id, local: defaultLocalViewState(project) };
    const result = run(start, command([updateTaskOp(a.id, "priority", "low")]), where, ctx());
    expect(result.commits[0].result.results.map((r) => r.op)).toMatchObject([{ op: "updateTask" }, { op: "rebalanceOrder" }]);
    const entry = historyEntry(result, "priority", { ...where, docs: start })!;
    expect(entry.commits).toHaveLength(1);
    const commit = entry.commits[0];
    expect(result.state.projects[project.id].tasks[b.id].order.length).toBeLessThan(long.length);
    // The commit-level inverse undoes both ops: the priority and the new keys
    expect(applyPatches(commit.after, commit.inverse as Patch[])).toEqual(start.projects[project.id]);
    const undone = undo(result.state, entry);
    expect(undone.projects[project.id]).toBe(start.projects[project.id]);
    expect(redo(undone, entry).projects[project.id]).toBe(result.state.projects[project.id]);
  });

  it("refuses, in development, to undo from a state the entry didn't leave", () => {
    const { docs, project, where } = demo();
    const ui = taskByTitle(project, "UI Design");
    const first = run(docs, command([updateTaskOp(ui.id, "priority", "low")]), where, ctx());
    const entry = historyEntry(first, "first", { ...where, docs })!;
    const second = run(first.state, command([updateTaskOp(ui.id, "title", "Screens")]), where, ctx());
    expect(() => undo(second.state, entry)).toThrow(/didn't leave/);
  });

  it("returns to the previous tab when undoing a command that added and showed a view (Q6)", () => {
    const { docs, project, where } = demo();
    const parsed = fastParse("Add a timeline", parserContext({ docs, projectId: project.id, local: where.local, today: FIXTURE_TODAY, mint: seededMinter(1) }));
    const cmd = toCommand(parsed, "Add a timeline")!;
    const result = run(docs, cmd, where, ctx());
    expect(result.local.activeView).toBe("timeline");
    const entry = historyEntry(result, "Add a timeline", { ...where, docs })!;
    const undone = undo(result.state, entry);
    const back = landing(undone, entry, "before", { projectId: project.id, local: result.local });
    expect(undone.projects[project.id].views).toEqual(["cards"]);
    expect(back.local.activeView).toBe("cards");
    // Redo shows the timeline again
    const redone = redo(undone, entry);
    expect(landing(redone, entry, "after", back).local.activeView).toBe("timeline");
  });

  it("keeps a tab the user picked afterwards when the command didn't change the view", () => {
    const { docs, project } = demo(["cards", "board"]);
    const where: Where = { projectId: project.id, local: defaultLocalViewState(project) };
    const ui = taskByTitle(project, "UI Design");
    const result = run(docs, command([updateTaskOp(ui.id, "priority", "low")]), where, ctx());
    const entry = historyEntry(result, "priority", { ...where, docs })!;
    const now: Where = { projectId: project.id, local: { ...result.local, activeView: "board" } };
    expect(landing(undo(result.state, entry), entry, "before", now).local.activeView).toBe("board");
  });
});

describe("gestures", () => {
  it("coalesce by op, entity and field, last value wins, in the order of last appearance", () => {
    const a = "tsk_aaaaaaaaaaaaaaaa" as TaskId;
    const b = "tsk_bbbbbbbbbbbbbbbb" as TaskId;
    const ops = coalesce([updateTaskOp(a, "progress", 40), updateTaskOp(b, "progress", 10), updateTaskOp(a, "status", "active"), updateTaskOp(a, "progress", 60)]);
    expect(ops).toEqual([updateTaskOp(b, "progress", 10), updateTaskOp(a, "status", "active"), updateTaskOp(a, "progress", 60)]);
  });

  it("merge the patches of patch-shaped ops", () => {
    const itemId = "mdi_aaaaaaaaaaaaaaaa" as never;
    const ops = coalesce([
      makeOp({ op: "updateMoodItem", itemId, patch: { x: 0.1, y: 0.2 }, toFront: true }),
      makeOp({ op: "updateMoodItem", itemId, patch: { x: 0.3 }, toFront: false }),
    ]);
    expect(ops).toEqual([{ op: "updateMoodItem", itemId, patch: { x: 0.3, y: 0.2 }, toFront: true }]);
  });

  it("recompute every frame from the base and seal into one entry", () => {
    const { docs, project, where } = demo();
    const ui = taskByTitle(project, "UI Design");
    let g = beginGesture(docs, where);
    g = liveGesture(g, [updateTaskOp(ui.id, "progress", 50)], ctx());
    expect(g.state.projects[project.id].tasks[ui.id].progress).toBe(50);
    expect(g.base).toBe(docs);
    g = liveGesture(g, [updateTaskOp(ui.id, "progress", 70)], ctx());
    expect(g.ops).toHaveLength(1);
    expect(g.state.projects[project.id].tasks[ui.id].progress).toBe(70);
    const sealed = endGesture(g, [], ctx())!;
    const entry = historyEntry(sealed, "drag", { ...where, docs })!;
    expect(entry.commits[0].patches.length).toBeGreaterThan(0);
    expect(sealed.state.projects[project.id].tasks[ui.id].progress).toBe(70);
    // The sealed command is exactly a direct commit of the coalesced ops from the base
    const direct = run(docs, command([updateTaskOp(ui.id, "progress", 70)], { caption: false }), where, ctx());
    expect(sealed.state).toEqual(direct.state);
    expect(undo(sealed.state, entry)).toEqual(docs);
  });

  it("leave no entry when review@90 is dragged to 100 and back to 90", () => {
    const { docs, project } = demo();
    const visual = taskByTitle(project, "Visual Direction");
    const at90 = run(docs, command([updateTaskOp(visual.id, "progress", 90)]), { projectId: project.id, local: defaultLocalViewState(project) }, ctx());
    const where: Where = { projectId: project.id, local: at90.local };
    expect(at90.state.projects[project.id].tasks[visual.id]).toMatchObject({ status: "review", progress: 90 });
    let g = beginGesture(at90.state, where);
    g = liveGesture(g, [updateTaskOp(visual.id, "progress", 100)], ctx());
    expect(g.state.projects[project.id].tasks[visual.id].status).toBe("done");
    g = liveGesture(g, [updateTaskOp(visual.id, "progress", 90)], ctx());
    expect(g.state.projects[project.id].tasks[visual.id]).toMatchObject({ status: "review", progress: 90 });
    const sealed = endGesture(g, [], ctx())!;
    expect(sealed.changed).toBe(false);
    expect(sealed.state).toBe(at90.state);
    expect(historyEntry(sealed, "drag", { ...where, docs: at90.state })).toBeNull();
  });

  it("restore the base when cancelled", () => {
    const { docs, project, where } = demo();
    const g = liveGesture(beginGesture(docs, where), [updateTaskOp(taskByTitle(project, "UI Design").id, "progress", 50)], ctx());
    expect(endGesture(g, null, ctx())).toBeNull();
  });

  it("apply workspace ops before project ops in a frame", () => {
    const { docs, project, where } = demo();
    const marta = "per_demomarta" as never;
    const g = liveGesture(beginGesture(docs, where), [makeOp({ op: "updatePerson", personId: marta, field: "capacityDaysPerWeek", value: 3 })], ctx());
    expect(g.state.workspace.people[marta].capacityDaysPerWeek).toBe(3);
    expect(g.state.projects).toBe(docs.projects);
    expect(project.id).toBeTruthy();
  });
});

describe("pathsTouched", () => {
  it("cuts each path at its first array index, sorted and unique", () => {
    const { docs, project, where } = demo();
    const ui = taskByTitle(project, "UI Design");
    const stepId = seededMinter(5)("step");
    const result = run(
      docs,
      command([
        makeOp({ op: "addStep", taskId: ui.id, stepId, title: "Wireframes", estimateDays: null, after: "end" }),
        updateTaskOp(ui.id, "priority", "low"),
      ]),
      where,
      ctx(),
    );
    const patches = result.commits[0].result.patches;
    expect(pathsTouched(patches)).toEqual([
      ["tasks", ui.id, "priority"],
      ["tasks", ui.id, "steps"],
    ]);
    expect((Object.keys(result.state.projects) as ProjectId[]).length).toBe(1);
  });
});
