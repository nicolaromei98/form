// The store's own costs on top of the reducer (plan §10.7, §5.8) at 150 tasks: a live gesture
// frame through the store (coalescing, touched validation, the Zustand update) within the frame
// budget of 0.5 ms, a direct commit within the full-validation budget of 2 ms, and undo by
// reference; with the growth guard t(300) / t(150) < 3.
import { describe, expect, it } from "vitest";
import { seededMinter } from "@/lib/domain/ids";
import { sortedByOrder } from "@/lib/domain/order";
import { updateTaskOp } from "@/lib/ops/build";
import { createFormStore, type FormStore } from "@/lib/store/form";
import { activeProject, FIXTURE_NOW, generated } from "../fixtures/v2/build";
import { budget, time } from "./timing";

const PERF_FIXTURE = { stepsPerTask: 3, predsMean: 1.5, people: 8 };
const NOW_MS = Date.parse(FIXTURE_NOW);

function setup(n: number) {
  const state = generated(n, PERF_FIXTURE);
  let k = 0;
  const store: FormStore = createFormStore({
    storage: null,
    now: () => NOW_MS,
    newId: () => `00000000-0000-4000-8000-${String(++k).padStart(12, "0")}`,
    mint: seededMinter(1),
    timezone: () => "Europe/Rome",
    search: () => "",
    initial: { docs: { workspace: state.workspace, projects: state.projects }, activeProjectId: state.projectId },
  });
  const project = activeProject(state);
  const task = sortedByOrder(project.tasks).find((t, i) => i > n / 2 && t.kind === "task" && t.status !== "done")!;
  let p = 10;
  const frame = () => store.getState().live([updateTaskOp(task.id, "progress", (p = p === 10 ? 20 : 10))]);
  let flip = false;
  const commit = () => store.getState().commit([updateTaskOp(task.id, "priority", (flip = !flip) ? "urgent" : "low")], { label: "priority" });
  return { store, frame, commit };
}

describe("store at 150 tasks", () => {
  const s150 = setup(150);
  const s300 = setup(300);

  it("runs a live gesture frame within 0.5 ms", () => {
    const t150 = time(s150.frame, { runs: 30 });
    const t300 = time(s300.frame, { runs: 30 });
    s150.store.getState().cancelGesture();
    s300.store.getState().cancelGesture();
    expect(t150.median).toBeLessThan(budget(0.5));
    expect(t300.median / t150.median).toBeLessThan(3);
  });

  it("commits a direct edit within 2 ms, and undoes it by reference", () => {
    const t150 = time(s150.commit, { runs: 30 });
    const t300 = time(s300.commit, { runs: 30 });
    expect(t150.median).toBeLessThan(budget(2));
    expect(t300.median / t150.median).toBeLessThan(3);
    const undo150 = time(() => (s150.store.getState().undo(), s150.store.getState().redo()), { runs: 20 });
    expect(undo150.median).toBeLessThan(budget(0.5));
  });
});
