import { MOOD_BOUNDS } from "@/lib/domain/limits";
import { compareKeys, keyAfter, nKeysBetween } from "@/lib/domain/order";
import type { MoodKind, MoodLayout, OrderKey } from "@/lib/domain/schema/primitives";

/**
 * Moodboard geometry (moved from v0 `lib/mood.ts`, same arithmetic). Every value is in board-width
 * units (1 = the board's width), so an arrangement renders the same at any viewport size. v2 keeps
 * items in a record keyed by id and stacks them by `z` key: callers pass items bottom first
 * (`sortedByZ`), and these functions return geometry only, so a reducer writes just the fields
 * that change.
 */

export const MOOD_PAD = 0.03;
export const MOOD_GAP = 0.018;
/** New items land at most this wide */
export const MOOD_NEW_MAX_W = 0.6;

/** Where a new item of each kind lands, when it brings no size of its own */
export const MOOD_DEFAULT_SIZE: Readonly<Record<MoodKind, { readonly w: number; readonly h: number }>> = {
  image: { w: 0.24, h: 0.18 },
  color: { w: 0.13, h: 0.16 },
  note: { w: 0.22, h: 0.12 },
};

export interface MoodRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A rectangle plus its rotation in degrees */
export interface MoodBox extends MoodRect {
  readonly r: number;
}

