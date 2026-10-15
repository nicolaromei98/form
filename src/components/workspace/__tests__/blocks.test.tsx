// The header, metrics and progress blocks on the v2 store (plan §8.2 blocks.tsx): the title is an
// updateProject commit, the subtitle reads the metrics and the unconfirmed start, the tabs are the
// project's views and switching them is local (Q6: no command, no history entry), the view
// controls are setView commits, and the figures come from the planning metrics.
import { MotionGlobalConfig } from "motion/react";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StepId } from "@/lib/domain/schema/ids";
import type { FormStore } from "@/lib/store/form";
import { FormStoreProvider } from "@/lib/store/hooks";
import { taskByTitle } from "../../../../test/fixtures/v2/build";
import { demoStore, NOW_MS, openProject } from "../../../lib/store/__tests__/support";
import { CollectionBlock, HeaderBlock, MetricsBlock, ProgressBlock } from "../blocks";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// happy-dom's Web Animations reject when Motion stops them: Motion's own frame loop animates instead
delete (Element.prototype as { animate?: unknown }).animate;
// Exits end at once, so a closing tab leaves the page in the same frame
MotionGlobalConfig.skipAnimations = true;

const mounted: (() => void)[] = [];

beforeEach(() => {
  vi.useFakeTimers({ now: NOW_MS });
});
afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
  vi.useRealTimers();
});

/** A demo store in reduced motion (the title's word reveal is skipped) */
function store(views: Parameters<typeof demoStore>[0]): FormStore {
  const s = demoStore(views);
  s.getState().setReducedMotion(true);
  return s;
}

function mount(s: FormStore, ui: ReactElement): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<FormStoreProvider store={s}>{ui}</FormStoreProvider>));
  mounted.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ");
const history = (s: FormStore) => s.getState().past.length;
const change = (fn: () => void) => act(fn);
const settle = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

const tabs = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>("[data-rep-tab]")].map((b) => b.dataset.repTab);
const eyebrow = (host: HTMLElement) => host.querySelector("span[aria-label^='Project · ']")?.getAttribute("aria-label");
const subtitle = (host: HTMLElement) => host.querySelector("p[aria-label]")?.getAttribute("aria-label");
const toggle = (host: HTMLElement, label: string) => {
  const found = [...host.querySelectorAll<HTMLButtonElement>('button[role="switch"]')].find((b) => text(b).includes(label));
  if (!found) throw new Error(`No switch "${label}"`);
  return found;
};

