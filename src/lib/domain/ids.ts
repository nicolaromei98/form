import { customAlphabet } from "nanoid";
import type { IdOf } from "@/lib/domain/schema/ids";

/**
 * Ids are a kind prefix plus a body of `[0-9a-z]` (plan §1.2, §3.1). Producers mint them (action
 * creators, the parser, the migration) and carry them in op payloads; the reducer never mints one.
 * The branded zod schemas live in `domain/schema/ids.ts`.
 */
export const ID_PREFIX = {
  workspace: "wsp",
  project: "prj",
  task: "tsk",
  step: "stp",
  person: "per",
  asset: "ast",
  comment: "cmt",
  template: "tpl",
  proposal: "prp",
  moodItem: "mdi",
  briefLine: "brl",
  timeOff: "off",
  closure: "cls",
  link: "lnk",
  snapshot: "snp",
} as const;

export type IdKind = keyof typeof ID_PREFIX;
export const ID_KINDS = Object.keys(ID_PREFIX) as readonly IdKind[];

export const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
/** Minted bodies are 16 characters: about 82 random bits */
export const ID_LENGTH = 16;
/** Bodies the schemas accept: minted ids, plus readable fixed ids such as `per_demomarta` */
export const ID_BODY = "[0-9a-z]{8,32}";

const PATTERNS = Object.fromEntries(
  ID_KINDS.map((kind) => [kind, new RegExp(`^${ID_PREFIX[kind]}_${ID_BODY}$`)]),
) as Readonly<Record<IdKind, RegExp>>;
const KIND_BY_PREFIX = new Map<string, IdKind>(ID_KINDS.map((kind) => [ID_PREFIX[kind], kind]));

/** The anchored pattern of one kind's ids */
export function idPattern(kind: IdKind): RegExp {
  return PATTERNS[kind];
}

/** A cheap type guard with the same rule as the kind's schema */
export function isId<K extends IdKind>(kind: K, value: unknown): value is IdOf<K> {
  return typeof value === "string" && PATTERNS[kind].test(value);
}

/** The kind a well-formed id belongs to, or null */
export function idKindOf(value: string): IdKind | null {
  const kind = KIND_BY_PREFIX.get(value.slice(0, 3));
  return kind && PATTERNS[kind].test(value) ? kind : null;
}

/** Mints one id of the given kind */
export interface Minter {
  <K extends IdKind>(kind: K): IdOf<K>;
}

const withPrefix = <K extends IdKind>(kind: K, body: string) => `${ID_PREFIX[kind]}_${body}` as IdOf<K>;

const randomBody = customAlphabet(ID_ALPHABET, ID_LENGTH);

/** The production minter: 16 random characters from nanoid's secure generator. Never in reducers. */
export const nanoMinter: Minter = <K extends IdKind>(kind: K) => withPrefix(kind, randomBody());

/** mulberry32: a small, fast 32-bit generator. Deterministic, so only for tests and fixtures. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** A deterministic minter for tests and fixtures: the same seed mints the same sequence. */
export function seededMinter(seed: number): Minter {
  const next = mulberry32(seed);
  return <K extends IdKind>(kind: K) => {
    let body = "";
    for (let i = 0; i < ID_LENGTH; i++) body += ID_ALPHABET[Math.floor((next() / 0x1_0000_0000) * ID_ALPHABET.length)];
    return withPrefix(kind, body);
  };
}

/* ------------------------------------------------------------------
   Derived ids (duplicateProject)
   ------------------------------------------------------------------ */

const UTF8 = new TextEncoder();
// FNV-1a 64-bit offset basis 0xcbf29ce484222325, as two 32-bit halves
const FNV_OFFSET_HI = 0xcbf29ce4;
const FNV_OFFSET_LO = 0x84222325;
// The 64-bit prime is 2^40 + 0x1b3
const FNV_PRIME_LOW = 0x1b3;
const TWO_32 = 0x1_0000_0000;

/**
 * FNV-1a 64-bit over the UTF-8 bytes of `text`, as [high 32 bits, low 32 bits]. The halves keep
 * the multiply in exact double arithmetic, with no BigInt in the loop.
 */
function fnv1a64Parts(text: string): [number, number] {
  let hi = FNV_OFFSET_HI;
  let lo = FNV_OFFSET_LO;
  for (const byte of UTF8.encode(text)) {
    lo = (lo ^ byte) >>> 0;
    // (hi·2^32 + lo) · (2^40 + 0x1b3) mod 2^64: every product stays below 2^53
    const loProduct = lo * FNV_PRIME_LOW;
    const carry = Math.floor(loProduct / TWO_32);
    hi = (hi * FNV_PRIME_LOW + carry + ((lo * 256) >>> 0)) >>> 0;
    lo = loProduct >>> 0;
  }
  return [hi, lo];
}

/** FNV-1a 64-bit of the UTF-8 bytes of `text`, as 16 lowercase hex digits */
export function fnv1a64Hex(text: string): string {
  const [hi, lo] = fnv1a64Parts(text);
  return hi.toString(16).padStart(8, "0") + lo.toString(16).padStart(8, "0");
}

/**
 * A stable id derived from a salt and a key: FNV-1a 64-bit of `${salt}|${key}` in base 36, left
 * padded to 16 characters. `duplicateProject` uses `deriveId(kind, newProjectId, oldId)`, so a
 * replay derives the same ids and the op needs no id map in its payload.
 */
export function deriveId<K extends IdKind>(kind: K, salt: string, key: string): IdOf<K> {
  const [hi, lo] = fnv1a64Parts(`${salt}|${key}`);
  const body = (BigInt(hi) * BigInt(TWO_32) + BigInt(lo)).toString(36).padStart(ID_LENGTH, "0");
  return withPrefix(kind, body);
}
