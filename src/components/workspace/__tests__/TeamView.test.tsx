// The Team view on the v2 store (plan §8.2 TeamView, §6.5, ED-3, ED-9): rows are the project's
// members from the Phase 1 lanes, the figures are the lanes' numbers, the plan card reads the
// reassign proposal and its preview, "Add person" gives a visible 5 and a command-added person
// shows "Capacity unknown" (Q3).
import { MotionGlobalConfig } from "motion/react";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PersonId } from "@/lib/domain/schema/ids";
import type { FormStore } from "@/lib/store/form";
import { FormStoreProvider } from "@/lib/store/hooks";
import { demoStore, NOW_MS, openProject } from "@/lib/store/__tests__/support";
import { TeamView } from "../TeamView";

// happy-dom has no layout: the board gets a desktop width, so its rows render
vi.mock("@/lib/useWidth", () => ({ useWidth: () => [{ current: null }, 1100] }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MARTA = "per_demomarta";
const SARA = "per_demosara";
const LUCA = "per_demoluca";

const mounted: (() => void)[] = [];

// Motion's animations finish at once: happy-dom's Web Animations reject when Motion cancels them
beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true;
});
afterAll(() => {
  MotionGlobalConfig.skipAnimations = false;
});

beforeEach(() => {
  vi.useFakeTimers({ now: NOW_MS });
});
afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
  vi.useRealTimers();
});

function render(store: FormStore): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(FormStoreProvider, { store }, createElement(TeamView))));
  mounted.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

const rowIds = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>("[data-team-row]")].map((r) => r.dataset.teamRow);
const row = (host: HTMLElement, id: string) => {
  const el = host.querySelector<HTMLElement>(`[data-team-row="${id}"]`);
  if (!el) throw new Error(`No row ${id}`);
  return el;
};
/** The LoadFigure: "10/6d" and "+4d over" */
const figure = (host: HTMLElement, id: string) => {
  const num = row(host, id).querySelector(".t-num");
  return [num?.textContent ?? null, num?.nextElementSibling?.textContent ?? null];
};
/** A button by its label (ShuffleText keeps it in an sr-only span) */
const label = (b: Element) => b.querySelector(".sr-only")?.textContent ?? b.textContent;
const button = (host: HTMLElement, text: string) => {
  const el = [...host.querySelectorAll("button")].find((b) => label(b) === text);
  if (!el) throw new Error(`No button "${text}"`);
  return el;
};