describe("HeaderBlock", () => {
  it("reads the title, the metrics and the sample start", () => {
    const s = store(["cards", "board"]);
    const host = mount(s, <HeaderBlock />);
    expect(eyebrow(host)).toBe("Project · Tracker");
    expect(host.querySelector('[role="textbox"][aria-label="Project title"]')?.textContent).toBe("New website");
    expect(subtitle(host)).toBe("4 tasks · sample start 28 Sep");

    const ui = taskByTitle(openProject(s), "UI Design");
    change(() => void s.getState().commit([{ op: "updateTask", taskId: ui.id, field: "estimateDays", value: null }], { label: "edit" }));
    expect(subtitle(host)).toBe("4 tasks · 1 without duration · sample start 28 Sep");

    // A start the user sets is no longer a sample
    change(() => void s.getState().commit([{ op: "updateProject", field: "startConfirmed", value: true }], { label: "start" }));
    expect(subtitle(host)).toBe("4 tasks · 1 without duration · starts 28 Sep");
  });

  it("renames the project with one updateProject command", () => {
    const s = store(["cards"]);
    const host = mount(s, <HeaderBlock />);
    const title = host.querySelector<HTMLElement>('[role="textbox"][aria-label="Project title"]')!;
    act(() => {
      title.textContent = "  Studio   site ";
      title.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(openProject(s).title).toBe("Studio site");
    expect(history(s)).toBe(1);
    expect(s.getState().past.at(-1)?.label).toBe("rename project");
  });

  it("shows the project's views as tabs; a tab switch is local, not history (Q6)", async () => {
    const s = store(["cards", "board", "timeline"]);
    const host = mount(s, <HeaderBlock />);
    expect(tabs(host)).toEqual(["cards", "board", "timeline"]);
    expect(host.querySelector('[data-rep-tab="cards"]')?.getAttribute("aria-selected")).toBe("true");

    click(host.querySelector('[data-rep-tab="board"]')!);
    expect(s.getState().local.activeView).toBe("board");
    expect(history(s)).toBe(0);
    expect(s.getState().changes).toBe(0);
    expect(eyebrow(host)).toBe("Project · Board");
    expect(host.querySelector('[data-rep-tab="board"]')?.getAttribute("aria-selected")).toBe("true");

    // A view the project gains grows in as a tab; one it loses closes
    change(() => void s.getState().commit([{ op: "addView", view: "team" }], { label: "add team" }));
    expect(tabs(host)).toEqual(["cards", "board", "timeline", "team"]);
    change(() => void s.getState().commit([{ op: "removeView", view: "timeline" }], { label: "remove timeline" }));
    await settle();
    expect(tabs(host)).toEqual(["cards", "board", "team"]);
  });

  it("commits the view options as setView", () => {
    const s = store(["cards", "timeline", "brief"]);
    const host = mount(s, <HeaderBlock />);
    const before = openProject(s).viewConfig;
    click(toggle(host, "Hide done"));
    click(toggle(host, "Compact"));
    click(toggle(host, "Urgent"));
    const v = openProject(s).viewConfig;
    expect([v.hideDone, v.density, v.highlightUrgent]).toEqual([!before.hideDone, "compact", !before.highlightUrgent]);
    expect(history(s)).toBe(3);

    // Sorting
    const sort = [...host.querySelectorAll("button")].find((b) => text(b).startsWith("Sort"))!;
    click(sort);
    const priority = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find((b) => text(b) === "Priority")!;
    click(priority);
    expect(openProject(s).viewConfig.sort).toBe("priority");
    expect(history(s)).toBe(4);

    // The timeline follows workflow order: no sorting there
    act(() => s.getState().showView("timeline"));
    expect([...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => text(b).startsWith("Sort"))?.disabled).toBe(true);

    // The brief's only control is its length
    act(() => s.getState().showView("brief"));
    const switches = host.querySelectorAll('button[role="switch"]');
    expect(switches).toHaveLength(1);
    expect(text(switches[0])).toContain("Short version");
    click(toggle(host, "Short version"));
    expect(openProject(s).viewConfig.brief.short).toBe(true);
    expect(history(s)).toBe(5);
  });

  it("steps down to one line in Focus", () => {
    const s = store(["cards", "focus"]);
    act(() => s.getState().showView("focus"));
    const host = mount(s, <HeaderBlock />);
    expect(host.querySelector("span[aria-label='Focus']")).not.toBeNull();
    expect(host.querySelector("span[aria-label='New website']")).not.toBeNull();
    expect(host.querySelector('[role="textbox"]')).toBeNull();
    expect(tabs(host)).toEqual(["cards", "focus"]);
  });
});

describe("MetricsBlock and ProgressBlock", () => {
  it("read the planning metrics", () => {
    const s = store(["cards"]);
    const host = mount(
      s,
      <>
        <MetricsBlock />
        <ProgressBlock />
      </>,
    );
    const all = text(host);
    // (100×3 + 85×4 + 30×6 + 0×8) / 21 = 39%
    for (const figure of ["Complete39%", "Done1/4", "Estimate21d", "Urgent1"]) expect(all).toContain(figure);
    expect(all).not.toContain("Steps");
    expect(all).not.toContain("Known cost");
    expect(host.querySelector('svg[aria-label="39% complete"]')).not.toBeNull();
    expect([...host.querySelectorAll("[title]")].map((el) => el.getAttribute("title"))).toEqual([
      "Research · 100%",
      "Visual Direction · 85%",
      "UI Design · 30%",
      "Development · 0%",
    ]);

    const p = openProject(s);
    const research = taskByTitle(p, "Research");
    const dev = taskByTitle(p, "Development");
    change(() =>
      void s.getState().commit(
        [
          { op: "updateTask", taskId: research.id, field: "costCents", value: 120000 },
          { op: "addStep", taskId: dev.id, stepId: StepId.parse("stp_0000000000000001"), title: "Build", estimateDays: null, after: "end" },
        ],
        { label: "edit" },
      ),
    );
    expect(text(host)).toContain("Known cost€1,200");
    expect(text(host)).toContain("Steps1");
  });
});

describe("CollectionBlock", () => {
  it("shows the view on screen", () => {
    const s = store(["cards", "brief"]);
    act(() => s.getState().showView("brief"));
    const host = mount(s, <CollectionBlock />);
    expect(host.querySelector('article[aria-label="Status brief"]')).not.toBeNull();
  });
});
