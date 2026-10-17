// The hooks (plan §8.1, §10.2, §12.9): render-count tests show each hook returns a stable
// reference while what it reads is unchanged, so a component re-renders only for its own data;
// the derived hooks read the planning engine; the runtime keeps the view in the URL.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PEOPLE_MAX } from "@/lib/domain/limits";
import { updateTaskOp } from "@/lib/ops/build";
import type { FormStore } from "@/lib/store/form";
import {
  FormStoreProvider,
  useActions,
  useBrief,
  useCanAddPerson,
  useFocus,
  useFocusFor,
  useFormRuntime,
  useHasSamplePerson,
  useLaneLoads,
  useMembers,
  useMetrics,
  useMoodItems,
  useNextViews,
  usePalette,
  useProject,
  useProposalCells,
  useSuggestions,
  useTask,
  useTaskNumber,
  useTasksByStatus,
  useTimelineGrid,
  useVisibleTaskIds,
  useWorkspacePeople,
} from "@/lib/store/hooks";
import { taskByTitle } from "../../../../test/fixtures/v2/build";
import { demoStore, emptyDemo, NOW_MS, openProject, storeOn } from "./support";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: (() => void)[] = [];

beforeEach(() => {
  vi.useFakeTimers({ now: NOW_MS });
});
afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
  vi.useRealTimers();
});

/** Renders a component that calls `use` and records every value it rendered with */
function probe<T>(store: FormStore, use: () => T): { values: T[]; last: () => T } {
  const values: T[] = [];
  const Probe = () => {
    values.push(use());
    return null;
  };
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(FormStoreProvider, { store }, createElement(Probe))));
  mounted.push(() => act(() => root.unmount()));
  return { values, last: () => values.at(-1)! };
}

const change = (fn: () => void) => act(fn);

describe("render counts", () => {
  it("useTask re-renders for its own task only", () => {
    const store = demoStore();
    const ui = taskByTitle(openProject(store), "UI Design");
    const dev = taskByTitle(openProject(store), "Development");
    const p = probe(store, () => useTask(ui.id));
    expect(p.values).toHaveLength(1);
    change(() => void store.getState().commit([updateTaskOp(dev.id, "title", "Build")], { label: "rename" }));
    expect(p.values).toHaveLength(1);
    change(() => void store.getState().commit([updateTaskOp(ui.id, "title", "Screens")], { label: "rename" }));
    expect(p.values).toHaveLength(2);
    expect(p.last()?.title).toBe("Screens");
  });

  it("useVisibleTaskIds keeps its array through a title edit, and follows the sort", () => {
    const store = demoStore();
    const ui = taskByTitle(openProject(store), "UI Design");
    const p = probe(store, useVisibleTaskIds);
    const first = p.last();
    expect(first.map((id) => openProject(store).tasks[id].title)).toEqual(["Research", "Visual Direction", "UI Design", "Development"]);
    change(() => void store.getState().commit([updateTaskOp(ui.id, "title", "Screens")], { label: "rename" }));
    expect(p.values).toHaveLength(1);
    change(() => void store.getState().commit([{ op: "setView", patch: { sort: "priority" } }], { label: "sort" }));
    expect(p.values).toHaveLength(2);
    expect(p.last().map((id) => openProject(store).tasks[id].title)).toEqual(["Screens", "Visual Direction", "Development", "Research"]);
  });

  it("useTimelineGrid keeps its object through a view-config change (no reschedule)", () => {
    const store = demoStore(["timeline"]);
    const ui = taskByTitle(openProject(store), "UI Design");
    const p = probe(store, useTimelineGrid);
    const grid = p.last()!;
    expect(grid.unit).toBe("day");
    expect(grid.bars.get(ui.id)).toEqual({ start: 9, days: 8, milestone: false });
    change(() => void store.getState().commit([{ op: "setView", patch: { density: "compact" } }], { label: "density" }));
    expect(p.values).toHaveLength(1);
    change(() => void store.getState().commit([updateTaskOp(ui.id, "estimateDays", 7)], { label: "estimate" }));
    expect(p.values).toHaveLength(2);
    expect(p.last()!.bars.get(ui.id)?.days).toBe(9);
  });

  it("data hooks ignore the session state: caption, composer, phase, selection elsewhere", () => {
    const store = demoStore(["cards", "team", "brief"]);
    const hooks = [useProject, useLaneLoads, useBrief, useMetrics, useFocus, useMembers, useMoodItems, useTasksByStatus, useSuggestions];
    const probes = hooks.map((h) => probe(store, h as () => unknown));
    change(() => {
      store.getState().openComposer();
      store.getState().setSpawn([{ x: 0, y: 0, w: 1, h: 1 }]);
      store.getState().dismissCaption();
      store.getState().setIntro(true);
      store.getState().setIntro(false);
    });
    for (const [i, p] of probes.entries()) expect(p.values, hooks[i].name).toHaveLength(1);
  });

  it("useTaskNumber and useFocusFor give primitives and stable candidates", () => {
    const store = demoStore();
    const ui = taskByTitle(openProject(store), "UI Design");
    const number = probe(store, () => useTaskNumber(ui.id));
    const focus = probe(store, () => useFocusFor(ui.id));
    expect(number.last()).toBe("03");
    expect(focus.last()?.why).toBe("Urgent and on the critical path.");
    change(() => void store.getState().commit([{ op: "setView", patch: { sort: "title" } }], { label: "sort" }));
    expect(number.values).toHaveLength(1);
  });

  it("useActions is one stable object", () => {
    const store = demoStore();
    const p = probe(store, useActions);
    change(() => void store.getState().commit([{ op: "setView", patch: { sort: "title" } }], { label: "sort" }));
    expect(new Set(p.values).size).toBe(1);
  });
});

