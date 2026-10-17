import fc from "fast-check";
import { generateKeyBetween } from "fractional-indexing";
import { describe, expect, it } from "vitest";
import { ORDER_KEY_MAX, ORDER_KEY_REBALANCE, OPS_PER_COMMAND } from "@/lib/domain/limits";
import {
  compareKeys,
  isOrderKey,
  keyAfter,
  keyBefore,
  keyBetween,
  nKeys,
  nKeysBetween,
  sortedByOrder,
  sortedByZ,
} from "@/lib/domain/order";
import { OrderKey } from "@/lib/domain/schema/primitives";

/** Whether fractional-indexing itself accepts a key as a bound */
function libraryAccepts(key: string): boolean {
  try {
    generateKeyBetween(key, null);
    return true;
  } catch {
    return false;
  }
}

const isSortedStrictly = (keys: readonly string[]) => keys.every((k, i) => i === 0 || compareKeys(keys[i - 1], k) < 0);

describe("keys", () => {
  it("start at a0 and grow in code-unit order", () => {
    expect(keyAfter(null)).toBe("a0");
    expect(keyBefore(null)).toBe("a0");
    expect(keyAfter("a0")).toBe("a1");
    expect(keyBefore("a0")).toBe("Zz");
    expect(keyBetween("a0", "a1")).toBe("a0V");
    expect(nKeys(0)).toEqual([]);
    expect(nKeys(3)).toEqual(["a0", "a1", "a2"]);
  });

  it("make n short keys between two keys", () => {
    const keys = nKeysBetween("a0", "a1", 5);
    expect(keys).toHaveLength(5);
    expect(isSortedStrictly(["a0", ...keys, "a1"])).toBe(true);
    for (const k of keys) expect(k.length).toBeLessThanOrEqual(4);
  });

  it("make 500 rebalanced keys that stay short", () => {
    const keys = nKeys(500);
    expect(isSortedStrictly(keys)).toBe(true);
    expect(Math.max(...keys.map((k) => k.length))).toBeLessThanOrEqual(3);
    for (const k of keys) expect(OrderKey.safeParse(k).success).toBe(true);
  });

  it("throw on bounds out of order, equal or invalid: a bug, never a user error", () => {
    expect(() => keyBetween("a1", "a0")).toThrow(RangeError);
    expect(() => keyBetween("a1", "a1")).toThrow(RangeError);
    expect(() => keyBetween("0", null)).toThrow(RangeError);
    expect(() => keyBetween(null, "a00")).toThrow(RangeError);
    expect(() => nKeysBetween("a1", "a0", 2)).toThrow(RangeError);
    expect(() => nKeys(-1)).toThrow(RangeError);
    expect(() => nKeys(1.5)).toThrow(RangeError);
  });

  it("stay sorted, valid and distinct under any sequence of inserts", () => {
    const insert = fc.record({ at: fc.nat(), place: fc.constantFrom("start", "end", "after") });
    fc.assert(
      fc.property(fc.array(insert, { maxLength: 120 }), (inserts) => {
        const list: string[] = [];
        for (const { at, place } of inserts) {
          if (place === "start" || list.length === 0) list.unshift(keyBefore(list[0] ?? null));
          else if (place === "end") list.push(keyAfter(list[list.length - 1]));
          else {
            const i = at % list.length;
            list.splice(i + 1, 0, keyBetween(list[i], list[i + 1] ?? null));
          }
        }
        expect(isSortedStrictly(list)).toBe(true);
        for (const k of list) expect(isOrderKey(k)).toBe(true);
      }),
    );
  });

  it("leave headroom: a command's worth of inserts at one spot after a rebalance-length key fits", () => {
    // Two adjacent keys at the rebalance length; the worst case keeps inserting into the same gap
    const low = `a0${"1".repeat(ORDER_KEY_REBALANCE - 2)}`;
    const high = `a0${"1".repeat(ORDER_KEY_REBALANCE - 3)}2`;
    expect(low.length).toBe(ORDER_KEY_REBALANCE);
    expect(high.length).toBe(ORDER_KEY_REBALANCE);
    // Always right after `low`, before the key inserted last
    let next = high;
    for (let i = 0; i < OPS_PER_COMMAND; i++) next = keyBetween(low, next);
    // Always right before `high`, after the key inserted last
    let previous = low;
    for (let i = 0; i < OPS_PER_COMMAND; i++) previous = keyBetween(previous, high);
    for (const key of [next, previous]) {
      expect(key.length).toBeGreaterThan(ORDER_KEY_REBALANCE);
      expect(key.length).toBeLessThanOrEqual(ORDER_KEY_MAX);
      expect(OrderKey.safeParse(key).success).toBe(true);
    }
  });
});

