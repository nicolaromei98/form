// Persistence and first load at store level (plan §7.3, §8.1, §10.2): the first-load migration
// from each v0 fixture, the one-off captions, the 250 ms debounce, no save during a gesture,
// compaction, reloads, and a storage spy proving the v0 keys are never written.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_BACKUP_KEY, DEMO_STORAGE_KEY, DemoEnvelopeSchema } from "@/lib/domain/schema/demo";
import { updateTaskOp } from "@/lib/ops/build";
import { NOTICE_TEXT } from "@/lib/ops/notices";
import { V0_BACKUP_KEY, V0_KEY } from "@/lib/migrate";
import { createFormStore, type FormStore } from "@/lib/store/form";
import { SAVE_DEBOUNCE_MS } from "@/lib/store/persist";
import { taskByTitle } from "../../../../test/fixtures/v2/build";
import { NOW_MS, openProject, spyStorage, testDeps, V0_MANIFEST as MANIFEST, v0Storage as storageOf } from "./support";

beforeEach(() => {
  vi.useFakeTimers({ now: NOW_MS });
});
afterEach(() => {
  vi.useRealTimers();
});

type Spy = ReturnType<typeof spyStorage>;

const storeWith = (storage: Spy, search = "") => createFormStore(testDeps({ storage, search: () => search }));
const writes = (storage: Spy) => storage.calls.filter((c) => c.method === "setItem" || c.method === "removeItem" || c.method === "clear");
const savedEnvelope = (storage: Spy) => DemoEnvelopeSchema.parse(JSON.parse(storage.values.get(DEMO_STORAGE_KEY)!));

/** A few edits of every kind: commands, direct edits, a gesture, undo and redo, a reset */
async function work(store: FormStore) {
  store.getState().setReducedMotion(true);
  await store.getState().submit("Create a project tracker for my new website");
  const project = openProject(store);
  const ui = Object.values(project.tasks).find((t) => t.kind === "task")!;
  store.getState().commit([updateTaskOp(ui.id, "priority", "low")], { label: "priority" });
  store.getState().live([updateTaskOp(ui.id, "progress", 40)]);
  store.getState().endGesture();
  store.getState().undo();
  store.getState().redo();
  await store.getState().submit("Add a timeline");
  store.getState().reset();
  vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
}

describe("first load at store level", () => {
  it.each(MANIFEST.map((e) => [e.name, e] as const))("%s: migrates, opens, and never writes the v0 keys", async (_name, entry) => {
    const initial = storageOf(entry);
    const storage = spyStorage(initial);
    const store = storeWith(storage);
    expect(store.loaded).toBe("migrated");
    const s = store.getState();
    const e = savedEnvelope(storage);
    expect(s.docs.workspace).toEqual(e.workspace);
    expect(s.activeProjectId).toBe(e.activeProjectId);
    if (e.activeProjectId !== null) expect(s.local.activeView).toBe(e.lastView);
    expect(s.changes).toBe(e.changes);

    await work(store);
    for (const key of [V0_KEY, V0_BACKUP_KEY]) expect(storage.values.get(key)).toBe(initial[key]);
    const keys = new Set(writes(storage).map((c) => c.args[0]));
    expect([...keys]).toEqual([DEMO_STORAGE_KEY]);
    expect(writes(storage).every((c) => c.method === "setItem")).toBe(true);
  });

  it("shows the weekends notice once, and saves it as seen", () => {
    const entry = MANIFEST.find((m) => m.name === "docTracker")!;
    const storage = spyStorage(storageOf(entry));
    const store = storeWith(storage);
    expect(store.getState().caption).toMatchObject({ text: NOTICE_TEXT.weekendsNow, tone: "info", undoable: false });
    expect(savedEnvelope(storage).notices.weekendsPending).toBe(true);
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(savedEnvelope(storage).notices.weekendsPending).toBe(false);
    // The next load says nothing
    expect(storeWith(storage).getState().caption).toBeNull();
  });

  it("opens the view the URL asks for, else the saved one", () => {
    const entry = MANIFEST.find((m) => m.name === "docDemo")!;
    const storage = spyStorage(storageOf(entry));
    expect(storeWith(storage, "?view=team").getState().local.activeView).toBe("team");
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(savedEnvelope(storage).lastView).toBe("team");
    expect(storeWith(storage).getState().local.activeView).toBe("team");
    expect(storeWith(storage, "?view=nope").getState().local.activeView).toBe("team");
  });

  it("starts the demo empty, with the sample team, and saves nothing until the first change", async () => {
    const storage = spyStorage({});
    const store = storeWith(storage);
    expect(store.loaded).toBe("fresh");
    expect(store.getState().activeProjectId).toBeNull();
    expect(Object.values(store.getState().docs.workspace.people).map((p) => p.name)).toEqual(["Marta", "Sara", "Luca"]);
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS * 4);
    expect(writes(storage)).toEqual([]);
    store.getState().setReducedMotion(true);
    await store.getState().submit("Create a board for my new website");
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(Object.keys(savedEnvelope(storage).projects)).toEqual([store.getState().activeProjectId]);
  });
});

