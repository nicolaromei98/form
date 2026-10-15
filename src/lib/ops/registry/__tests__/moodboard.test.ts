// The moodboard ops of step 10c (plan §11 row 10): addMoodItems, updateMoodItem, removeMoodItem,
// arrangeMood and clearMood. For each: the happy path with its exact caption, the no-op (same
// reference plus noopCaption, or proof that it can't be one), every rejection it can produce, and
// undo by patches. The geometry is domain/mood-geometry's, so boxes are compared bit for bit with
// the frozen v0 module too.
import { applyPatches } from "immer";
import { describe, expect, it } from "vitest";
import { seededMinter } from "@/lib/domain/ids";
import { MOOD_ADD_MAX, MOOD_BOUNDS, MOOD_MAX } from "@/lib/domain/limits";
import { arrange, frontZs, type MoodBox, type MoodRect, patchBox, placeNew } from "@/lib/domain/mood-geometry";
import { compareKeys, sortedByZ } from "@/lib/domain/order";
import type { MoodItemId } from "@/lib/domain/schema/ids";
import type { MoodKind, MoodLayout } from "@/lib/domain/schema/primitives";
import type { MoodItem, ProjectDoc } from "@/lib/domain/schema/project";
import { makeCaptionEnv } from "@/lib/ops/caption-env";
import { REGISTRY } from "@/lib/ops/registry";
import { demoState, emptyState, FIXTURE_TODAY } from "../../../../../test/fixtures/v2/build";
import { namedFixture } from "../../../../../test/fixtures/v2/named";
import { addMoodItems as v0AddMoodItems, arrangeMood as v0ArrangeMood, patchMoodItem as v0PatchMoodItem } from "../../../../../test/legacy/v0/lib/mood";
import type { MoodInput as V0MoodInput, MoodItem as V0MoodItem } from "../../../../../test/legacy/v0/lib/schema";
import {
  apply,
  captionOf,
  deepFreeze,
  expectApplied,
  expectInverse,
  expectNoop,
  expectRejection,
  projectOf,
  run,
  type TestState,
  withDoc,
} from "./support";

const mint = seededMinter(1010);
const demo = (): TestState => deepFreeze(demoState());
/** demo with the moodboard shown and three references: a colour, a note and a colour, bottom first */
const mood3 = (): TestState => deepFreeze(namedFixture("demoMood3"));
/** demo with the moodboard shown and empty */
const moodShown = (): TestState => deepFreeze(namedFixture("demoMoodShown"));
const after = (r: { result: { doc: unknown } }) => r.result.doc as ProjectDoc;
const board = (p: ProjectDoc) => sortedByZ(p.moodboard.items);
const boardOf = (s: TestState) => board(projectOf(s));
const LAYOUTS: readonly MoodLayout[] = ["masonry", "grid", "collage"];

/** A state whose active project is edited by `edit` */
function edited(state: TestState, edit: (p: ProjectDoc) => ProjectDoc): TestState {
  return deepFreeze(withDoc(state, edit(projectOf(state))));
}

/** `n` times the same kind */
const times = (n: number, kind: MoodKind): MoodKind[] => Array.from({ length: n }, () => kind);

/** References of these kinds laid out the way v0 adds them, stacked in creation order */
function itemsOf(kinds: readonly MoodKind[], sizeOf: (kind: MoodKind, i: number) => Partial<MoodRect> = () => ({})): MoodItem[] {
  const zs = frontZs([], kinds.length);
  const placed: MoodRect[] = [];
  return kinds.map((kind, i) => {
    const box = placeNew(kind, sizeOf(kind, i), placed);
    placed.push(box);
    return {
      id: mint("moodItem"),
      kind,
      ...box,
      z: zs[i],
      assetId: kind === "image" ? mint("asset") : null,
      hex: kind === "color" ? "#c65d3b" : null,
      text: kind === "note" ? `Note ${i + 1}` : null,
    };
  });
}

/** demo with the moodboard shown and these references */
function withBoard(items: readonly MoodItem[]): TestState {
  return edited(demo(), (p) => ({
    ...p,
    blocks: ["header", "metrics", "collection", "moodboard"],
    moodboard: { items: Object.fromEntries(items.map((it) => [it.id, it])) },
  }));
}

