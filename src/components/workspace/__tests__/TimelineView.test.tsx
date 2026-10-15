// The timeline on the v2 store (plan §8.2, ED-1, ED-2): working-day bars on the v0 calendar-day
// grid, unknown rows that name their root, the proposed steps drawn where accepting puts them,
// and every edit as one command.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormStore } from "@/lib/store/form";
import { FormStoreProvider } from "@/lib/store/hooks";
import { taskByTitle } from "../../../../test/fixtures/v2/build";
import { demoStore, NOW_MS, openProject } from "../../../lib/store/__tests__/support";
import { TimelineView } from "../TimelineView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: (() => void)[] = [];

beforeEach(() => {
  vi.useFakeTimers({ now: NOW_MS });
});
afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
  vi.useRealTimers();
});

function mount(store: FormStore): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      <FormStoreProvider store={store}>
        <TimelineView />
      </FormStoreProvider>,
    ),
  );
  mounted.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

const change = (fn: () => void) => act(fn);
const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ");
const px = (el: Element, prop: "left" | "width") => Number.parseFloat((el as HTMLElement).style[prop]);
const button = (host: HTMLElement, label: string) => {
  const found = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!found) throw new Error(`No button "${label}"`);
  return found;
};
/** The bar of a task (its left edge sits one pixel inside its first cell) */
const barOf = (host: HTMLElement, id: string) => {
  const found = host.querySelector(`button[data-task-id="${id}"]`);
  if (!found) throw new Error(`No bar for ${id}`);
  return found;
};

