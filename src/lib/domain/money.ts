/**
 * Money (plan §1.2): integer cents plus one ISO 4217 currency per project. "Cents" are always
 * hundredths of the major unit, for every currency, so a stored amount never depends on the
 * runtime's currency data. Formatting is fixed to en-US, so it never depends on the host locale.
 */

const CODE = /^[A-Z]{3}$/;

/** A well-formed ISO 4217 code ("EUR", "USD"); the same rule as the `Currency` schema */
export function isCurrencyCode(code: string): boolean {
  return CODE.test(code);
}

interface Formatters {
  readonly whole: Intl.NumberFormat;
  readonly exact: Intl.NumberFormat;
}
const formatters = new Map<string, Formatters>();

function formattersFor(currency: string): Formatters {
  let f = formatters.get(currency);
  if (!f) {
    if (!isCurrencyCode(currency)) throw new RangeError(`Not an ISO 4217 currency code: "${currency}"`);
    const base = { style: "currency", currency } as const;
    f = {
      whole: new Intl.NumberFormat("en-US", { ...base, minimumFractionDigits: 0, maximumFractionDigits: 0 }),
      exact: new Intl.NumberFormat("en-US", { ...base, minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    };
    formatters.set(currency, f);
  }
  return f;
}

/**
 * "€2,400" for 240000 EUR cents and "€2,400.50" for 240050: whole amounts drop the cents, as v0
 * showed costs. `null` (unknown) is "—". Fractional cents, such as an unrounded derived cost,
 * round to the nearest cent. Throws a RangeError for a malformed currency code.
 */
export function formatMoney(cents: number | null, currency: string): string {
  if (cents === null) return "—";
  const f = formattersFor(currency);
  return Number.isInteger(cents) && cents % 100 === 0 ? f.whole.format(cents / 100) : f.exact.format(cents / 100);
}

/**
 * Cents of an amount in the major unit, rounded half away from zero: 2.675 → 268, 0.1 + 0.2 → 30.
 * The product is first rounded to 15 significant digits, which removes binary noise such as
 * 2.675 × 100 = 267.49999999999997.
 */
export function toCents(amount: number): number {
  const cents = Math.sign(amount) * Math.round(Number((Math.abs(amount) * 100).toPrecision(15)));
  // No negative zero
  return cents === 0 ? 0 : cents;
}

/** The amount in the major unit: 240050 → 2400.5 */
export function fromCents(cents: number): number {
  return cents / 100;
}