/** What an arrangement reads of an item */
export interface ArrangeItem extends MoodBox {
  readonly id: string;
  readonly kind: MoodKind;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const { x: X, y: Y, w: W, h: H, r: R } = MOOD_BOUNDS;

/** A box inside the stored bounds: the size first, then the place, so `x + w ≤ 1` */
export function clampBox(box: MoodBox): MoodBox {
  const w = clamp(box.w, W.min, W.max);
  const h = clamp(box.h, H.min, H.max);
  return { x: clamp(box.x, X.min, X.max - w), y: clamp(box.y, Y.min, Y.max), w, h, r: clamp(box.r, R.min, R.max) };
}

/** First free spot for a box of width `w`, scanning left → right for the lowest landing height (a skyline) */
export function placeNext(items: readonly MoodRect[], w: number): { x: number; y: number } {
  let best = { x: MOOD_PAD, y: Infinity };
  for (let x = MOOD_PAD; x + w <= 1 - MOOD_PAD + 1e-9; x += 0.01) {
    let y = MOOD_PAD;
    for (const it of items) if (it.x < x + w + MOOD_GAP && it.x + it.w + MOOD_GAP > x) y = Math.max(y, it.y + it.h + MOOD_GAP);
    if (y < best.y - 1e-9) best = { x, y };
  }
  return Number.isFinite(best.y) ? best : { x: MOOD_PAD, y: MOOD_PAD };
}

/** What a new item may bring: a size, and a place when it was dropped somewhere */
export interface MoodPlacement {
  readonly x?: number | null;
  readonly y?: number | null;
  readonly w?: number | null;
  readonly h?: number | null;
}

/**
 * Where a new item lands: its own size clamped (0.04–0.6 wide), at its own place when it brings
 * one, else in the next free spot among `placed` (the items already on the board, including the
 * ones added before it in the same op). Unrotated.
 */
export function placeNew(kind: MoodKind, input: MoodPlacement, placed: readonly MoodRect[]): MoodBox {
  const d = MOOD_DEFAULT_SIZE[kind];
  const w = clamp(input.w ?? d.w, W.min, MOOD_NEW_MAX_W);
  const h = clamp(input.h ?? d.h, H.min, H.max);
  const at = input.x != null && input.y != null ? { x: clamp(input.x, X.min, 1 - w), y: clamp(input.y, Y.min, Y.max) } : placeNext(placed, w);
  return { x: at.x, y: at.y, w, h, r: 0 };
}

/** A box after a direct edit (drag, resize, rotate), clamped to the stored bounds */
export function patchBox(box: MoodBox, patch: Partial<MoodBox>): MoodBox {
  return clampBox({
    x: patch.x ?? box.x,
    y: patch.y ?? box.y,
    w: patch.w ?? box.w,
    h: patch.h ?? box.h,
    r: patch.r ?? box.r,
  });
}

/* ------------------------------------------------------------------
   Stacking
   ------------------------------------------------------------------ */

/** The top item's z key, or null on an empty board */
export function topZ(items: Iterable<{ readonly z: OrderKey }>): OrderKey | null {
  let top: OrderKey | null = null;
  for (const item of items) if (top === null || compareKeys(item.z, top) > 0) top = item.z;
  return top;
}

/** A z key above every item: "bring to front" */
export function frontZ(items: Iterable<{ readonly z: OrderKey }>): OrderKey {
  return keyAfter(topZ(items));
}

/** `n` ascending z keys above every item, for items added together */
export function frontZs(items: Iterable<{ readonly z: OrderKey }>, n: number): OrderKey[] {
  return nKeysBetween(topZ(items), null, n);
}

/* ------------------------------------------------------------------
   Arrangements
   ------------------------------------------------------------------ */

/**
 * Re-lays the given items out (bottom first) and returns each one's new box, keyed by id. Every
 * reference keeps its proportions; only size, place and rotation change, and every box stays
 * inside the stored bounds however tall or many the items are. Deterministic: the collage's
 * jitter is a hash of each item's id.
 */
export function arrange(items: readonly ArrangeItem[], layout: MoodLayout): Map<string, MoodBox> {
  return new Map(arranged(items, layout).map((it) => [it.id, clampBox(it)]));
}

function arranged(items: readonly ArrangeItem[], layout: MoodLayout): ArrangeItem[] {
  if (!items.length) return [];
  if (layout === "collage") return collage(items);

  // Colours gather into a compact palette strip on top; everything else is laid out below it
  const colours = items.filter((it) => it.kind === "color");
  const rest = items.filter((it) => it.kind !== "color");
  const placed = new Map<string, ArrangeItem>();
  let top = MOOD_PAD;
  if (colours.length) {
    const sw = Math.min(0.1, (1 - 2 * MOOD_PAD - (colours.length - 1) * MOOD_GAP) / colours.length);
    const sh = sw * 1.25;
    colours.forEach((it, i) => placed.set(it.id, { ...it, x: MOOD_PAD + i * (sw + MOOD_GAP), y: MOOD_PAD, w: sw, h: sh, r: 0 }));
    top += sh + MOOD_GAP * 1.6;
  }
  const laid = layout === "grid" ? grid(rest, top) : masonry(rest, top);
  for (const it of laid) placed.set(it.id, it);
  // Stacking order is preserved
  return items.map((it) => placed.get(it.id)!);
}

/** A contact sheet: equal cells, each reference fitted (not cropped) and centred in its cell */
function grid(items: readonly ArrangeItem[], top: number): ArrangeItem[] {
  const n = items.length;
  if (!n) return [];
  const cols = clamp(Math.ceil(Math.sqrt(n * 1.6)), 2, 5);
  const cw = (1 - 2 * MOOD_PAD - (cols - 1) * MOOD_GAP) / cols;
  const ch = cw * 0.82;
  return items.map((it, i) => {
    const a = it.h / it.w;
    const w = a > ch / cw ? ch / a : cw;
    const h = w * a;
    const cx = MOOD_PAD + (i % cols) * (cw + MOOD_GAP);
    const cy = top + Math.floor(i / cols) * (ch + MOOD_GAP);
    return { ...it, x: cx + (cw - w) / 2, y: cy + (ch - h) / 2, w, h, r: 0 };
  });
}

/** Equal columns, each reference dropped into the shortest one */
function masonry(items: readonly ArrangeItem[], top: number): ArrangeItem[] {
  const n = items.length;
  if (!n) return [];
  const cols = n <= 2 ? 2 : n <= 6 ? 3 : 4;
  const cw = (1 - 2 * MOOD_PAD - (cols - 1) * MOOD_GAP) / cols;
  const heights = Array<number>(cols).fill(top);
  return items.map((it) => {
    const col = heights.indexOf(Math.min(...heights));
    const h = cw * (it.h / it.w);
    const y = heights[col];
    heights[col] += h + MOOD_GAP;
    return { ...it, x: MOOD_PAD + col * (cw + MOOD_GAP), y, w: cw, h, r: 0 };
  });
}

/** A stable value in [0, 1) per item and salt (FNV-1a 32-bit of the id), so a collage is the same every time */
function hash(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

/** Loose and overlapping, like prints laid on a table; colours stay small, like paint chips */
function collage(items: readonly ArrangeItem[]): ArrangeItem[] {
  const n = items.length;
  const cols = clamp(Math.round(n / 2), 3, 5);
  const gap = MOOD_GAP * 0.4;
  const cw = (1 - 2 * MOOD_PAD - (cols - 1) * gap) / cols;
  const heights = Array<number>(cols).fill(MOOD_PAD);
  return items.map((it) => {
    const col = heights.indexOf(Math.min(...heights));
    const s = (it.kind === "color" ? 0.45 : 0.82) + hash(it.id, 1) * 0.36;
    const w = Math.min(cw * s, 0.6);
    const h = w * (it.h / it.w);
    const x = MOOD_PAD + col * (cw + gap) + (cw - w) / 2 + (hash(it.id, 2) - 0.5) * cw * 0.3;
    const y = heights[col] + (hash(it.id, 3) - 0.5) * cw * 0.16;
    heights[col] += h * 0.88 + gap;
    return { ...it, x: clamp(x, 0, 1 - w), y: clamp(y, 0, 20), w, h, r: Math.round((hash(it.id, 4) - 0.5) * 10) };
  });
}
