import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import { ORDER_KEY_MAX } from "@/lib/domain/limits";
// The schema validates stored keys with `isOrderKey`
import type { OrderKey } from "@/lib/domain/schema/primitives";

/**
 * Fractional order keys (plan §1.2, §5.4). Tasks and people carry an `order` key and mood items a
 * `z` key, because records keyed by id have no order of their own (Postgres `jsonb` reorders
 * keys). Keys use fractional-indexing's default encoding: a head letter (A–Z, a–z) that sets the
 * integer part's length, then base-62 digits (0–9, A–Z, a–z). Keys compare by plain code-unit
 * order, never by locale.
 */

const BASE_62 = /^[0-9A-Za-z]+$/;
// The integer part's head: A–Z for negative integers (longest first), a–z for positive ones
const HEADS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const SMALLEST_INTEGER = `A${"0".repeat(26)}`;

/** The integer part's length for a head character, or 0 for a character that can't start a key */
function integerLength(head: string): number {
  const i = HEADS.indexOf(head);
  if (i < 0) return 0;
  return i < 26 ? 26 - i + 1 : i - 26 + 2;
}

/**
 * A key fractional-indexing accepts, at most `ORDER_KEY_MAX` long: base-62, a valid head, a
 * complete integer part, no trailing zero in the fraction, and not the smallest integer (which
 * has nothing below it). Every stored key passes, so `keyBetween` never throws on stored keys.
 */
export function isOrderKey(key: string): boolean {
  if (key.length === 0 || key.length > ORDER_KEY_MAX || !BASE_62.test(key)) return false;
  const length = integerLength(key[0]);
  if (length === 0 || key.length < length || key === SMALLEST_INTEGER) return false;
  return key.length === length || key[key.length - 1] !== "0";
}

/** Code-unit order: "Zz" < "a0" < "a0V" < "a1". Never localeCompare. */
export function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function assertKey(key: string | null, name: string): void {
  if (key !== null && !isOrderKey(key)) throw new RangeError(`${name} is not an order key: "${key}"`);
}

/**
 * A key strictly between `a` and `b`; `null` is the open start or end. Throws a RangeError when a
 * bound is not an order key or `a >= b`: stored keys are valid and unique (invariants), so either
 * is a bug in the caller, never a user error.
 */
export function keyBetween(a: OrderKey | null, b: OrderKey | null): OrderKey {
  assertKey(a, "The lower bound");
  assertKey(b, "The upper bound");
  if (a !== null && b !== null && a >= b) throw new RangeError(`Order keys out of order: "${a}" >= "${b}"`);
  return generateKeyBetween(a, b);
}

/** A key after `last` ("end"); the first key ever is "a0" */
export function keyAfter(last: OrderKey | null): OrderKey {
  return keyBetween(last, null);
}

/** A key before `first` ("start") */
export function keyBefore(first: OrderKey | null): OrderKey {
  return keyBetween(null, first);
}

/** `n` ascending keys strictly between `a` and `b`, kept short by bisection */
export function nKeysBetween(a: OrderKey | null, b: OrderKey | null, n: number): OrderKey[] {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`Can't make ${n} keys`);
  assertKey(a, "The lower bound");
  assertKey(b, "The upper bound");
  if (a !== null && b !== null && a >= b) throw new RangeError(`Order keys out of order: "${a}" >= "${b}"`);
  return generateNKeysBetween(a, b, n);
}

/** `n` fresh ascending keys ("a0", "a1", …): the migration's and rebalanceOrder's keys */
export function nKeys(n: number): OrderKey[] {
  return nKeysBetween(null, null, n);
}

type Items<T> = Readonly<Record<string, T>> | readonly T[];
const valuesOf = <T>(items: Items<T>): T[] => (Array.isArray(items) ? [...items] : Object.values(items));

/**
 * Records in workflow order: order key, then id. Record iteration always goes through this (or
 * sorted ids), so a document whose keys `jsonb` reordered behaves exactly the same.
 */
export function sortedByOrder<T extends { readonly id: string; readonly order: string }>(items: Items<T>): T[] {
  return valuesOf(items).sort((a, b) => compareKeys(a.order, b.order) || compareKeys(a.id, b.id));
}

/** Mood items in stacking order, bottom first: z key, then id */
export function sortedByZ<T extends { readonly id: string; readonly z: string }>(items: Items<T>): T[] {
  return valuesOf(items).sort((a, b) => compareKeys(a.z, b.z) || compareKeys(a.id, b.id));
}