describe("isOrderKey", () => {
  it.each(["a0", "a1", "Zz", "a0V", "b00", "zzzzzzzzzzzzzzzzzzzzzzzzzzz", "A00000000000000000000000001"])("accepts %s", (k) => {
    expect(isOrderKey(k)).toBe(true);
    expect(OrderKey.safeParse(k).success).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["a digit head", "0"],
    ["a short integer part", "b0"],
    ["a trailing zero", "a00"],
    ["a trailing zero after a fraction", "a0V0"],
    ["the smallest integer", `A${"0".repeat(26)}`],
    ["a non-base-62 character", "a-"],
    ["a space", "a0 "],
    ["65 characters", `a0${"V".repeat(63)}`],
  ])("rejects %s", (_, k) => {
    expect(isOrderKey(k)).toBe(false);
    expect(OrderKey.safeParse(k).success).toBe(false);
  });

  it("agrees with fractional-indexing on every base-62 string", () => {
    const base62 = fc.string({ unit: fc.constantFrom(..."0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"), minLength: 1, maxLength: 30 });
    const heads = fc.tuple(fc.constantFrom(..."aAbBzZyY"), fc.string({ unit: fc.constantFrom(..."0129aVz"), maxLength: 30 })).map(([h, t]) => h + t);
    fc.assert(
      fc.property(fc.oneof(base62, heads), (k) => {
        expect(isOrderKey(k)).toBe(libraryAccepts(k));
      }),
      { numRuns: 5_000 },
    );
  });
});

describe("sorting", () => {
  it("uses code-unit order, never the locale", () => {
    expect(compareKeys("Zz", "a0")).toBe(-1);
    expect(compareKeys("a0", "a0V")).toBe(-1);
    expect(compareKeys("a0V", "a1")).toBe(-1);
    expect(compareKeys("a1", "a1")).toBe(0);
    // localeCompare would put "a0" before "Zz"
    expect(["a0", "Zz"].sort(compareKeys)).toEqual(["Zz", "a0"]);
  });

  it("orders records by key, then id, whatever the record's key order", () => {
    const tasks = {
      tsk_c: { id: "tsk_c", order: "a1" },
      tsk_a: { id: "tsk_a", order: "a0V" },
      tsk_b: { id: "tsk_b", order: "Zz" },
      tsk_d: { id: "tsk_d", order: "a1" },
    };
    const expected = ["tsk_b", "tsk_a", "tsk_c", "tsk_d"];
    expect(sortedByOrder(tasks).map((t) => t.id)).toEqual(expected);
    const shuffled = Object.fromEntries(Object.entries(tasks).reverse());
    expect(sortedByOrder(shuffled).map((t) => t.id)).toEqual(expected);
    expect(sortedByOrder(Object.values(tasks)).map((t) => t.id)).toEqual(expected);
  });

  it("never mutates its input", () => {
    const items = Object.freeze([Object.freeze({ id: "b", order: "a1" }), Object.freeze({ id: "a", order: "a0" })]);
    expect(sortedByOrder(items).map((t) => t.id)).toEqual(["a", "b"]);
    expect(items.map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("stacks mood items by z, then id", () => {
    const items = { mdi_b: { id: "mdi_b", z: "a1" }, mdi_a: { id: "mdi_a", z: "a1" }, mdi_c: { id: "mdi_c", z: "a0" } };
    expect(sortedByZ(items).map((m) => m.id)).toEqual(["mdi_c", "mdi_a", "mdi_b"]);
  });
});
