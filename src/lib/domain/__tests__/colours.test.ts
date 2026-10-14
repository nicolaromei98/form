import { describe, expect, it } from "vitest";
import { HEX_COLOUR, NAMED_COLOURS, normaliseHex } from "@/lib/domain/colours";

describe("NAMED_COLOURS", () => {
  it("holds 32 lowercase names with stored-form swatches", () => {
    expect(NAMED_COLOURS).toHaveLength(32);
    expect(new Set(NAMED_COLOURS.map(([name]) => name)).size).toBe(32);
    for (const [name, hex] of NAMED_COLOURS) {
      expect(name).toMatch(/^[a-z][a-z -]*[a-z]$/);
      expect(hex).toMatch(HEX_COLOUR);
    }
  });

  it("lists a name before any shorter name it contains", () => {
    const names = NAMED_COLOURS.map(([name]) => name);
    names.forEach((name, i) => {
      names.forEach((other, j) => {
        if (i !== j && new RegExp(`\\b${other}\\b`).test(name)) expect(i, `${name} before ${other}`).toBeLessThan(j);
      });
    });
  });

  it("keeps v0's swatches", () => {
    const map = new Map(NAMED_COLOURS);
    expect(map.get("off white")).toBe("#f2efe8");
    expect(map.get("off-white")).toBe("#f2efe8");
    expect(map.get("terracotta")).toBe("#c65d3b");
    expect(map.get("black")).toBe("#0c0c0c");
    expect(map.get("grey")).toBe(map.get("gray"));
  });
});

describe("normaliseHex", () => {
  it.each([
    ["#E4572E", "#e4572e"],
    ["e4572e", "#e4572e"],
    ["  #0C0C0C ", "#0c0c0c"],
    ["#e52", "#ee5522"],
    ["ABC", "#aabbcc"],
  ])("normalises %j to %s", (input, output) => {
    expect(normaliseHex(input)).toBe(output);
    expect(output).toMatch(HEX_COLOUR);
  });

  it.each(["", "#12345", "#1234567", "#ggg", "red", "# 123456", null, undefined])("rejects %j", (input) => {
    expect(normaliseHex(input)).toBeNull();
  });
});