/** Portrait, landscape and square images, notes and colours, in a mixed stack */
function mixedBoard(): TestState {
  const kinds: MoodKind[] = ["image", "note", "color", "image", "note", "image", "color"];
  const sizes: Partial<MoodRect>[] = [{ w: 0.24, h: 0.32 }, {}, {}, { w: 0.3, h: 0.12 }, { w: 0.2, h: 0.2 }, { w: 0.18, h: 0.18 }, {}];
  return withBoard(itemsOf(kinds, (_, i) => sizes[i]));
}

/** An op's noopCaption, read straight from the registry (for ops that can't be no-ops) */
function noopText(s: TestState, raw: { op: string }): string | null {
  const def = REGISTRY.get(raw.op)!;
  const env = makeCaptionEnv({ after: s, before: s, projectId: s.projectId, today: FIXTURE_TODAY });
  return def.noopCaption({ op: def.schema.parse(raw), before: projectOf(s), env });
}

/** The same box, bit for bit (Object.is tells 0 from -0) */
function expectSameBox(actual: MoodBox, expected: MoodBox) {
  for (const key of ["x", "y", "w", "h", "r"] as const) expect(Object.is(actual[key], expected[key]), `${key}: ${actual[key]} vs ${expected[key]}`).toBe(true);
}

const toV0 = (it: MoodItem): V0MoodItem => ({ id: it.id, kind: it.kind, x: it.x, y: it.y, w: it.w, h: it.h, r: it.r, asset: it.assetId, hex: it.hex, text: it.text });

/* ------------------------------------------------------------------
   addMoodItems
   ------------------------------------------------------------------ */

type RawItem = Record<string, unknown> & { itemId: MoodItemId };
const add = (items: Record<string, unknown>[]) => ({ op: "addMoodItems", items: items.map((it): RawItem => ({ itemId: mint("moodItem"), ...it })) });
const colour = (hex: string, text?: string) => ({ kind: "color", hex, ...(text !== undefined ? { text } : {}) });
const note = (text: string) => ({ kind: "note", text });
const image = () => ({ kind: "image", assetId: mint("asset") });

