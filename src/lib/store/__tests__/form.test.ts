// The store (plan §8.1, §10.2): submit with the beat and the creation phase, no-ops without an
// entry, Q6 (tabs are local; undoing addView returns to the previous tab), undo and redo across
// documents with spawned projects, gestures, reset, proposals, and the action creators.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HISTORY_LIMIT } from "@/lib/domain/limits";
import { CREATE_TOTAL_MS, PROCESS_BEAT_MS } from "@/lib/motion";
import { updateTaskOp } from "@/lib/ops/build";
import { makeActions } from "@/lib/store/actions";
import { GESTURE_IDLE_MS } from "@/lib/store/form";
import { demoState, taskByTitle } from "../../../../test/fixtures/v2/build";
import { demoStore, emptyDemo, NOW_MS, openProject, storeOn } from "./support";

beforeEach(() => {
  vi.useFakeTimers({ now: NOW_MS });
});
afterEach(() => {
  vi.useRealTimers();
});

/** Submits a command and lets the beat (and any creation choreography) run out */
async function say(store: ReturnType<typeof demoStore>, text: string): Promise<boolean> {
  const pending = store.getState().submit(text);
  await vi.advanceTimersByTimeAsync(PROCESS_BEAT_MS);
  return pending;
}

describe("submit", () => {
  it("creates a project after the beat, with the creation phase and one entry", async () => {
    const store = storeOn(emptyDemo());
    const pending = store.getState().submit("Create a timeline for my project");
    expect(store.getState().phase).toBe("processing");
    await vi.advanceTimersByTimeAsync(PROCESS_BEAT_MS - 1);
    expect(store.getState().activeProjectId).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBe(true);

    const s = store.getState();
    expect(s.phase).toBe("creating");
    expect(s.fx).toMatchObject({ kind: "create", seq: 1 });
    expect(openProject(store).views).toEqual(["timeline"]);
    expect(s.local.activeView).toBe("timeline");
    expect(s.caption).toMatchObject({ text: "Timeline created · 4 tasks · sample dates, sequenced from estimates · Demo mode ships one template (website) — rename anything", undoable: true });
    expect(s.past).toHaveLength(1);
    expect(s.changes).toBe(1);
    expect(s.composerOpen).toBe(false);
    expect(s.commandHistory).toEqual(["Create a timeline for my project"]);

    await vi.advanceTimersByTimeAsync(CREATE_TOTAL_MS);
    expect(store.getState().phase).toBe("rest");
  });

  it("skips the beat and the creation phase under reduced motion", async () => {
    const store = storeOn(emptyDemo());
    store.getState().setReducedMotion(true);
    expect(await store.getState().submit("Create a board for my new website")).toBe(true);
    expect(store.getState().phase).toBe("rest");
    expect(openProject(store).views).toEqual(["board"]);
  });

  it("makes no entry for a no-op, and says so without an Undo", async () => {
    const store = demoStore();
    expect(await say(store, "Mark Research done")).toBe(true);
    const s = store.getState();
    expect(s.caption).toMatchObject({ text: "Research is already done", tone: "info", undoable: false });
    expect(s.past).toHaveLength(0);
    expect(s.changes).toBe(0);
    expect(s.composerOpen).toBe(false);
  });

  it("keeps the composer open on an unsupported command and on a question back", async () => {
    const store = demoStore();
    expect(await say(store, "Compare the two options")).toBe(false);
    expect(store.getState()).toMatchObject({ composerOpen: true, phase: "rest", caption: { tone: "unsupported", undoable: false } });
    expect(await say(store, "Remove the tracker")).toBe(false);
    expect(store.getState()).toMatchObject({ composerOpen: true, caption: { tone: "clarify" } });
    expect(store.getState().past).toHaveLength(0);
  });

  it("ignores empty commands and a second command during the beat", async () => {
    const store = demoStore();
    expect(await store.getState().submit("   ")).toBe(false);
    const first = store.getState().submit("Make UI Design high priority");
    expect(await store.getState().submit("Mark it done")).toBe(false);
    await vi.advanceTimersByTimeAsync(PROCESS_BEAT_MS);
    expect(await first).toBe(true);
    expect(store.getState().past).toHaveLength(1);
  });

  it("runs undo, redo and reset as commands", async () => {
    const store = demoStore();
    await say(store, "Make UI Design high priority");
    await say(store, "undo");
    expect(store.getState().caption).toMatchObject({ text: "Undone", tone: "info" });
    expect(taskByTitle(openProject(store), "UI Design").priority).toBe("urgent");
    await say(store, "redo");
    expect(store.getState().caption?.text).toBe("Redone");
    expect(taskByTitle(openProject(store), "UI Design").priority).toBe("high");
    await say(store, "redo");
    expect(store.getState().caption?.text).toBe("Nothing to redo");
    await say(store, "Reset the demo");
    expect(store.getState().activeProjectId).toBeNull();
    expect(store.getState().caption).toMatchObject({ text: "Workspace reset", undoable: true });
  });
});

