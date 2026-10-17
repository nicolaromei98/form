// The store property (plan §10.3, §5.8): runs of generated steps through the real Zustand store,
// as the app drives it. Each step is a direct commit of a generated op, a gesture (several live
// frames of the op, then sealed), a tab switch, an undo or a redo. Along the way:
//   - a gesture is recomputed from its base: sealed, the documents equal one direct command of the
//     coalesced frames from the base, and it leaves an entry exactly when that command changed
//     something; a cancelled one restores the base by reference;
//   - a tab switch and a no-op never make an entry, and the counter counts entries;
// and at the end of each run, undoing everything gives the start documents exactly (and the start
// project), and redoing everything gives the final documents.
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { seededMinter } from "@/lib/domain/ids";
import type { Timestamp, ViewKind } from "@/lib/domain/schema/primitives";
import type { Op } from "@/lib/ops/registry";
import { coalesce, type DocsState, run } from "@/lib/store/engine";
import { createFormStore, type FormStore } from "@/lib/store/form";
import { FIXTURE_NOW, FIXTURE_TODAY } from "../fixtures/v2/build";
import { type Run, runArb } from "./arbitraries";
import type { StepIntent } from "./gen/_pick";
import { type GenState, materialise, startState } from "./materialise";
import { deepFreeze, runsTimeout } from "./runner";

const NOW_MS = Date.parse(FIXTURE_NOW);
const VIEWS: readonly ViewKind[] = ["cards", "board", "timeline", "team", "focus", "brief"];

type Mode = "commit" | "gesture" | "cancel" | "tab" | "undo" | "redo";
/** Commits are the bulk; the rest exercise gestures, tabs and the history in between */
const MODES: readonly Mode[] = ["commit", "commit", "commit", "gesture", "gesture", "cancel", "tab", "undo", "redo"];

interface StoreRun {
  run: Run;
  modes: Mode[];
  /** Extra live frames per gesture step */
  frames: number[];
}

const storeRunArb: fc.Arbitrary<StoreRun> = fc.record({
  run: runArb,
  modes: fc.array(fc.constantFrom(...MODES), { minLength: 30, maxLength: 30 }),
  frames: fc.array(fc.nat({ max: 3 }), { minLength: 30, maxLength: 30 }),
});

function storeFor(start: GenState): FormStore {
  let n = 0;
  return createFormStore({
    storage: null,
    now: () => NOW_MS,
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    mint: seededMinter(11),
    timezone: () => "Europe/Rome",
    search: () => "",
    initial: { docs: { workspace: start.workspace, projects: start.projects }, activeProjectId: start.projectId },
  });
}

const genState = (store: FormStore): GenState => {
  const s = store.getState();
  return { workspace: s.docs.workspace, projects: s.docs.projects, projectId: s.activeProjectId };
};

/** The same intent with other values: a later frame of the same drag */
const frameOf = (step: StepIntent, j: number): StepIntent => ({ ...step, nums: step.nums.map((x, i) => x + j * 13 * (i + 1)), flags: step.flags.map((f, i) => (i === j % 4 ? !f : f)) });

/** What a direct command of `ops` from `docs` would leave (the gesture's sealed result must equal it) */
function direct(store: FormStore, docs: DocsState, ops: readonly Op[]) {
  const s = store.getState();
  let n = 0;
  return run(
    docs,
    { ops, local: [], notes: [], notices: [], source: "direct", text: null, caption: false },
    { projectId: s.activeProjectId, local: s.local },
    // The store stamps with toISOString, as the app does
    { now: new Date(NOW_MS).toISOString() as Timestamp, actorId: null, today: FIXTURE_TODAY, newId: () => `ffffffff-0000-4000-8000-${String(++n).padStart(12, "0")}` },
  );
}

/** What the runs did, to prove they reach every path */
const seen = { commits: 0, sealed: 0, sealedNoChange: 0, cancelled: 0, tabs: 0, undos: 0, redos: 0, spawned: 0 };