describe("addMoodItems", () => {
  it("adds colours where v0 put them, stacked in order, and brings the board back", () => {
    const s = demo();
    expect(projectOf(s).blocks).not.toContain("moodboard");
    const op = add([colour("#0C0C0C"), colour("f2efe8", "Off white"), colour("#c53", "Terracotta")]);
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    const items = board(after(r));
    expect(items.map((it) => it.id)).toEqual(op.items.map((it) => it.itemId));
    expect(items.map((it) => [it.kind, it.hex, it.text, it.assetId, it.r])).toEqual([
      ["color", "#0c0c0c", null, null, 0],
      ["color", "#f2efe8", "Off white", null, 0],
      ["color", "#cc5533", "Terracotta", null, 0],
    ]);
    // The same boxes v0 computed for the same inputs on an empty board
    const v0 = v0AddMoodItems([], [
      { kind: "color", hex: "#0C0C0C" },
      { kind: "color", hex: "f2efe8", text: "Off white" },
      { kind: "color", hex: "#c53", text: "Terracotta" },
    ]);
    items.forEach((it, i) => expectSameBox(it, v0[i]));
    expect(after(r).blocks).toEqual(["header", "metrics", "collection", "moodboard"]);
    expect(captionOf(s, op)).toBe("3 colours added to the moodboard");
  });

  it("lands new items in the next free spot, above every item already there", () => {
    const s = mood3();
    const existing = boardOf(s);
    const op = add([note("Warm, tactile, editorial"), image()]);
    const p = after(apply(s, op));
    const added = op.items.map((it) => p.moodboard.items[it.itemId as MoodItemId]);
    const top = existing.at(-1)!.z;
    expect(added.every((it) => compareKeys(it.z, top) > 0)).toBe(true);
    expect(compareKeys(added[0].z, added[1].z)).toBeLessThan(0);
    // v0 placed them among the items already on the board
    const v0 = v0AddMoodItems(existing.map(toV0), [{ kind: "note", text: "Warm, tactile, editorial" }, { kind: "image", asset: "img-1" }]).slice(existing.length);
    added.forEach((it, i) => expectSameBox(it, v0[i]));
    expect(added[1]).toMatchObject({ kind: "image", assetId: op.items[1].assetId, hex: null, text: null });
    expect(p.blocks).toBe(projectOf(s).blocks);
    expect(captionOf(s, op)).toBe("2 references added to the moodboard");
  });

  it("keeps a dropped item where it was dropped, clamped like v0", () => {
    const s = moodShown();
    const op = add([{ ...note("Dropped"), x: 0.95, y: -1, w: 0.9, h: 5 }]);
    const [item] = board(after(apply(s, op)));
    expect(item).toMatchObject({ x: 0.4, y: 0, w: 0.6, h: MOOD_BOUNDS.h.max, r: 0 });
    expectSameBox(item, v0AddMoodItems([], [{ kind: "note", text: "Dropped", x: 0.95, y: -1, w: 0.9, h: 5 }])[0]);
  });

  it("never lands a reference below the board's floor, where v0 broke the document", () => {
    const s = moodShown();
    const tall = Array.from({ length: 8 }, () => ({ ...note("Tall"), w: 0.6, h: 3 }));
    const op = add(tall);
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    const items = board(after(r));
    // v0 put the eighth note at y 21.156, past the stored bound; the first seven land where v0 put them
    const v0 = v0AddMoodItems([], tall.map(({ text, w, h }) => ({ kind: "note", text, w, h })));
    expect(v0[7].y).toBeGreaterThan(MOOD_BOUNDS.y.max);
    items.slice(0, 7).forEach((it, i) => expectSameBox(it, v0[i]));
    expect(items[7]).toMatchObject({ x: v0[7].x, y: MOOD_BOUNDS.y.max, w: 0.6, h: 3 });
    expect(captionOf(s, op)).toBe("8 notes added to the moodboard");
  });

  it("speaks v0's words for notes, colours and images", () => {
    const s = mood3();
    expect(captionOf(s, add([note("Warm, tactile, editorial")]))).toBe("Note pinned to the moodboard");
    expect(captionOf(s, add([note("")]))).toBe("Empty note added · double-click it to write");
    expect(captionOf(s, add([note("A"), note("B")]))).toBe("2 notes added to the moodboard");
    expect(captionOf(s, add([colour("#2a8c86", "Teal")]))).toBe("1 colour added to the moodboard");
    expect(captionOf(s, add([image(), image(), image()]))).toBe("3 images added to the moodboard");
  });

  it("fills the board only up to 200 references, and says so", () => {
    const s = withBoard(itemsOf(times(MOOD_MAX - 8, "color")));
    const op = add(Array.from({ length: MOOD_ADD_MAX }, () => colour("#d4a017")));
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(Object.keys(after(r).moodboard.items)).toHaveLength(MOOD_MAX);
    expect(op.items.slice(0, 8).every((it) => Object.hasOwn(after(r).moodboard.items, it.itemId))).toBe(true);
    expect(captionOf(s, op)).toBe("8 of 24 added · the moodboard holds 200 references");
  });

  it("refuses a full board", () => {
    const s = withBoard(itemsOf(times(MOOD_MAX, "color")));
    const rejection = expectRejection(apply(s, add([note("One more")])).result, "limit");
    expect(rejection.message).toBe("The moodboard holds at most 200 references.");
    expect(captionOf(s, add([note("One more")]))).toBe("Couldn't apply that: The moodboard holds at most 200 references.");
  });

  it("refuses a taken id, never re-minting it, so it can't be a no-op", () => {
    const s = mood3();
    const taken = boardOf(s)[0].id;
    expectRejection(apply(s, { op: "addMoodItems", items: [{ itemId: taken, ...note("Again") }] }).result, "duplicate_id");
    const op = add([note("Once")]);
    const once = withDoc(s, after(apply(s, op)));
    expect(REGISTRY.get("addMoodItems")!.idempotent).toBe(false);
    expectRejection(apply(once, op).result, "duplicate_id");
    expect(noopText(s, op)).toBeNull();
  });

  it("refuses invalid items: no asset, a bad hex, no note text, repeated ids, too many", () => {
    const s = mood3();
    const id = mint("moodItem");
    expectRejection(apply(s, add([{ kind: "image" }])).result, "invalid_payload");
    expectRejection(apply(s, add([colour("terracotta")])).result, "invalid_payload");
    expectRejection(apply(s, add([{ kind: "note" }])).result, "invalid_payload");
    expectRejection(apply(s, add([note("x".repeat(401))])).result, "invalid_payload");
    expectRejection(apply(s, add([{ ...note("Spare"), hex: "#ffffff" }])).result, "invalid_payload");
    expectRejection(apply(s, { op: "addMoodItems", items: [{ itemId: id, ...note("A") }, { itemId: id, ...note("B") }] }).result, "invalid_payload");
    expectRejection(apply(s, add(Array.from({ length: MOOD_ADD_MAX + 1 }, () => note("Many")))).result, "invalid_payload");
    expectRejection(apply(s, { op: "addMoodItems", items: [] }).result, "invalid_payload");
  });

  it("needs a project", () => {
    const r = run(deepFreeze(emptyState()), [add([note("Warm")])]);
    expectRejection(r.outcomes[0].result, "no_project");
    expect(r.caption?.text).toBe("Couldn't apply that: Create a project first.");
  });
});