describe("derived hooks", () => {
  it("read the demo lanes, and the reassign preview", async () => {
    const store = demoStore(["cards", "team"]);
    const lanes = probe(store, () => useLaneLoads());
    const preview = probe(store, () => useLaneLoads({ preview: true }));
    const marta = (l: readonly { personId: string | null; days: number; capacity: number | null; over: number | null }[]) => l.find((x) => x.personId === "per_demomarta");
    expect(marta(lanes.last())).toMatchObject({ days: 10, capacity: 6, over: 4 });
    store.getState().setReducedMotion(true);
    await act(() => store.getState().submit("Balance the workload"));
    expect(openProject(store).proposal?.kind).toBe("reassign");
    expect(marta(lanes.last())).toMatchObject({ days: 10, over: 4 });
    expect(marta(preview.last())).toMatchObject({ days: 4, over: 0 });
  });

  it("compose the brief for the view's audience", () => {
    const store = demoStore(["cards", "brief"]);
    const brief = probe(store, useBrief);
    expect(brief.last()?.sections.map((s) => s.key)).toContain("risks");
    expect(JSON.stringify(brief.last())).toContain("UI Design is urgent.");
    expect(JSON.stringify(brief.last())).not.toContain("Marta is 4 days over capacity.");
    change(() => void store.getState().commit([{ op: "setView", patch: { briefAudience: "team" } }], { label: "audience" }));
    expect(brief.values).toHaveLength(2);
    expect(JSON.stringify(brief.last())).toContain("Marta is 4 days over capacity.");
  });
});