describe("TimelineView", () => {
  it("draws the working-day schedule on calendar days, labelled as a sample (ED-1, ED-2)", () => {
    const store = demoStore(["timeline"]);
    const host = mount(store);
    const all = text(host);
    // Research 3d from Mon 28 Sep; each bar spans the weekend inside it
    for (const range of ["28.09–30.09", "01.10–06.10", "07.10–14.10", "15.10–26.10"]) expect(all).toContain(range);
    expect(all).toContain("Today 14.10");
    expect(all).toContain("Sample schedule · working days, from estimates and dependencies");
    expect(all).not.toContain("without dates");
    expect(all).toContain("28 Sep 2026 · sample date");
    expect(host.querySelectorAll("button[data-task-id]")).toHaveLength(4);

    // Visual Direction (4 working days from Thu 1 Oct) covers 6 calendar cells
    const p = openProject(store);
    const research = barOf(host, taskByTitle(p, "Research").id);
    const visual = barOf(host, taskByTitle(p, "Visual Direction").id);
    const dayW = px(research, "left") - 1; // Research starts on cell 0, one cell after the grid's first
    expect(px(visual, "left") - px(research, "left")).toBeCloseTo(3 * dayW);
    expect(px(visual, "width")).toBeCloseTo(6 * dayW - 2);
  });

  it("names the root of unknown dates and offers a duration only on it", () => {
    const store = demoStore(["timeline"]);
    const ui = taskByTitle(openProject(store), "UI Design");
    const host = mount(store);
    change(() => void store.getState().commit([{ op: "updateTask", taskId: ui.id, field: "estimateDays", value: null }], { label: "edit" }));
    const all = text(host);
    expect(all).toContain("Needs a duration");
    expect(all).toContain("Needs UI Design's estimate");
    expect(all).toContain("Sample schedule · working days, from estimates and dependencies · 2 without dates");
    expect([...host.querySelectorAll("button")].filter((b) => text(b).includes("+ Duration"))).toHaveLength(1);
    expect(host.querySelectorAll("button[data-task-id]")).toHaveLength(2);
  });

  it("draws a project with no date at all on working days, without dates", () => {
    const store = demoStore(["timeline"]);
    const host = mount(store);
    change(() => void store.getState().commit([{ op: "updateProject", field: "startDate", value: null }], { label: "edit" }));
    const all = text(host);
    expect(host.querySelectorAll("button[data-task-id]")).toHaveLength(4);
    expect(all).not.toMatch(/\d\d\.\d\d–\d\d\.\d\d/);
    expect(all).not.toContain("Today");
    expect(all).toContain("Schedule · working days, from estimates and dependencies");
    expect(all).not.toContain("sample date");
  });

  it("draws the proposed steps where accepting puts them", () => {
    const store = demoStore(["timeline"]);
    const ui = taskByTitle(openProject(store), "UI Design");
    const mint = store.deps.mint;
    const [a, b, c] = [mint("step"), mint("step"), mint("step")];
    const host = mount(store);
    change(
      () =>
        void store.getState().commit(
          [
            {
              op: "proposeSubtasks",
              proposalId: mint("proposal"),
              taskId: ui.id,
              items: [
                { stepId: a, title: "Wireframes", estimateDays: 2 },
                { stepId: b, title: "Components", estimateDays: 1.5 },
                { stepId: c, title: "Handoff", estimateDays: null },
              ],
              source: "direct",
            },
          ],
          { label: "propose" },
        ),
    );
    expect(text(host)).toContain("Accept 3 steps");
    const dashed = [...host.querySelectorAll(".border-dashed.border-line-strong")];
    expect(dashed).toHaveLength(2);
    const dayW = px(barOf(host, taskByTitle(openProject(store), "Research").id), "left") - 1;
    // Wireframes: Wed 7 and Thu 8, from the task's start. Components: 1.5d → 2 working days, Fri 9 and Mon 12
    expect(px(dashed[0], "left")).toBeCloseTo(px(barOf(host, ui.id), "left"));
    expect(px(dashed[0], "width")).toBeCloseTo(2 * dayW - 2);
    expect(px(dashed[1], "left") - px(dashed[0], "left")).toBeCloseTo(2 * dayW);
    expect(px(dashed[1], "width")).toBeCloseTo(4 * dayW - 2);
    const previewed = dashed.map((d) => [px(d, "left"), px(d, "width")]);

    change(() => store.getState().resolveProposal(true));
    expect(openProject(store).proposal).toBeNull(); // its rows leave through AnimatePresence
    const steps = [...host.querySelectorAll<HTMLElement>("div.absolute")].filter((d) => d.style.height === "12px");
    expect(steps.map((d) => [px(d, "left"), px(d, "width")])).toEqual(previewed);
  });

  it("changes data through commands: step done and title, task title, start week", () => {
    const store = demoStore(["timeline"]);
    const ui = taskByTitle(openProject(store), "UI Design");
    const step = store.deps.mint("step");
    change(() => void store.getState().commit([{ op: "addStep", taskId: ui.id, stepId: step, title: "Wireframes", estimateDays: 2, after: "end" }], { label: "add step" }));
    const host = mount(store);
    const before = store.getState().past.length;

    act(() => button(host, "Mark Wireframes done").click());
    expect(openProject(store).tasks[ui.id].steps[0].done).toBe(true);
    expect(host.querySelector("button[aria-label='Mark Wireframes not done']")).not.toBeNull();

    const edit = (label: string, from: string, to: string) => {
      const box = [...host.querySelectorAll<HTMLElement>(`[role="textbox"][aria-label="${label}"]`)].find((el) => el.textContent === from);
      if (!box) throw new Error(`No ${label} "${from}"`);
      act(() => {
        box.focus();
        box.textContent = to;
        box.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      });
    };
    edit("Step title", "Wireframes", "Flows");
    expect(openProject(store).tasks[ui.id].steps[0].title).toBe("Flows");
    edit("Task title", "UI Design", "Interface");
    expect(openProject(store).tasks[ui.id].title).toBe("Interface");

    act(() => button(host, "Start one week later").click());
    const p = openProject(store);
    expect([p.startDate, p.startConfirmed]).toEqual(["2026-10-05", true]);
    const all = text(host);
    expect(all).toContain("Schedule · working days, from estimates and dependencies");
    expect(all).not.toContain("Sample schedule");
    expect(all).toContain("5 Oct 2026");
    expect(all).not.toContain("sample date");
    expect(all).toContain("05.10–07.10");
    // One history entry per edit
    expect(store.getState().past.length - before).toBe(4);
  });
});