/* ------------------------------------------------------------------
   updateMoodItem
   ------------------------------------------------------------------ */

const update = (itemId: string, patch: Record<string, unknown>, toFront = false) => ({ op: "updateMoodItem", itemId, patch, toFront });

describe("updateMoodItem", () => {
  it("moves a reference and brings it to the front, clamped like v0", () => {
    const s = mood3();
    const [bottom, middle, top] = boardOf(s);
    const op = update(bottom.id, { x: 0.95, y: -2 }, true);
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    const moved = after(r).moodboard.items[bottom.id];
    expectSameBox(moved, patchBox(bottom, { x: 0.95, y: -2 }));
    expectSameBox(moved, v0PatchMoodItem(toV0(bottom), { x: 0.95, y: -2 }));
    expect(moved).toMatchObject({ x: 1 - bottom.w, y: 0 });
    expect(board(after(r)).map((it) => it.id)).toEqual([middle.id, top.id, bottom.id]);
    // Direct edits are quiet (v0 parity); from another source the edit speaks
    expect(run(s, [op], { caption: false }).caption).toBeNull();
    expect(captionOf(s, op)).toBe("Reference moved");
  });

  it("resizes and rotates within the stored bounds", () => {
    const s = mood3();
    const [item] = boardOf(s);
    const resized = after(apply(s, update(item.id, { w: 2, h: 0, r: 40 })));
    expect(resized.moodboard.items[item.id]).toMatchObject({ x: 0, w: MOOD_BOUNDS.w.max, h: MOOD_BOUNDS.h.min, r: MOOD_BOUNDS.r.max });
    expect(captionOf(s, update(item.id, { w: 0.3 }))).toBe("Reference resized");
    expect(captionOf(s, update(item.id, { r: -4 }))).toBe("Reference rotated");
    expect(captionOf(s, update(item.id, {}, true))).toBe("Reference brought to front");
  });

  it("edits a note's text and a colour's hex and name", () => {
    const s = mood3();
    const [first, second] = boardOf(s);
    expect(first.kind).toBe("color");
    expect(second.kind).toBe("note");
    const r = apply(s, update(second.id, { text: "Quiet, bold" }));
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).moodboard.items[second.id].text).toBe("Quiet, bold");
    expect(captionOf(s, update(second.id, { text: "Quiet, bold" }))).toBe("Note edited");
    const p = after(apply(s, update(first.id, { hex: "#ABC", text: "Pale blue" })));
    expect(p.moodboard.items[first.id]).toMatchObject({ hex: "#aabbcc", text: "Pale blue" });
    expect(captionOf(s, update(first.id, { hex: "#ABC" }))).toBe("Colour updated");
    expect(after(apply(withDoc(s, p), update(first.id, { text: null }))).moodboard.items[first.id].text).toBeNull();
  });

  it("is a no-op, by reference, when nothing changes", () => {
    const s = mood3();
    const [bottom, , top] = boardOf(s);
    // Already on top, and the same place again
    const front = apply(s, update(top.id, {}, true));
    expectNoop(front.result, front.before);
    const same = apply(s, update(bottom.id, { x: bottom.x, y: bottom.y, hex: bottom.hex! }));
    expectNoop(same.result, same.before);
    expect(run(s, [update(top.id, {}, true)]).caption).toEqual({ text: "That reference already looks like that", tone: "info", undoable: false });
    // Idempotent: the same edit twice is one change
    expect(REGISTRY.get("updateMoodItem")!.idempotent).toBe(true);
    const op = update(bottom.id, { x: 0.5, w: 0.7 }, true);
    const once = withDoc(s, after(apply(s, op)));
    const twice = apply(once, op);
    expectNoop(twice.result, twice.before);
  });

  it("refuses a missing reference, a hex on anything but a colour, and a note without text", () => {
    const s = mood3();
    const [colourItem, noteItem] = boardOf(s);
    expectRejection(apply(s, update(mint("moodItem"), { x: 0.2 })).result, "not_found");
    const hex = expectRejection(apply(s, update(noteItem.id, { hex: "#ffffff" })).result, "invalid_state");
    expect(hex.message).toBe("Only a colour has a hex code.");
    expectRejection(apply(s, update(noteItem.id, { text: null })).result, "invalid_state");
    expectRejection(apply(s, update(colourItem.id, { hex: "red" })).result, "invalid_payload");
    expectRejection(apply(s, update(colourItem.id, { z: "a5" })).result, "invalid_payload");
    expectRejection(apply(s, update(noteItem.id, { text: "x".repeat(401) })).result, "invalid_payload");
    expectRejection(apply(s, { op: "updateMoodItem", itemId: colourItem.id, patch: { x: 0.1 } }).result, "invalid_payload");
  });
});

