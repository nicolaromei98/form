import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CENTS_MAX } from "@/lib/domain/limits";
import { formatMoney, fromCents, isCurrencyCode, toCents } from "@/lib/domain/money";
import { Cents, Currency } from "@/lib/domain/schema/primitives";

const NBSP = " ";

describe("formatMoney", () => {
  it.each([
    [240000, "EUR", "€2,400"],
    [240050, "EUR", "€2,400.50"],
    [240001, "EUR", "€2,400.01"],
    [5, "EUR", "€0.05"],
    [0, "EUR", "€0"],
    [123456789, "USD", "$1,234,567.89"],
    [99900, "GBP", "£999"],
    [240000, "JPY", "¥2,400"],
    [240050, "JPY", "¥2,400.50"],
    [240000, "KWD", `KWD${NBSP}2,400`],
    [CENTS_MAX, "EUR", "€1,000,000,000"],
    [CENTS_MAX - 1, "EUR", "€999,999,999.99"],
    [-40000, "EUR", "-€400"],
  ])("formats %i cents of %s as %s", (cents, currency, text) => {
    expect(formatMoney(cents, currency)).toBe(text);
  });

  it("shows unknown as a dash", () => {
    expect(formatMoney(null, "EUR")).toBe("—");
  });

  it("rounds fractional cents (an unrounded derived cost) to the cent", () => {
    expect(formatMoney(240050.4, "EUR")).toBe("€2,400.50");
    expect(formatMoney(240000.6, "EUR")).toBe("€2,400.01");
  });

  it("matches v0's euro format for whole amounts", () => {
    // v0: `€${Math.round(n).toLocaleString("en-US")}`
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000_000 }), (euros) => {
        expect(formatMoney(euros * 100, "EUR")).toBe(`€${euros.toLocaleString("en-US")}`);
      }),
    );
  });

  it("throws for a malformed currency code", () => {
    expect(() => formatMoney(100, "eur")).toThrow(RangeError);
    expect(() => formatMoney(100, "EURO")).toThrow(RangeError);
  });
});

describe("toCents and fromCents", () => {
  it.each([
    [2400, 240000],
    [2.675, 268],
    [1.005, 101],
    [0.1 + 0.2, 30],
    [19.99, 1999],
    [0.004, 0],
    [0.005, 1],
    [-1.005, -101],
    [-0.004, 0],
  ])("%d → %i cents", (amount, cents) => {
    expect(toCents(amount)).toBe(cents);
  });

  it("never returns negative zero", () => {
    expect(Object.is(toCents(-0.001), 0)).toBe(true);
  });

  it("round-trips every cent amount", () => {
    fc.assert(
      fc.property(fc.integer({ min: -CENTS_MAX, max: CENTS_MAX }), (cents) => {
        expect(toCents(fromCents(cents))).toBe(cents);
      }),
    );
  });
});

describe("currency codes and the Cents schema", () => {
  it("accept three capital letters only", () => {
    for (const code of ["EUR", "USD", "JPY"]) {
      expect(isCurrencyCode(code)).toBe(true);
      expect(Currency.safeParse(code).success).toBe(true);
    }
    for (const code of ["eur", "EU", "EURO", "€", ""]) {
      expect(isCurrencyCode(code)).toBe(false);
      expect(Currency.safeParse(code).success).toBe(false);
    }
  });

  it("bound cents to whole numbers from 0 to one billion", () => {
    expect(Cents.safeParse(0).success).toBe(true);
    expect(Cents.safeParse(CENTS_MAX).success).toBe(true);
    expect(Cents.safeParse(CENTS_MAX + 1).success).toBe(false);
    expect(Cents.safeParse(-1).success).toBe(false);
    expect(Cents.safeParse(1.5).success).toBe(false);
  });
});
