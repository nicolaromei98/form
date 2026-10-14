// Moodboard geometry moved out of v0 (plan §2, step 7): placement, direct edits and the three
// arrangements compute exactly what v0 computed, bit for bit, for the same items and ids.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MOOD_BOUNDS } from "@/lib/domain/limits";
import { arrange, type ArrangeItem, patchBox, placeNew, placeNext } from "@/lib/domain/mood-geometry";
import { MoodLayout } from "@/lib/domain/schema";
import { addMoodItems as v0AddMoodItems, arrangeMood as v0ArrangeMood, patchMoodItem as v0PatchMoodItem, placeNext as v0PlaceNext } from "../legacy/v0/lib/mood";
import type { MoodInput as V0MoodInput, MoodItem as V0MoodItem } from "../legacy/v0/lib/schema";

const num = (min: number, max: number) => fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
const { x, y, w, h, r } = MOOD_BOUNDS;

const v0ItemArb: fc.Arbitrary<V0MoodItem> = fc.record({
  id: fc.stringMatching(/^mdi_[0-9a-z]{16}$/),
  kind: fc.constantFrom("image", "color", "note"),
  x: num(x.min, x.max),
  y: num(y.min, y.max),
  w: num(w.min, w.max),
  h: num(h.min, h.max),
  r: num(r.min, r.max),
  asset: fc.constant(null),
  hex: fc.constant(null),
  text: fc.constant(null),
});
const v0ItemsArb = fc.uniqueArray(v0ItemArb, { maxLength: 40, selector: (it) => it.id });

/** The same boxes, bit for bit (Object.is tells 0 from -0) */
function expectSameBox(actual: { x: number; y: number; w: number; h: number; r: number }, expected: typeof actual) {
  for (const key of ["x", "y", "w", "h", "r"] as const) expect(Object.is(actual[key], expected[key]), `${key}: ${actual[key]} vs ${expected[key]}`).toBe(true);
}

describe("mood geometry parity with v0", () => {
  it("placeNext", () => {
    fc.assert(
      fc.property(v0ItemsArb, num(w.min, 0.6), (items, width) => {
        expect(placeNext(items, width)).toEqual(v0PlaceNext(items, width));
      }),
    );
  });

  it("arrange, in every layout", () => {
    fc.assert(
      fc.property(v0ItemsArb, fc.constantFrom(...MoodLayout.options), (items, layout) => {
        const v0 = v0ArrangeMood(items, layout);
        const v2 = arrange(items as ArrangeItem[], layout);
        expect(v0).toHaveLength(items.length);
        for (const item of v0) expectSameBox(v2.get(item.id)!, item);
      }),
    );
  });

  it("new items land where v0 put them", () => {
    const inputArb: fc.Arbitrary<V0MoodInput> = fc.oneof(
      fc.record({ kind: fc.constant("image" as const), asset: fc.constant("img-1") }),
      fc.record({ kind: fc.constant("color" as const), hex: fc.constant("#c65d3b") }),
      fc.record({ kind: fc.constant("note" as const), text: fc.constant("warm") }),
      fc.record({ kind: fc.constant("note" as const), text: fc.constant("dropped"), x: num(-0.5, 1.5), y: num(-1, 25), w: num(0, 1), h: num(0, 4) }),
    );
    fc.assert(
      fc.property(v0ItemsArb, fc.array(inputArb, { minLength: 1, maxLength: 24 }), (existing, inputs) => {
        const v0 = v0AddMoodItems(existing, inputs).slice(existing.length);
        const placed: { x: number; y: number; w: number; h: number }[] = [...existing];
        expect(v0).toHaveLength(inputs.length);
        inputs.forEach((input, i) => {
          const box = placeNew(input.kind, input, placed);
          placed.push(box);
          expectSameBox(box, v0[i]);
        });
      }),
    );
  });

  it("direct edits clamp like v0", () => {
    const patchArb = fc.record({ x: num(-1, 2), y: num(-5, 25), w: num(0, 2), h: num(0, 5), r: num(-30, 30) }, { requiredKeys: [] });
    fc.assert(
      fc.property(v0ItemArb, patchArb, (item, patch) => {
        expectSameBox(patchBox(item, patch), v0PatchMoodItem(item, patch));
      }),
    );
  });
});