/* ------------------------------------------------------------------
   removeMoodItem
   ------------------------------------------------------------------ */

const remove = (itemId: string) => ({ op: "removeMoodItem", itemId });

describe("removeMoodItem", () => {
  it("removes one reference, and undo puts it back at the same height", () => {
    const s = mood3();
    const [bottom, middle, top] = boardOf(s);
    const r = apply(s, remove(middle.id));
    const applied = expectApplied(r.result);
    expectInverse(r.before, applied);
    expect(board(after(r)).map((it) => it.id)).toEqual([bottom.id, top.id]);
    expect(after(r).blocks).toContain("moodboard");
    expect(captionOf(s, remove(middle.id))).toBe("Reference removed");
  });

  it("refuses a reference that is gone, so it can't be a no-op", () => {
    const s = mood3();
    const [item] = boardOf(s);
    const once = withDoc(s, after(apply(s, remove(item.id))));
    expect(REGISTRY.get("removeMoodItem")!.idempotent).toBe(false);
    const gone = expectRejection(apply(once, remove(item.id)).result, "not_found");
    expect(gone.message).toBe("That reference isn't on the moodboard anymore.");
    expect(noopText(s, remove(item.id))).toBeNull();
    expectRejection(apply(s, remove("mdi_X")).result, "invalid_payload");
  });
});

/* ------------------------------------------------------------------
   arrangeMood
   ------------------------------------------------------------------ */

const arrangeOp = (layout: string, itemIds: readonly string[]) => ({ op: "arrangeMood", layout, itemIds });
const idsOf = (items: readonly MoodItem[]) => items.map((it) => it.id);