describe("an unreadable save at store level", () => {
  it("is copied aside with a caption, and replaced only by the first save", async () => {
    const storage = spyStorage({ [DEMO_STORAGE_KEY]: "{broken" });
    const store = storeWith(storage);
    expect(store.loaded).toBe("recovered");
    expect(store.getState().caption).toMatchObject({ text: "FORM couldn't read the saved demo, so a copy was kept.", tone: "info" });
    expect(storage.values.get(DEMO_BACKUP_KEY)).toBe("{broken");
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS * 4);
    expect(storage.values.get(DEMO_STORAGE_KEY)).toBe("{broken");
    // A refused change (no project yet) changes nothing and saves nothing
    store.getState().commit([{ op: "addTask", taskId: store.deps.mint("task"), title: "x", kind: "task", place: "end", dependsOn: [], estimateDays: null, priority: "medium", ownerId: null }], { label: "x" });
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(storage.values.get(DEMO_STORAGE_KEY)).toBe("{broken");
    // The first real change is saved; the copy stays
    store.getState().setReducedMotion(true);
    await store.getState().submit("Create a board for my new website");
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(savedEnvelope(storage).activeProjectId).toBe(store.getState().activeProjectId);
    expect(storage.values.get(DEMO_BACKUP_KEY)).toBe("{broken");
  });

  it("is never written over when no copy could be made", async () => {
    const values = new Map([[DEMO_STORAGE_KEY, "{broken"]]);
    const setItem = vi.fn(() => {
      throw new Error("QuotaExceededError");
    });
    const store = createFormStore(testDeps({ storage: { getItem: (k: string) => values.get(k) ?? null, setItem } }));
    store.getState().setReducedMotion(true);
    await store.getState().submit("Create a board for my new website");
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    store.getState().flushSave();
    // Only the backup attempt: the demo itself never tried to save
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(setItem.mock.calls[0]).toEqual([DEMO_BACKUP_KEY, "{broken"]);
    expect(values.get(DEMO_STORAGE_KEY)).toBe("{broken");
  });
});

describe("saving", () => {
  async function started(): Promise<{ store: FormStore; storage: Spy }> {
    const storage = spyStorage({});
    const store = storeWith(storage);
    store.getState().setReducedMotion(true);
    await store.getState().submit("Create a project tracker for my new website");
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    storage.calls.length = 0;
    return { store, storage };
  }

  it("is debounced to one write 250 ms after the last change", async () => {
    const { store, storage } = await started();
    const ui = taskByTitle(openProject(store), "UI Design");
    store.getState().commit([updateTaskOp(ui.id, "priority", "low")], { label: "a" });
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS - 10);
    store.getState().commit([updateTaskOp(ui.id, "priority", "high")], { label: "b" });
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS - 10);
    expect(writes(storage)).toEqual([]);
    vi.advanceTimersByTime(10);
    expect(writes(storage)).toHaveLength(1);
    expect(savedEnvelope(storage).changes).toBe(3);
  });

  it("never happens while a gesture is open", async () => {
    const { store, storage } = await started();
    const ui = taskByTitle(openProject(store), "UI Design");
    for (let p = 35; p <= 60; p += 5) {
      store.getState().live([updateTaskOp(ui.id, "progress", p)]);
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 50);
    }
    expect(writes(storage)).toEqual([]);
    store.getState().endGesture();
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(writes(storage)).toHaveLength(1);
    expect(savedEnvelope(storage).projects[store.getState().activeProjectId!].tasks[ui.id].progress).toBe(60);
  });

  it("ignores the selection, the caption, the composer and the phase", async () => {
    const { store, storage } = await started();
    const ui = taskByTitle(openProject(store), "UI Design");
    store.getState().select(ui.id);
    store.getState().dismissCaption();
    store.getState().openComposer();
    store.getState().setIntro(true);
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS * 2);
    expect(writes(storage)).toEqual([]);
  });

  it("saves a tab change as the last view", async () => {
    const { store, storage } = await started();
    await store.getState().submit("Add a board");
    store.getState().showView("cards");
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(savedEnvelope(storage).lastView).toBe("cards");
    expect(writes(storage)).toHaveLength(1);
  });

  it("compacts a deleted project, and a reload opens the empty demo", async () => {
    const { store, storage } = await started();
    store.getState().reset();
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    const e = savedEnvelope(storage);
    expect(e.projects).toEqual({});
    expect(e.workspace.projects).toEqual({});
    expect(e.activeProjectId).toBeNull();
    const reloaded = storeWith(storage);
    expect(reloaded.loaded).toBe("saved");
    expect(reloaded.getState().activeProjectId).toBeNull();
    expect(reloaded.getState().changes).toBe(2);
  });

  it("reloads the same documents and counter", async () => {
    const { store, storage } = await started();
    const ui = taskByTitle(openProject(store), "UI Design");
    store.getState().commit([updateTaskOp(ui.id, "title", "Screens")], { label: "rename" });
    store.getState().flushSave();
    const reloaded = storeWith(storage);
    expect(reloaded.getState().docs).toEqual(store.getState().docs);
    expect(reloaded.getState().changes).toBe(store.getState().changes);
    expect(reloaded.getState().local.activeView).toBe("cards");
  });
});
