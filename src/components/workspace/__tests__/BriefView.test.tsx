// The brief on the v2 store (plan §8.2, ED-5): the composed brief through useBrief, the
// audience as a view option, and every edit (rewrite, hide, show hidden, add, remove, reset)
// as one v2 command with minted ids and the user's words stored as one trimmed line.
import { MotionGlobalConfig } from "motion/react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormStore } from "@/lib/store/form";
import { FormStoreProvider } from "@/lib/store/hooks";
import { demoStore, NOW_MS, openProject } from "../../../lib/store/__tests__/support";
import { BriefView } from "../BriefView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// happy-dom's Web Animations reject when Motion stops them: Motion's own frame loop animates instead
delete (Element.prototype as { animate?: unknown }).animate;
// Exits end at once, so a hidden line leaves the page in the same frame
MotionGlobalConfig.skipAnimations = true;

const mounted: (() => void)[] = [];

beforeEach(() => {
  vi.useFakeTimers({ now: NOW_MS });
});
afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mount(store: FormStore): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      <FormStoreProvider store={store}>
        <BriefView />
      </FormStoreProvider>,
    ),
  );
  mounted.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ");
/** Lets exit animations finish, so a line on its way out leaves the page */
const settle = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
const history = (store: FormStore) => store.getState().past.length;
const brief = (store: FormStore) => openProject(store).brief;

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function buttonByText(host: HTMLElement, label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((b) => text(b).includes(label));
  if (!found) throw new Error(`No button "${label}"`);
  return found;
}

function buttonByLabel(host: HTMLElement, label: string): HTMLButtonElement {
  const found = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!found) throw new Error(`No button "${label}"`);
  return found;
}

/** The line whose text contains `words` (its clickable span) */
function lineSpan(host: HTMLElement, words: string): HTMLSpanElement {
  const found = [...host.querySelectorAll<HTMLElement>("[data-interactive].group\\/line > span.cursor-text")].find((s) => text(s).includes(words));
  if (!found) throw new Error(`No line "${words}"`);
  return found as HTMLSpanElement;
}