describe("arrangeMood", () => {
  it.each(LAYOUTS)("arranges as a %s with v0's arithmetic, bottom first, whatever the payload order", (layout) => {
    const s = mixedBoard();
    const inZ = boardOf(s);
    const op = arrangeOp(layout, idsOf(inZ).reverse());
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    const v0 = v0ArrangeMood(inZ.map(toV0), layout);
    const expected = arrange(inZ, layout);
    for (const [i, it] of inZ.entries()) {
      const box = after(r).moodboard.items[it.id];
      expectSameBox(box, v0[i]);
      expectSameBox(box, expected.get(it.id)!);
      expect(box.z).toBe(it.z);
    }
    expect(captionOf(s, op)).toBe(`Moodboard arranged as a ${layout}`);
  });

  it("arranges only the named references, skipping the ones that are gone", () => {
    const s = mood3();
    const [bottom, middle, top] = boardOf(s);
    const op = arrangeOp("grid", [top.id, mint("moodItem"), bottom.id]);
    const p = after(apply(s, op));
    const boxes = arrange([bottom, top], "grid");
    expectSameBox(p.moodboard.items[bottom.id], boxes.get(bottom.id)!);
    expectSameBox(p.moodboard.items[top.id], boxes.get(top.id)!);
    expect(p.moodboard.items[middle.id]).toBe(projectOf(s).moodboard.items[middle.id]);
    expect(captionOf(s, op)).toBe("2 references arranged as a grid");
  });

  it("clamps every box to the stored bounds, however tall the references are (the v0 safety patch)", () => {
    const s = withBoard(itemsOf(times(40, "note"), () => ({ w: 0.04, h: 3 })));
    const r = apply(s, arrangeOp("masonry", idsOf(boardOf(s))));
    expectApplied(r.result);
    for (const it of board(after(r))) {
      expect(it.y).toBeLessThanOrEqual(MOOD_BOUNDS.y.max);
      expect(it.h).toBeLessThanOrEqual(MOOD_BOUNDS.h.max);
      expect(it.x + it.w).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it("is a no-op when nothing moves, but isn't idempotent: sizes are recomputed from proportions", () => {
    // A palette strip has fixed sizes, so arranging it again moves nothing
    const s = withBoard(itemsOf(times(4, "color")));
    const op = arrangeOp("masonry", idsOf(boardOf(s)));
    const once = withDoc(s, after(apply(s, op)));
    const twice = apply(once, op);
    expectNoop(twice.result, twice.before);
    expect(run(once, [op]).caption).toEqual({ text: "The moodboard is already arranged as a masonry", tone: "info", undoable: false });
    expect(REGISTRY.get("arrangeMood")!.idempotent).toBe(false);
  });

  it("is a no-op on an empty board, or when every named reference is gone", () => {
    const empty = moodShown();
    const r = apply(empty, arrangeOp("grid", []));
    expectNoop(r.result, r.before);
    expect(captionOf(empty, arrangeOp("grid", []))).toBe("Add a few references first — drop images onto the moodboard, or add notes and colours.");
    const s = mood3();
    const gone = apply(s, arrangeOp("collage", [mint("moodItem")]));
    expectNoop(gone.result, gone.before);
    expect(captionOf(s, arrangeOp("collage", [mint("moodItem")]))).toBe("Those references aren't on the moodboard anymore");
  });

  it("refuses an unknown layout and a reference named twice", () => {
    const s = mood3();
    const [item] = boardOf(s);
    expectRejection(apply(s, arrangeOp("scatter", [item.id])).result, "invalid_payload");
    expectRejection(apply(s, arrangeOp("grid", [item.id, item.id])).result, "invalid_payload");
    expectRejection(apply(s, { op: "arrangeMood", layout: "grid" }).result, "invalid_payload");
    expectRejection(apply(s, arrangeOp("grid", Array.from({ length: MOOD_MAX + 1 }, () => mint("moodItem")))).result, "invalid_payload");
  });
});

/* ------------------------------------------------------------------
   clearMood
   ------------------------------------------------------------------ */

const clear = (itemIds: readonly string[]) => ({ op: "clearMood", itemIds });

describe("clearMood", () => {
  it("removes every named reference and keeps the board", () => {
    const s = mood3();
    const op = clear(idsOf(boardOf(s)));
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).moodboard.items).toEqual({});
    expect(after(r).blocks).toContain("moodboard");
    expect(captionOf(s, op)).toBe("Moodboard cleared · 3 references removed");
  });

  it("removes only what it names, never a reference added since", () => {
    const s = mood3();
    const [bottom, middle, top] = boardOf(s);
    const op = clear([middle.id, mint("moodItem")]);
    expect(board(after(apply(s, op))).map((it) => it.id)).toEqual([bottom.id, top.id]);
    expect(captionOf(s, op)).toBe("1 reference removed from the moodboard");
  });

  it("is a no-op when the named references are gone, so clearing twice is one change", () => {
    const s = mood3();
    const op = clear(idsOf(boardOf(s)));
    const once = withDoc(s, after(apply(s, op)));
    expect(REGISTRY.get("clearMood")!.idempotent).toBe(true);
    const twice = apply(once, op);
    expectNoop(twice.result, twice.before);
    expect(run(once, [op]).caption).toEqual({ text: "The moodboard is already empty", tone: "info", undoable: false });
    const some = apply(s, clear([mint("moodItem")]));
    expectNoop(some.result, some.before);
    expect(captionOf(s, clear([mint("moodItem")]))).toBe("Those references are already gone");
    const empty = moodShown();
    expect(captionOf(empty, clear([]))).toBe("The moodboard is already empty");
  });

  it("refuses a reference named twice and ids that aren't references", () => {
    const s = mood3();
    const [item] = boardOf(s);
    expectRejection(apply(s, clear([item.id, item.id])).result, "invalid_payload");
    expectRejection(apply(s, clear([mint("task")])).result, "invalid_payload");
    expectRejection(apply(s, { op: "clearMood" }).result, "invalid_payload");
  });
});

/* ------------------------------------------------------------------
   The v0 moodboard story, end to end
   ------------------------------------------------------------------ */

describe("the moodboard, as v0 did it", () => {
  it("adds, drags to the front, arranges and clears with v0's geometry, and undoes it all", () => {
    let s = moodShown();
    const start = projectOf(s);
    const inputs: V0MoodInput[] = [
      { kind: "color", hex: "#0c0c0c" },
      { kind: "color", hex: "#f2efe8", text: "Off white" },
      { kind: "note", text: "Warm, tactile, editorial" },
      { kind: "image", asset: "img-1" },
    ];
    const op = add([colour("#0c0c0c"), colour("#f2efe8", "Off white"), note("Warm, tactile, editorial"), image()]);
    const ids = op.items.map((it) => it.itemId);
    const result = run(s, [op, update(ids[0], { x: 0.5, y: 0.6 }, true), arrangeOp("collage", ids)]);
    expect(result.changed).toBe(true);
    expect(result.caption?.text).toBe("4 references added to the moodboard · Reference moved · Moodboard arranged as a collage");
    s = { ...s, projects: result.state.projects as TestState["projects"] };

    // v0: add, then the moved item goes to the top of the stack, then the whole board is arranged
    let v0: V0MoodItem[] = v0AddMoodItems([], inputs).map((it, i) => ({ ...it, id: ids[i] }));
    const moved = v0PatchMoodItem(v0[0], { x: 0.5, y: 0.6 });
    v0 = [...v0.slice(1), moved];
    v0 = v0ArrangeMood(v0, "collage");
    const v2 = boardOf(s);
    expect(v2.map((it) => it.id)).toEqual(v0.map((it) => it.id));
    v2.forEach((it, i) => expectSameBox(it, v0[i]));

    const cleared = run(s, [clear(idsOf(v2))]);
    expect(cleared.caption?.text).toBe("Moodboard cleared · 4 references removed");
    // Undo by patches, newest first, restores the empty board exactly
    const commits = [...result.commits, ...cleared.commits];
    let doc = projectOf({ ...s, projects: cleared.state.projects as TestState["projects"] });
    for (const c of [...commits].reverse()) doc = applyPatches(doc, c.result.inverse);
    expect(doc).toEqual(start);
  });
});

/* ------------------------------------------------------------------
   Record key order (the jsonb guard, plan §5.4)
   ------------------------------------------------------------------ */

describe("record key order", () => {
  /** The same board with its record keys in reverse order, as Postgres jsonb may hand it back */
  const reversedKeys = (s: TestState): TestState =>
    edited(s, (p) => ({ ...p, moodboard: { items: Object.fromEntries(Object.entries(p.moodboard.items).reverse()) } }));

  it("never changes what an op does or the patches it writes", () => {
    const s = mixedBoard();
    const shuffled = reversedKeys(s);
    const [bottom, , third, , , , top] = boardOf(s);
    const ops = [
      add([note("Late"), image(), colour("#2a8c86")]),
      update(bottom.id, { x: 0.4, w: 0.3 }, true),
      update(top.id, {}, true),
      remove(third.id),
      ...LAYOUTS.map((layout) => arrangeOp(layout, idsOf([top, bottom, third]))),
      clear(idsOf([top, third, bottom])),
    ];
    for (const op of ops) {
      const a = apply(s, op).result;
      const b = apply(shuffled, op).result;
      expect(b.kind, op.op).toBe(a.kind);
      expect(b.doc, op.op).toEqual(a.doc);
      if (a.kind === "applied" && b.kind === "applied") expect(b.patches, op.op).toEqual(a.patches);
    }
  });
});