describe("tabs and views (Q6)", () => {
  it("a tab click is local: no entry, no count, a shift", () => {
    const store = demoStore(["cards", "board"]);
    store.getState().showView("board");
    const s = store.getState();
    expect(s.local.activeView).toBe("board");
    expect(s.past).toHaveLength(0);
    expect(s.changes).toBe(0);
    expect(s.fx).toMatchObject({ kind: "shift", from: "cards", added: null });
    // A view the project doesn't have is never shown
    store.getState().showView("team");
    expect(store.getState().local.activeView).toBe("board");
  });

  it("undoing a command that added and showed a view removes the tab and returns to the previous one", async () => {
    const store = demoStore(["cards", "board"]);
    store.getState().showView("board");
    await say(store, "Add a timeline");
    expect(store.getState().local.activeView).toBe("timeline");
    expect(store.getState().fx).toMatchObject({ kind: "shift", from: "board", added: "timeline" });
    expect(store.getState().undo()).toBe(true);
    const s = store.getState();
    expect(openProject(store).views).toEqual(["cards", "board"]);
    expect(s.local.activeView).toBe("board");
    expect(s.fx).toMatchObject({ kind: "restore", from: "timeline", added: null });
    expect(store.getState().redo()).toBe(true);
    expect(store.getState().local.activeView).toBe("timeline");
    expect(store.getState().fx).toMatchObject({ kind: "restore", from: "board", added: "timeline" });
  });

  it("a tab-only command changes no document and has no Undo", async () => {
    const store = demoStore(["cards", "team"]);
    await say(store, "Show the team workload");
    const s = store.getState();
    expect(s.local.activeView).toBe("team");
    expect(s.past).toHaveLength(0);
    expect(s.caption?.undoable).toBe(false);
  });

  it("selection is local and dropped when its task goes", () => {
    const store = demoStore();
    const ui = taskByTitle(openProject(store), "UI Design");
    store.getState().select(ui.id);
    expect(store.getState().local.selectedTaskId).toBe(ui.id);
    store.getState().select("tsk_0000000000000000" as never);
    expect(store.getState().local.selectedTaskId).toBeNull();
    store.getState().select(ui.id);
    store.getState().commit([{ op: "removeTask", taskId: ui.id }], { label: "remove" });
    expect(store.getState().local.selectedTaskId).toBeNull();
  });
});

describe("undo and redo", () => {
  it("cross the workspace and project commits of one command", () => {
    const store = demoStore();
    const before = store.getState().docs;
    const dev = taskByTitle(openProject(store), "Development");
    const personId = store.deps.mint("person");
    store.getState().commit(
      [
        { op: "addPerson", personId, name: "Giulia", role: null, email: null, capacityDaysPerWeek: null, dayRateCents: null },
        { op: "assignTask", taskId: dev.id, personId },
      ],
      { label: "assign" },
    );
    const after = store.getState().docs;
    expect(after.workspace.people[personId].name).toBe("Giulia");
    expect(openProject(store).tasks[dev.id].ownerId).toBe(personId);
    expect(store.getState().past[0].commits).toHaveLength(2);
    store.getState().undo();
    expect(store.getState().docs).toEqual(before);
    store.getState().redo();
    expect(store.getState().docs).toEqual(after);
    // The redone entry undoes again
    store.getState().undo();
    expect(store.getState().docs).toEqual(before);
  });

  it("drop a spawned project and bring the same document back", () => {
    const store = storeOn(emptyDemo());
    const actions = makeActions(store);
    const id = actions.createDemoProject("New website", "cards")!;
    const spawned = store.getState().past[0].spawned[0];
    expect(spawned.id).toBe(id);
    expect(store.getState().activeProjectId).toBe(id);
    expect(openProject(store)).toBe(spawned);

    store.getState().undo();
    expect(store.getState().docs.projects).toEqual({});
    expect(store.getState().activeProjectId).toBeNull();
    store.getState().redo();
    expect(store.getState().activeProjectId).toBe(id);
    expect(openProject(store)).toBe(spawned);
  });

  it("replay the project commit on a spawned project", () => {
    const store = storeOn(emptyDemo());
    const id = makeActions(store).createDemoProject("New website", "cards", { moodboard: true })!;
    const created = openProject(store);
    expect(created.blocks).toContain("moodboard");
    store.getState().undo();
    store.getState().redo();
    expect(store.getState().activeProjectId).toBe(id);
    expect(openProject(store)).toEqual(created);
  });

  it("keep at most 60 entries, and a new change clears redo", () => {
    const store = demoStore();
    const ui = taskByTitle(openProject(store), "UI Design");
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) store.getState().commit([updateTaskOp(ui.id, "title", `UI Design ${i}`)], { label: `rename ${i}` });
    expect(store.getState().past).toHaveLength(HISTORY_LIMIT);
    expect(store.getState().changes).toBe(HISTORY_LIMIT + 5);
    store.getState().undo();
    expect(store.getState().future).toHaveLength(1);
    store.getState().commit([updateTaskOp(ui.id, "priority", "low")], { label: "priority" });
    expect(store.getState().future).toHaveLength(0);
  });

  it("say nothing to undo with an empty history", () => {
    const store = demoStore();
    expect(store.getState().undo()).toBe(false);
    expect(store.getState().redo()).toBe(false);
  });
});

