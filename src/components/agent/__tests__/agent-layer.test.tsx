// Area a of the switchover (plan §8.2): the chrome and the agent read the v2 store through the hooks
// and write through its actions. Rendered on a demo store in reduced motion (no beat, no fluid loop).
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { updateTaskOp } from "@/lib/ops/build";
import type { FormStore } from "@/lib/store/form";
import { FormStoreProvider } from "@/lib/store/hooks";
import { suggestionsFor } from "@/lib/store/suggestions";
import { demoStore, openProject } from "../../../lib/store/__tests__/support";
import { taskByTitle } from "../../../../test/fixtures/v2/build";
import { Chrome } from "../../Chrome";
import { AgentLayer } from "../AgentLayer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// happy-dom's Web Animations reject when Motion stops them: Motion's own frame loop animates instead
delete (Element.prototype as { animate?: unknown }).animate;

const mounted: (() => void)[] = [];
afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
  document.body.innerHTML = "";
});

function render(store: FormStore, ui: ReactElement): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(FormStoreProvider, { store }, ui)));
  mounted.push(() => act(() => root.unmount()));
  return host;
}

/** A demo store at rest, in reduced motion */
function store(views: Parameters<typeof demoStore>[0] = ["cards"]): FormStore {
  const s = demoStore(views);
  s.getState().setReducedMotion(true);
  return s;
}

/** The node labels a user can reach: a label on its way out stays mounted, inert, until its exit ends */
const nodeLabels = () =>
  [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Views FORM suggests"] button')].filter((b) => b.tabIndex === 0).map((b) => b.getAttribute("aria-label"));

describe("Chrome", () => {
  it("names the only engine and counts history entries, not tab switches (ED-7)", () => {
    const s = store(["cards", "board"]);
    const host = render(s, createElement(Chrome));
    expect(host.textContent).toContain("Demo parser · no AI model");
    expect(host.textContent).toContain("Saved locally");
    act(() => s.getState().showView("board"));
    expect(host.textContent).toContain("Saved locally");
    const ui = taskByTitle(openProject(s), "UI Design");
    act(() => void s.getState().commit([updateTaskOp(ui.id, "title", "Screens")], { label: "rename" }));
    expect(host.textContent).toContain("1 changes · saved locally");
  });
});

describe("AgentLayer", () => {
  it("offers the views the project lacks as nodes, and a node runs its phrase through the parser", async () => {
    const s = store(["cards"]);
    render(s, createElement(AgentLayer));
    expect(nodeLabels()).toEqual(["Add the Timeline view", "Add the Board view", "Add the Team view"]);

    const timeline = document.querySelector<HTMLButtonElement>('[aria-label="Add the Timeline view"]')!;
    await act(async () => {
      timeline.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(openProject(s).views).toEqual(["cards", "timeline"]);
    expect(s.getState().local.activeView).toBe("timeline");
    expect(s.getState().caption?.tone).toBe("done");
  });

  it("keeps the nodes quiet while a task is selected or a proposal waits", async () => {
    const s = store(["cards"]);
    render(s, createElement(AgentLayer));
    expect(nodeLabels()).toHaveLength(3);
    const ui = taskByTitle(openProject(s), "UI Design");
    act(() => s.getState().select(ui.id));
    expect(nodeLabels()).toEqual([]);
    act(() => s.getState().select(null));
    expect(nodeLabels()).toHaveLength(3);

    // A plan waiting for an answer (v0's doc.plan) silences them too, until it is resolved
    await act(async () => void (await s.getState().submit("Balance the workload")));
    expect(openProject(s).proposal?.kind).toBe("reassign");
    act(() => s.getState().closeComposer());
    expect(nodeLabels()).toEqual([]);
    act(() => s.getState().resolveProposal(false));
    expect(nodeLabels()).toHaveLength(3);
  });

  it("shows the store's suggestion chips in the composer, and the selected task in its context", () => {
    const s = store(["cards"]);
    render(s, createElement(AgentLayer));
    act(() => s.getState().openComposer());
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Command"]')!;
    expect(input.placeholder).toBe("Change the workspace");
    const st = s.getState();
    const chips = suggestionsFor({ project: openProject(s), ws: st.docs.workspace, local: st.local });
    for (const chip of chips) expect(document.body.textContent).toContain(chip);

    const ui = taskByTitle(openProject(s), "UI Design");
    act(() => s.getState().select(ui.id));
    expect(input.placeholder).toBe("Ask about UI Design");
    expect(document.querySelector('[aria-label="Remove UI Design from context"]')).not.toBeNull();
  });
});