function play({ run: r, modes, frames }: StoreRun): void {
  const start = startState(r.fixture, r.requireReview, r.proposal);
  const store = storeFor(start);
  const mint = seededMinter(r.steps.length + 1);
  let entries = 0;

  r.steps.forEach((step, i) => {
    const mode = modes[i];
    const before = store.getState();
    const pastBefore = before.past.length;

    if (mode === "undo" || mode === "redo") {
      const did = mode === "undo" ? before.undo() : before.redo();
      expect(did).toBe(mode === "undo" ? pastBefore > 0 : before.future.length > 0);
      if (did) seen[mode === "undo" ? "undos" : "redos"]++;
      return;
    }
    if (mode === "tab") {
      before.showView(VIEWS[step.picks[0] % VIEWS.length]);
      const after = store.getState();
      expect(after.docs).toBe(before.docs);
      expect(after.past.length).toBe(pastBefore);
      seen.tabs++;
      return;
    }

    const raw = materialise(step, genState(store), mint);
    if (raw === null) return;
    if (mode === "commit") {
      const result = before.commit([deepFreeze(raw) as Op], { label: step.op });
      const grew = store.getState().past.length - pastBefore;
      expect(grew).toBe(result.changed ? 1 : 0);
      if (!result.changed) expect(store.getState().docs).toBe(before.docs);
      entries += grew;
      seen.commits += grew;
      if (result.spawned.length > 0) seen.spawned++;
      return;
    }

    // A gesture: the first frame, then up to three more of the same intent, all from one base
    const base = before.docs;
    const ops: Op[] = [raw as Op];
    for (let j = 1; j <= frames[i]; j++) {
      const frame = materialise(frameOf(step, j), genState(store), mint);
      if (frame !== null) ops.push(frame as Op);
    }
    for (const op of ops) store.getState().live([deepFreeze(op)]);
    expect(store.getState().gesture?.base).toBe(base);
    expect(store.getState().past.length).toBe(pastBefore);
    if (mode === "cancel") {
      store.getState().cancelGesture();
      expect(store.getState().docs).toBe(base);
      expect(store.getState().past.length).toBe(pastBefore);
      seen.cancelled++;
      return;
    }
    const expected = direct(store, base, coalesce(ops));
    store.getState().endGesture();
    const after = store.getState();
    expect(after.gesture).toBeNull();
    expect(after.docs).toEqual(expected.state);
    expect(after.past.length - pastBefore).toBe(expected.changed ? 1 : 0);
    if (!expected.changed) expect(after.docs).toBe(base);
    entries += after.past.length - pastBefore;
    seen[expected.changed ? "sealed" : "sealedNoChange"]++;
  });

  // Every new entry was counted; undo and redo don't count
  expect(store.getState().changes).toBe(entries);

  // Undo everything: the start documents and project; redo everything: the final documents
  const final = store.getState().docs;
  const depth = store.getState().past.length;
  // Steps that were undone at the end of the run wait in the redo stack
  const pending = store.getState().future.length;
  for (let k = 0; k < depth; k++) expect(store.getState().undo()).toBe(true);
  expect(store.getState().undo()).toBe(false);
  const undone = store.getState();
  expect(undone.docs.workspace).toEqual(start.workspace);
  expect(undone.docs.projects).toEqual(start.projects);
  // Undo hands back the very documents each command started from
  expect(undone.docs.workspace).toBe(start.workspace);
  for (const id of Object.keys(start.projects) as (keyof typeof start.projects)[]) expect(undone.docs.projects[id]).toBe(start.projects[id]);
  if (depth > 0) expect(undone.activeProjectId).toBe(start.projectId);
  expect(undone.future.length).toBe(depth + pending);
  for (let k = 0; k < depth; k++) expect(store.getState().redo()).toBe(true);
  expect(store.getState().future.length).toBe(pending);
  expect(store.getState().docs.workspace).toEqual(final.workspace);
  expect(store.getState().docs.projects).toEqual(final.projects);
  expect(store.getState().docs.workspace).toBe(final.workspace);
  for (const id of Object.keys(final.projects) as (keyof typeof final.projects)[]) expect(store.getState().docs.projects[id]).toBe(final.projects[id]);
}

describe("store property", () => {
  beforeAll(() => {
    // Gesture idle timers and the like never fire mid-run
    vi.useFakeTimers({ now: NOW_MS });
  });
  afterAll(() => {
    vi.useRealTimers();
    if (process.env.FORM_PROPERTY_STATS) console.log(seen);
    // Every path was taken: commits, sealed gestures with and without a change, cancels, tabs, undo, redo, spawns
    if (Number(process.env.FC_RUNS ?? 500) < 200) return;
    for (const [path, n] of Object.entries(seen)) expect(n, path).toBeGreaterThan(0);
  });

  it("undoes everything to the start and redoes everything to the end, gestures included", () => {
    fc.assert(fc.property(storeRunArb, play));
  }, runsTimeout());
});