/** Types into the open editor and presses Enter */
function typeAndEnter(host: HTMLElement, words: string) {
  const editor = host.querySelector<HTMLElement>('[role="textbox"][contenteditable]');
  if (!editor) throw new Error("No editor open");
  act(() => {
    editor.textContent = words;
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

describe("BriefView", () => {
  it("shows the composed client brief (ED-5)", () => {
    const store = demoStore(["cards", "brief"]);
    const host = mount(store);
    const all = text(host);
    expect(host.querySelector(".sr-only")?.textContent).toBe("Status, 14 Oct, For the client, Sample schedule");
    expect(all).toContain("On the sample schedule, the last task ends 26 Oct.");
    expect(all).toContain("UI Design is urgent.");
    expect(all).toContain("Add a note for the client");
    // Task mentions select their task (Point & Ask)
    click(buttonByLabel(host, "UI Design. Select to ask FORM about it"));
    expect(store.getState().local.selectedTaskId).not.toBeNull();
    expect(history(store)).toBe(0);
  });

  it("switches audience as a view option, with the team's load line and names (ED-5)", () => {
    const store = demoStore(["cards", "brief"]);
    const host = mount(store);
    click(buttonByText(host, "Team"));
    expect(openProject(store).viewConfig.brief.audience).toBe("team");
    expect(history(store)).toBe(1);
    expect(text(host)).toContain("Marta is 4 days over capacity.");
    expect(text(host)).toContain("Add a note for the team");
  });

  it("rewrites, restores and hides a composed line, one command each", async () => {
    const store = demoStore(["cards", "brief"]);
    const host = mount(store);

    click(lineSpan(host, "UI Design is urgent."));
    typeAndEnter(host, "  UI Design   needs the copy first. ");
    const key = Object.keys(brief(store).edits)[0];
    expect(key).toMatch(/^client:risks:tsk_/);
    expect(brief(store).edits[key]).toEqual({ text: "UI Design needs the copy first.", basis: "UI Design is urgent." });
    expect(history(store)).toBe(1);
    expect(text(host)).toContain("UI Design needs the copy first.");
    expect(text(host)).toContain("1 edit · Reset to FORM’s version");

    click(buttonByLabel(host, "Back to FORM's wording"));
    expect(brief(store).edits).toEqual({});
    expect(history(store)).toBe(2);
    expect(text(host)).toContain("UI Design is urgent.");

    // An emptied line is hidden; "Show N hidden" brings every hidden line back in one command
    click(lineSpan(host, "UI Design is urgent."));
    typeAndEnter(host, "");
    expect(brief(store).edits[key]).toEqual({ text: "", basis: "UI Design is urgent." });
    await settle();
    expect(text(host)).not.toContain("UI Design is urgent.");
    click(lineSpan(host, "On the sample schedule"));
    typeAndEnter(host, "");
    expect(Object.keys(brief(store).edits)).toHaveLength(2);
    expect(history(store)).toBe(4);
    click(buttonByText(host, "Show 2 hidden"));
    expect(brief(store).edits).toEqual({});
    expect(history(store)).toBe(5);
    expect(text(host)).toContain("UI Design is urgent.");
  });

  it("adds, rewrites and removes the user's own lines, then resets the audience", () => {
    const store = demoStore(["cards", "brief"]);
    const host = mount(store);

    click(buttonByText(host, "Add a note for the client"));
    typeAndEnter(host, "  Hi Anna,\n here's   where we are ");
    const [note] = brief(store).lines;
    expect(note).toMatchObject({ audience: "client", section: "note", text: "Hi Anna, here's where we are" });
    expect(note.id).toMatch(/^brl_[0-9a-z]{16}$/);
    expect(text(host)).toContain("Hi Anna, here's where we are");

    // A blank line adds nothing
    click(buttonByText(host, "Add a line"));
    typeAndEnter(host, "   ");
    expect(brief(store).lines).toHaveLength(1);
    expect(history(store)).toBe(1);

    click(lineSpan(host, "Hi Anna"));
    typeAndEnter(host, "Hi Anna, a quick update");
    expect(brief(store).lines[0]).toMatchObject({ id: note.id, text: "Hi Anna, a quick update" });
    expect(history(store)).toBe(2);

    // Emptying a line of the user's own removes it
    click(lineSpan(host, "Hi Anna"));
    typeAndEnter(host, "");
    expect(brief(store).lines).toEqual([]);
    expect(history(store)).toBe(3);

    click(buttonByText(host, "Add a note for the client"));
    typeAndEnter(host, "Second note");
    click(buttonByLabel(host, "Remove this line"));
    expect(brief(store).lines).toEqual([]);
    expect(history(store)).toBe(5);

    click(buttonByText(host, "Add a note for the client"));
    typeAndEnter(host, "Third note");
    click(lineSpan(host, "UI Design is urgent."));
    typeAndEnter(host, "Mine");
    expect(text(host)).toContain("2 edits · Reset to FORM’s version");
    click(buttonByText(host, "Reset to FORM’s version"));
    expect(brief(store)).toMatchObject({ edits: {}, lines: [] });
    expect(history(store)).toBe(8);
  });

  it("flags a rewritten line whose facts moved on, and keeps the user's words on request", () => {
    const store = demoStore(["cards", "brief"]);
    const host = mount(store);
    click(lineSpan(host, "UI Design is urgent."));
    typeAndEnter(host, "UI Design is the one to watch.");
    const p = openProject(store);
    const ui = Object.values(p.tasks).find((t) => t.title === "UI Design")!;
    act(() => void store.getState().commit([{ op: "updateTask", taskId: ui.id, field: "title", value: "UI Screens" }], { label: "edit" }));
    expect(text(host)).toContain("FORM’s version changed: “UI Screens is urgent.”");
    click(buttonByText(host, "Keep mine"));
    const [edit] = Object.values(brief(store).edits);
    expect(edit).toEqual({ text: "UI Design is the one to watch.", basis: "UI Screens is urgent." });
    expect(text(host)).not.toContain("FORM’s version changed");
  });

  it("copies the brief as the page shows it, names included", async () => {
    const writeText = vi.fn<(t: string) => Promise<void>>(() => Promise.resolve());
    vi.stubGlobal("ClipboardItem", undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const store = demoStore(["cards", "brief"]);
    act(() => void store.getState().commit([{ op: "setView", patch: { briefAudience: "team" } }], { label: "team" }));
    const host = mount(store);
    click(lineSpan(host, "Marta is 4 days over capacity."));
    typeAndEnter(host, "Marta needs help.");
    await act(async () => {
      buttonByText(host, "Copy").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0];
    expect(copied.startsWith("New website · Status · 14 Oct · For the team · Sample schedule")).toBe(true);
    expect(copied).toContain("– Marta needs help.");
    expect(copied).toContain("with Marta");
    expect(text(host)).toContain("Copied");
  });
});