describe("integration hooks (step 18)", () => {
  it("useNextViews offers the views the project lacks, and keeps its array while they stay the same", () => {
    const store = demoStore(["cards"]);
    const p = probe(store, useNextViews);
    expect(p.last()).toEqual(["timeline", "board", "team"]);
    const ui = taskByTitle(openProject(store), "UI Design");
    change(() => void store.getState().commit([updateTaskOp(ui.id, "title", "Screens")], { label: "rename" }));
    expect(p.values).toHaveLength(1);
    change(() => void store.getState().commit([{ op: "addView", view: "timeline" }], { label: "add timeline" }));
    expect(p.last()).toEqual(["team", "board", "brief"]);
  });

  it("useHasSamplePerson follows the Team rows", () => {
    expect(probe(demoStore(["cards", "team"]), useHasSamplePerson).last()).toBe(true);
    // The demo workspace holds the sample team, but no project means no Team rows
    expect(probe(storeOn(emptyDemo()), useHasSamplePerson).last()).toBe(false);
  });

  it("useCanAddPerson turns false where the reducer starts refusing", () => {
    const store = demoStore(["cards", "team"]);
    const room = probe(store, useCanAddPerson);
    expect(room.last()).toBe(true);
    change(() => {
      for (let i = Object.keys(store.getState().docs.workspace.people).length; i < PEOPLE_MAX; i++) {
        const op = { op: "addPerson", personId: store.deps.mint("person"), name: `Extra ${i}`, role: null, email: null, capacityDaysPerWeek: 5, dayRateCents: null } as const;
        expect(store.getState().commit([op], { label: "add person" }).changed).toBe(true);
      }
    });
    expect(room.last()).toBe(false);
    // The reducer agrees: one more is refused
    const refused = store.getState().commit([{ op: "addPerson", personId: store.deps.mint("person"), name: "One too many", role: null, email: null, capacityDaysPerWeek: 5, dayRateCents: null }], { label: "add person" });
    expect(refused.changed).toBe(false);
  });

  it("useWorkspacePeople is the workspace's own record", () => {
    const store = demoStore();
    const p = probe(store, useWorkspacePeople);
    expect(p.last()).toBe(store.getState().docs.workspace.people);
  });

  it("useProposalCells puts a proposal's steps where accepting them schedules them", async () => {
    const store = demoStore(["cards", "timeline"]);
    store.getState().setReducedMotion(true);
    const ui = taskByTitle(openProject(store), "UI Design");
    const cells = probe(store, useProposalCells);
    const grid = probe(store, useTimelineGrid);
    expect(cells.last().size).toBe(0);
    change(() => store.getState().select(ui.id));
    await act(() => store.getState().submit("Break this task into smaller steps"));
    const proposal = openProject(store).proposal;
    expect(proposal?.kind).toBe("subtasks");
    const previewed = new Map(cells.last());
    expect(previewed.size).toBeGreaterThan(0);
    change(() => store.getState().resolveProposal(true));
    expect(openProject(store).proposal).toBeNull();
    expect(cells.last().size).toBe(0);
    for (const [stepId, cell] of previewed) expect(grid.last()?.steps.get(stepId)).toEqual(cell);
  });
});

describe("palette and suggestions", () => {
  it("tell what each palette group still needs", () => {
    const store = demoStore();
    const p = probe(store, usePalette);
    const selected = p.last().find((g) => g.items.some((i) => i.phrase === "Mark it done"))!;
    expect(selected).toMatchObject({ available: false, hint: "Select a task first" });
    change(() => store.getState().select(taskByTitle(openProject(store), "UI Design").id));
    expect(p.last().find((g) => g.group === selected.group)).toMatchObject({ available: true, hint: "" });
  });

  it("follow the selection", () => {
    const store = demoStore();
    const p = probe(store, useSuggestions);
    expect(p.last()).toContain("Add a moodboard for the project");
    change(() => store.getState().select(taskByTitle(openProject(store), "UI Design").id));
    expect(p.last()).toEqual(["Break this task into smaller steps", "Make this more prominent", "Mark it done"]);
  });
});

describe("the runtime", () => {
  it("keeps the view in the URL and exposes the handle outside production", () => {
    const store = demoStore(["cards", "board"]);
    window.history.replaceState(null, "", "/demo");
    probe(store, useFormRuntime);
    expect((window as unknown as { __form?: FormStore }).__form).toBe(store);
    change(() => store.getState().showView("board"));
    expect(window.location.pathname + window.location.search).toBe("/demo?view=board");
    change(() => store.getState().showView("cards"));
    expect(window.location.search).toBe("");
  });

  it("ticks today at local midnight", () => {
    vi.setSystemTime(Date.parse("2026-10-14T21:59:30Z"));
    const store = demoStore();
    probe(store, useFormRuntime);
    act(() => void vi.advanceTimersByTime(31_000));
    expect(store.getState().today).toBe("2026-10-15");
  });
});
