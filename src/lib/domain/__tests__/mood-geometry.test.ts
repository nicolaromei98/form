// Moodboard geometry (moved from v0 lib/mood.ts): every box stays inside the stored bounds, the
// arrangements are deterministic and keyed by id, and z keys stack new items on top. Parity with
// v0 is in test/golden/mood-geometry.golden.test.ts.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MOOD_BOUNDS, MOOD_MAX } from "@/lib/domain/limits";
import {
  arrange,
  type ArrangeItem,
  clampBox,
  frontZ,
  frontZs,
  MOOD_DEFAULT_SIZE,
  MOOD_GAP,
  MOOD_NEW_MAX_W,
  MOOD_PAD,
  type MoodBox,
  type MoodRect,
  patchBox,
  placeNew,
  placeNext,
  topZ,
} from "@/lib/domain/mood-geometry";
import { compareKeys, nKeys } from "@/lib/domain/order";
import { MoodLayout } from "@/lib/domain/schema";

const num = (min: number, max: number) => fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
const boxArb: fc.Arbitrary<MoodBox> = fc.record({ x: num(-2, 3), y: num(-5, 30), w: num(0, 2), h: num(0, 5), r: num(-40, 40) });
const itemArb: fc.Arbitrary<ArrangeItem> = fc.record({
  id: fc.stringMatching(/^mdi_[0-9a-z]{16}$/),
  kind: fc.constantFrom("image", "color", "note"),
  x: num(0, 1),
  y: num(0, 20),
  w: num(MOOD_BOUNDS.w.min, MOOD_BOUNDS.w.max),
  h: num(MOOD_BOUNDS.h.min, MOOD_BOUNDS.h.max),
  r: num(MOOD_BOUNDS.r.min, MOOD_BOUNDS.r.max),
});
const itemsArb = fc.uniqueArray(itemArb, { maxLength: 60, selector: (it) => it.id });

function expectInBounds(box: MoodBox) {
  const { x, y, w, h, r } = MOOD_BOUNDS;
  expect(box.w).toBeGreaterThanOrEqual(w.min);
  expect(box.w).toBeLessThanOrEqual(w.max);
  expect(box.h).toBeGreaterThanOrEqual(h.min);
  expect(box.h).toBeLessThanOrEqual(h.max);
  expect(box.x).toBeGreaterThanOrEqual(x.min);
  expect(box.y).toBeGreaterThanOrEqual(y.min);
  expect(box.y).toBeLessThanOrEqual(y.max);
  expect(box.r).toBeGreaterThanOrEqual(r.min);
  expect(box.r).toBeLessThanOrEqual(r.max);
  // Invariant P10
  expect(box.x + box.w).toBeLessThanOrEqual(1 + 1e-9);
}

describe("clampBox and patchBox", () => {
  it("keep any box inside the stored bounds", () => {
    fc.assert(
      fc.property(boxArb, (box) => {
        expectInBounds(clampBox(box));
      }),
    );
  });

  it("leave a box that fits unchanged", () => {
    const box = { x: 0.1, y: 2, w: 0.3, h: 0.2, r: 4 };
    expect(clampBox(box)).toEqual(box);
  });

  it("apply a direct edit, then clamp", () => {
    const box = { x: 0.5, y: 1, w: 0.3, h: 0.2, r: 0 };
    expect(patchBox(box, { x: 0.9 })).toEqual({ ...box, x: 0.7 });
    expect(patchBox(box, { w: 2, r: 30 })).toEqual({ ...box, x: 0, w: 1, r: 15 });
    expect(patchBox(box, {})).toEqual(box);
  });
});