describe("TeamView", () => {
  it("draws the members' lanes with the weekly figures (ED-3)", () => {
    const host = render(demoStore(["team"]));
    expect(rowIds(host)).toEqual([MARTA, SARA, LUCA]);
    expect(figure(host, MARTA)).toEqual(["10/6d", "+4d over"]);
    expect(figure(host, SARA)).toEqual(["0/4d", "4d free"]);
    expect(figure(host, LUCA)).toEqual(["8/15d", "7d free"]);
    expect(row(host, MARTA).textContent).toContain("Art director");
    expect([...row(host, MARTA).querySelectorAll("[data-task-id]")].map((s) => s.textContent)).toEqual(["Visual Direction4d · 85%", "UI Design6d · 30%"]);
    expect(host.textContent).toContain("Sample team · rename anyone");
    expect(button(host, "Balance with FORM")).toBeTruthy();
  });

  it("previews and accepts the balance proposal", async () => {
    const store = demoStore(["team"]);
    store.getState().setReducedMotion(true);
    const host = render(store);
    await act(() => store.getState().submit("Balance the workload"));
    expect(openProject(store).proposal?.kind).toBe("reassign");

    expect(host.textContent).toContain("Move UI Design to Sara");
    expect(host.textContent).toContain("Marta is 4d over capacity. Sara has room for its 6d.");
    expect(figure(host, MARTA)).toEqual(["10 4/4d", "0d free"]);
    expect(figure(host, SARA)).toEqual(["0 6/8d", "2d free"]);
    // The handover lands in Sara's row as a dashed ghost
    expect(row(host, SARA).textContent).toContain("UI Designfrom Marta");
    expect([...host.querySelectorAll("button")].some((b) => label(b) === "Balance with FORM")).toBe(false);

    act(() => button(host, "Accept").click());
    expect(figure(host, MARTA)).toEqual(["4/4d", "0d free"]);
    expect(figure(host, SARA)).toEqual(["6/8d", "2d free"]);
    expect(row(host, SARA).querySelector('[data-task-id]')?.textContent).toBe("UI Design6d · 30%");
  });

  it("previews a handover to someone who isn't a member yet", async () => {
    const store = demoStore(["team"]);
    store.getState().setReducedMotion(true);
    // In the workspace with 5 days a week, but not in the project
    const giulia = "per_giulia0000000000" as PersonId;
    const addGiulia = { op: "addPerson", personId: giulia, name: "Giulia", role: null, email: null, capacityDaysPerWeek: 5, dayRateCents: null } as const;
    act(() => void store.getState().commit([addGiulia], { label: "giulia" }));
    const host = render(store);
    expect(rowIds(host)).toEqual([MARTA, SARA, LUCA]);
    await act(() => store.getState().submit("Balance the workload"));
    expect(host.textContent).toContain("Move UI Design to Giulia");
    expect(host.textContent).toContain("Marta is 4d over capacity. Giulia has room for its 6d.");
    // Her row joins for the preview, after the members, with the work that would land on her
    expect(rowIds(host)).toEqual([MARTA, SARA, LUCA, giulia]);
    expect(row(host, giulia).textContent).toContain("UI Designfrom Marta");
    expect(figure(host, giulia)).toEqual(["0 6/10d", "4d free"]);
    act(() => button(host, "Accept").click());
    expect(openProject(store).memberIds).toContain(giulia);
    expect(figure(host, giulia)).toEqual(["6/10d", "4d free"]);
  });

  it("adds a person with a visible 5 days a week (Q3, ED-9)", () => {
    const store = demoStore(["team"]);
    const host = render(store);
    act(() => button(host, "Add person").click());
    const ids = rowIds(host);
    expect(ids).toHaveLength(4);
    const added = ids[3]!;
    expect(row(host, added).textContent).toContain("Person 4");
    expect(figure(host, added)).toEqual(["0/5d", "5d free"]);
  });

  it("shows an unknown capacity without a verdict (Q3, ED-9)", async () => {
    const store = demoStore(["team"]);
    store.getState().setReducedMotion(true);
    const host = render(store);
    await act(() => store.getState().submit("Add Giulia to the team"));
    const giulia = rowIds(host).find((id) => row(host, id!).textContent?.includes("Giulia"));
    expect(giulia).toBeDefined();
    expect(figure(host, giulia!)).toEqual(["0d", "Capacity unknown"]);
    // No capacity line on an unknown capacity: the lane and the hatch only
    const track = row(host, giulia!).children[row(host, giulia!).children.length - 1];
    expect(track.querySelectorAll(".bg-ink")).toHaveLength(0);
    expect(row(host, MARTA).children[row(host, MARTA).children.length - 1].querySelectorAll(".bg-ink")).toHaveLength(1);
  });

  it("reassigns and unassigns by commit", () => {
    const store = demoStore(["team"]);
    const host = render(store);
    const ui = Object.values(openProject(store).tasks).find((t) => t.title === "UI Design")!;
    act(() => void store.getState().commit([{ op: "unassignTask", taskId: ui.id }], { label: "unassign" }));
    expect(rowIds(host)).toEqual([MARTA, SARA, LUCA, "__unassigned"]);
    expect(row(host, "__unassigned").textContent).toContain("Open work without an owner");
    expect(figure(host, MARTA)).toEqual(["4/4d", "0d free"]);
  });

  it("offers a sample team when the project has no members", () => {
    const store = demoStore(["team"]);
    const project = openProject(store);
    act(() => void store.getState().commit(project.memberIds.map((personId) => ({ op: "removeMember", personId }) as const), { label: "empty" }));
    const host = render(store);
    expect(host.textContent).toContain("No team yet");
    act(() => button(host, "Use a sample team").click());
    expect(rowIds(host)).toEqual([MARTA, SARA, LUCA]);
  });
});