describe("direct edits", () => {
  it("are quiet unless refused, and keep the caption on screen", async () => {
    const store = demoStore();
    await say(store, "Make UI Design high priority");
    const caption = store.getState().caption;
    const ui = taskByTitle(openProject(store), "UI Design");
    store.getState().commit([updateTaskOp(ui.id, "title", "Screens")], { label: "rename" });
    expect(store.getState().caption).toBe(caption);
    // A refusal speaks
    store.getState().commit([{ op: "removeTask", taskId: "tsk_0000000000000000" as never }], { label: "remove" });
    expect(store.getState().caption).toMatchObject({ tone: "unsupported", undoable: false });
    expect(store.getState().caption?.text).toMatch(/^Couldn't apply that: /);
  });

  it("resolving a proposal speaks", async () => {
    const store = demoStore();
    const ui = taskByTitle(openProject(store), "UI Design");
    store.getState().select(ui.id);
    await say(store, "Break this task into smaller steps");
    expect(openProject(store).proposal?.kind).toBe("subtasks");
    store.getState().resolveProposal(true);
    const s = store.getState();
    expect(openProject(store).proposal).toBeNull();
    expect(openProject(store).tasks[ui.id].steps.length).toBeGreaterThan(0);
    expect(s.caption?.tone).toBe("done");
    expect(s.caption?.undoable).toBe(true);
  });
});

describe("gestures", () => {
  it("coalesce live frames into one entry, recomputed from the base", () => {
    const store = demoStore();
    const ui = taskByTitle(openProject(store), "UI Design");
    const base = store.getState().docs;
    store.getState().beginGesture();
    store.getState().live([updateTaskOp(ui.id, "progress", 50)]);
    store.getState().live([updateTaskOp(ui.id, "progress", 70)]);
    expect(openProject(store).tasks[ui.id].progress).toBe(70);
    expect(store.getState().gesture?.base).toBe(base);
    expect(store.getState().past).toHaveLength(0);
    store.getState().endGesture();
    const s = store.getState();
    expect(s.gesture).toBeNull();
    expect(s.past).toHaveLength(1);
    expect(s.changes).toBe(1);
    expect(openProject(store).tasks[ui.id].progress).toBe(70);
    store.getState().undo();
    expect(store.getState().docs).toEqual(base);
  });

  it("leave no entry for review@90 dragged to 100 and back to 90", () => {
    const store = demoStore();
    const visual = taskByTitle(openProject(store), "Visual Direction");
    store.getState().commit([updateTaskOp(visual.id, "progress", 90)], { label: "progress" });
    const entries = store.getState().past.length;
    const before = store.getState().docs;
    store.getState().live([updateTaskOp(visual.id, "progress", 95)]);
    store.getState().live([updateTaskOp(visual.id, "progress", 100)]);
    expect(openProject(store).tasks[visual.id].status).toBe("done");
    store.getState().live([updateTaskOp(visual.id, "progress", 90)]);
    store.getState().endGesture();
    expect(store.getState().past).toHaveLength(entries);
    expect(store.getState().docs).toBe(before);
    expect(openProject(store).tasks[visual.id]).toMatchObject({ status: "review", progress: 90 });
  });

  it("are sealed after 400 ms without a frame, and by the next action", () => {
    const store = demoStore();
    const ui = taskByTitle(openProject(store), "UI Design");
    store.getState().live([updateTaskOp(ui.id, "progress", 40)]);
    vi.advanceTimersByTime(GESTURE_IDLE_MS - 1);
    expect(store.getState().gesture).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(store.getState().gesture).toBeNull();
    expect(store.getState().past).toHaveLength(1);

    store.getState().live([updateTaskOp(ui.id, "progress", 60)]);
    store.getState().commit([updateTaskOp(ui.id, "priority", "low")], { label: "priority" });
    expect(store.getState().past.map((e) => e.label)).toEqual(["gesture", "gesture", "priority"]);
    // Undo seals an open gesture first, then undoes it
    store.getState().live([updateTaskOp(ui.id, "progress", 80)]);
    store.getState().undo();
    expect(openProject(store).tasks[ui.id]).toMatchObject({ progress: 60, priority: "low" });
  });

  it("restore their base when cancelled", () => {
    const store = demoStore();
    const ui = taskByTitle(openProject(store), "UI Design");
    const base = store.getState().docs;
    store.getState().live([updateTaskOp(ui.id, "progress", 40)]);
    store.getState().cancelGesture();
    expect(store.getState().docs).toBe(base);
    expect(store.getState().past).toHaveLength(0);
    vi.advanceTimersByTime(GESTURE_IDLE_MS);
    expect(store.getState().past).toHaveLength(0);
  });
});

describe("reset", () => {
  it("deletes the open project, undoably", () => {
    const store = demoStore();
    const id = store.getState().activeProjectId;
    store.getState().openComposer();
    expect(store.getState().reset()).toBe(true);
    const s = store.getState();
    expect(s.activeProjectId).toBeNull();
    expect(s.docs.workspace.projects[id!].deletedAt).not.toBeNull();
    expect(s).toMatchObject({ composerOpen: false, phase: "rest", fx: { kind: "restore", from: null, added: null } });
    expect(s.caption).toMatchObject({ text: "Workspace reset", undoable: true });
    store.getState().undo();
    expect(store.getState().activeProjectId).toBe(id);
  });

  it("has nothing to do without a project", () => {
    const store = storeOn(emptyDemo());
    expect(store.getState().reset()).toBe(false);
    expect(store.getState().caption?.text).toBe("Nothing to reset");
  });
});

describe("action creators", () => {
  it("mint the ids their ops carry", async () => {
    const store = demoStore(["cards", "team"]);
    const a = makeActions(store);
    const task = a.addTaskAtEnd()!;
    expect(openProject(store).tasks[task].title).toBe("New task");
    const step = a.addStep(task, "Draft")!;
    expect(openProject(store).tasks[task].steps.map((s) => s.id)).toEqual([step]);
    const note = a.addNote()!;
    expect(openProject(store).moodboard.items[note].kind).toBe("note");
    const colour = a.addColour("#c65d3b", "Terracotta")!;
    expect(openProject(store).moodboard.items[colour]).toMatchObject({ kind: "color", hex: "#c65d3b", text: "Terracotta" });
    const line = a.addBriefLine("client", "next", "Launch party on Friday.")!;
    expect(openProject(store).brief.lines.map((l) => l.id)).toEqual([line]);
    expect(store.getState().past).toHaveLength(5);
    expect(store.getState().caption).toBeNull();
  });

  it("add a person with a visible 5 days a week, who joins the project", () => {
    const store = demoStore();
    const a = makeActions(store);
    const id = a.addPerson()!;
    const s = store.getState();
    expect(s.docs.workspace.people[id]).toMatchObject({ name: "Person 4", capacityDaysPerWeek: 5 });
    expect(openProject(store).memberIds).toContain(id);
    expect(s.past).toHaveLength(1);
    expect(a.addPerson()).not.toBe(id);
    expect(store.getState().docs.workspace.people[store.getState().past[1].commits[0].patches[0].path[1] as never]).toMatchObject({ name: "Person 5" });
  });

  it("bring the sample team back into a project without one", () => {
    const state = demoState();
    const project = state.projects[state.projectId!];
    const tasks = Object.fromEntries(Object.entries(project.tasks).map(([id, t]) => [id, { ...t, ownerId: null }]));
    const store = storeOn({ ...state, projects: { [project.id]: { ...project, memberIds: [], tasks } } });
    expect(makeActions(store).addSampleTeam()).toBe(true);
    expect(openProject(store).memberIds).toEqual(["per_demomarta", "per_demosara", "per_demoluca"]);
    expect(taskByTitle(openProject(store), "UI Design").ownerId).toBe("per_demomarta");
    expect(store.getState().past).toHaveLength(1);
  });

  it("shift the start by a week and make it the user's", () => {
    const store = demoStore(["timeline"]);
    makeActions(store).shiftStart(7);
    expect(openProject(store)).toMatchObject({ startDate: "2026-10-05", startConfirmed: true });
    expect(store.getState().past).toHaveLength(1);
  });
});

describe("session state", () => {
  it("opens and closes the composer and the intro as v0 did", () => {
    const store = demoStore();
    store.getState().openComposer();
    expect(store.getState().composerOpen).toBe(true);
    store.getState().setIntro(true);
    expect(store.getState()).toMatchObject({ intro: true, composerOpen: false });
    store.getState().setIntro(false);
    expect(store.getState().intro).toBe(false);
  });

  it("ticks today", () => {
    const store = demoStore();
    expect(store.getState().today).toBe("2026-10-14");
    store.getState().tick("2026-10-15" as never);
    expect(store.getState().today).toBe("2026-10-15");
  });
});