describe("placeNext and placeNew", () => {
  it("land the first item at the board's padding", () => {
    expect(placeNext([], 0.24)).toEqual({ x: MOOD_PAD, y: MOOD_PAD });
    expect(placeNew("image", {}, [])).toEqual({ x: MOOD_PAD, y: MOOD_PAD, ...MOOD_DEFAULT_SIZE.image, r: 0 });
  });

  it("land the next item beside the first, then below the row", () => {
    const first = placeNew("note", {}, []);
    const second = placeNew("note", {}, [first]);
    expect(second.y).toBe(MOOD_PAD);
    expect(second.x).toBeGreaterThanOrEqual(first.x + first.w + MOOD_GAP - 1e-9);
    const row: MoodRect[] = [{ x: 0, y: 0, w: 1, h: 0.2 }];
    expect(placeNew("color", {}, row).y).toBeCloseTo(0.2 + MOOD_GAP);
  });

  it("keep a dropped item where it was dropped, inside the board, at most 0.6 wide", () => {
    expect(placeNew("image", { x: 0.5, y: 3, w: 0.3, h: 0.2 }, [])).toEqual({ x: 0.5, y: 3, w: 0.3, h: 0.2, r: 0 });
    expect(placeNew("image", { x: 0.9, y: 25, w: 0.9 }, [])).toEqual({ x: 1 - MOOD_NEW_MAX_W, y: 20, w: MOOD_NEW_MAX_W, h: 0.18, r: 0 });
    // A place needs both coordinates
    expect(placeNew("note", { x: 0.5 }, [])).toMatchObject({ x: MOOD_PAD, y: MOOD_PAD });
  });

  it("place a full board inside the bounds", () => {
    const placed: MoodBox[] = [];
    for (let i = 0; i < MOOD_MAX; i++) placed.push(placeNew((["image", "color", "note"] as const)[i % 3], {}, placed));
    placed.forEach(expectInBounds);
  });
});

describe("arrange", () => {
  it("keeps every item inside the bounds, in every layout", () => {
    fc.assert(
      fc.property(itemsArb, fc.constantFrom(...MoodLayout.options), (items, layout) => {
        const boxes = arrange(items, layout);
        expect([...boxes.keys()]).toEqual(items.map((it) => it.id));
        boxes.forEach(expectInBounds);
      }),
    );
  });

  it("is deterministic: the collage's jitter comes from the ids", () => {
    fc.assert(
      fc.property(itemsArb, fc.constantFrom(...MoodLayout.options), (items, layout) => {
        expect(arrange(items, layout)).toEqual(arrange(structuredClone(items), layout));
      }),
    );
  });

  it("gathers colours into a strip on top and keeps every proportion in the grid", () => {
    const items: ArrangeItem[] = [
      { id: "mdi_colour00000001", kind: "color", x: 0.5, y: 4, w: 0.13, h: 0.16, r: 0 },
      { id: "mdi_image000000001", kind: "image", x: 0.1, y: 1, w: 0.24, h: 0.18, r: 3 },
      { id: "mdi_note0000000001", kind: "note", x: 0.3, y: 2, w: 0.22, h: 0.12, r: -2 },
      { id: "mdi_colour00000002", kind: "color", x: 0.7, y: 0, w: 0.13, h: 0.16, r: 0 },
    ];
    const boxes = arrange(items, "grid");
    const c1 = boxes.get("mdi_colour00000001")!;
    const c2 = boxes.get("mdi_colour00000002")!;
    expect([c1.y, c2.y]).toEqual([MOOD_PAD, MOOD_PAD]);
    expect(c2.x).toBeGreaterThan(c1.x);
    for (const id of ["mdi_image000000001", "mdi_note0000000001"]) {
      const before = items.find((it) => it.id === id)!;
      const after = boxes.get(id)!;
      expect(after.y).toBeGreaterThan(c1.y + c1.h);
      expect(after.h / after.w).toBeCloseTo(before.h / before.w, 9);
      expect(after.r).toBe(0);
    }
  });

  it("arranges nothing on an empty board", () => {
    for (const layout of MoodLayout.options) expect(arrange([], layout).size).toBe(0);
  });

  it("clamps a masonry of tall notes (the v0 safety patch)", () => {
    const tall = Array.from({ length: 40 }, (_, i): ArrangeItem => ({ id: `mdi_tall${String(i).padStart(12, "0")}`, kind: "note", x: 0, y: 0, w: 0.04, h: 3, r: 0 }));
    arrange(tall, "masonry").forEach(expectInBounds);
  });
});

describe("stacking", () => {
  const items = nKeys(3).map((z) => ({ z }));

  it("finds the top z key", () => {
    expect(topZ([])).toBeNull();
    expect(topZ([...items].reverse())).toBe(items[2].z);
  });

  it("puts new keys above every item", () => {
    expect(compareKeys(frontZ(items), items[2].z)).toBe(1);
    const keys = frontZs(items, 4);
    expect(keys).toHaveLength(4);
    expect(compareKeys(keys[0], items[2].z)).toBe(1);
    expect([...keys].sort(compareKeys)).toEqual(keys);
    expect(frontZ([])).toBe("a0");
  });
});
