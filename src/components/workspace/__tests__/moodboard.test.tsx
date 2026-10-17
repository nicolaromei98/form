// Area g of the switchover (plan §8.2): the moodboard reads useMoodItems (z order) and changes the
// board through the store's creators and ops. Rendered on the demo after some use (an image, a
// colour and a note on the board), with the image store stubbed: happy-dom has no IndexedDB.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sortedByZ } from "@/lib/domain/order";
import type { FormStore } from "@/lib/store/form";
import { FormStoreProvider } from "@/lib/store/hooks";
import { openProject, storeOn } from "../../../lib/store/__tests__/support";
import { demoExtrasState } from "../../../../test/fixtures/v2/build";
import { MoodboardBlock } from "../Moodboard";

vi.mock("@/lib/assets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/assets")>();
  return {
    ...actual,
    // Stored under the id the creator minted, with v0's fallback proportions
    ingestImage: vi.fn(async (_file: File, assetId?: string | number) => ({ asset: String(assetId), aspect: 0.75 })),
    useAssetUrl: (id: string | null) => ({ url: id ? `blob:${id}` : null, missing: false }),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// happy-dom's Web Animations reject when Motion stops them: Motion's own frame loop animates instead
delete (Element.prototype as { animate?: unknown }).animate;

// Tiles mount once the board's width is known: happy-dom lays nothing out, so give it one
const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
beforeAll(() => Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1000 }));
afterAll(() => {
  if (clientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", clientWidth);
});

const mounted: (() => void)[] = [];
afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
  document.body.innerHTML = "";
});

function render(store: FormStore): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(FormStoreProvider, { store }, createElement(MoodboardBlock))));
  mounted.push(() => act(() => root.unmount()));
  return host;
}

function store(): FormStore {
  const s = storeOn(demoExtrasState());
  s.getState().setReducedMotion(true);
  return s;
}

const board = (s: FormStore) => sortedByZ(openProject(s).moodboard.items);
const tileIds = () => [...document.querySelectorAll("[data-mood-id]")].map((el) => el.getAttribute("data-mood-id"));
/** A button by its label; ShuffleText renders its text twice (the measure and the shown letters) */
const button = (text: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === text || b.textContent === text + text || b.getAttribute("aria-label") === text)!;
const lastLabel = (s: FormStore) => s.getState().past.at(-1)?.label;

describe("MoodboardBlock", () => {
  it("lays the references out bottom to top, images by their asset id", () => {
    const s = store();
    const host = render(s);
    expect(tileIds()).toEqual(board(s).map((it) => it.id));
    expect(host.textContent).toContain("3 references · drop, paste or browse");
    const image = board(s).find((it) => it.kind === "image")!;
    expect(image.assetId).toMatch(/^ast_/);
    expect(document.querySelector(`[data-mood-id="${image.id}"] img`)?.getAttribute("src")).toBe(`blob:${image.assetId}`);
  });

  it("adds an empty note on top, selected and open for writing, then removes it", () => {
    const s = store();
    render(s);
    act(() => button("Note").click());
    const note = board(s).at(-1)!;
    expect(note).toMatchObject({ kind: "note", text: "" });
    expect(board(s)).toHaveLength(4);
    expect(tileIds().at(-1)).toBe(note.id);
    expect(document.querySelector(`[data-mood-id="${note.id}"] p`)?.getAttribute("contenteditable")).toBe("plaintext-only");
    expect(lastLabel(s)).toBe("add note");
    expect(s.getState().caption).toBeNull();

    act(() => button("Remove reference").click());
    expect(board(s).map((it) => it.id)).not.toContain(note.id);
    expect(lastLabel(s)).toBe("remove reference");
  });

  it("removes the selected reference with Backspace", () => {
    const s = store();
    render(s);
    act(() => button("Note").click());
    const note = board(s).at(-1)!;
    act(() => void document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true })));
    expect(board(s)).toHaveLength(3);
    expect(board(s).map((it) => it.id)).not.toContain(note.id);
  });

  it("lets go quietly of a selected reference that left the board", () => {
    const s = store();
    render(s);
    act(() => button("Note").click());
    act(() => void s.getState().undo());
    expect(board(s)).toHaveLength(3);
    const entries = s.getState().past.length;
    act(() => void document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true })));
    expect(s.getState().past).toHaveLength(entries);
    expect(s.getState().caption).toBeNull();
  });

  it("arranges the references on the board in one command", () => {
    const s = store();
    render(s);
    const before = board(s);
    act(() => button("Grid").click());
    expect(lastLabel(s)).toBe("arrange grid");
    expect(board(s).map((it) => it.id)).toEqual(before.map((it) => it.id));
    expect(board(s)).not.toEqual(before);
  });

  it("adds a colour from the picker", () => {
    const s = store();
    render(s);
    act(() => button("Colour").click());
    act(() => button("Add").click());
    expect(board(s).at(-1)).toMatchObject({ kind: "color", hex: "#c8b8a6", text: null });
    expect(lastLabel(s)).toBe("add colour");
  });

  it("stores browsed images under fresh ast_ ids and adds them in one command", async () => {
    const s = store();
    const host = render(s);
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    const files = [new File(["a"], "a.png", { type: "image/png" }), new File(["b"], "b.txt", { type: "text/plain" })];
    Object.defineProperty(input, "files", { configurable: true, value: files });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const image = board(s).at(-1)!;
    expect(board(s)).toHaveLength(4);
    expect(image).toMatchObject({ kind: "image", w: 0.24, h: 0.18 });
    expect(image.assetId).toMatch(/^ast_[0-9a-z]{16}$/);
    expect(lastLabel(s)).toBe("add 1 image");
    expect(host.textContent).toContain("4 references");
    expect(document.querySelector(`[data-mood-id="${image.id}"] img`)?.getAttribute("src")).toBe(`blob:${image.assetId}`);
  });
});
