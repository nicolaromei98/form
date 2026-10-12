import { uid } from "./seed";
import type { MoodInput, MoodItem, MoodKind, MoodLayout } from "./schema";

/**
 * Moodboard geometry. Every value is in board-width units (1 = the board's
 * width), so the same arrangement renders at any viewport size.
 */
export const MOOD_PAD = 0.03;
export const MOOD_GAP = 0.018;

const DEFAULT_SIZE: Record<MoodKind, { w: number; h: number }> = {
  image: { w: 0.24, h: 0.18 },
  color: { w: 0.13, h: 0.16 },
  note: { w: 0.22, h: 0.12 },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** First free spot, scanning left → right for the lowest landing height (a skyline). */
export function placeNext(items: MoodItem[], w: number): { x: number; y: number } {
  let best = { x: MOOD_PAD, y: Infinity };
  for (let x = MOOD_PAD; x + w <= 1 - MOOD_PAD + 1e-9; x += 0.01) {
    let y = MOOD_PAD;
    for (const it of items) if (it.x < x + w + MOOD_GAP && it.x + it.w + MOOD_GAP > x) y = Math.max(y, it.y + it.h + MOOD_GAP);
    if (y < best.y - 1e-9) best = { x, y };
  }
  return Number.isFinite(best.y) ? best : { x: MOOD_PAD, y: MOOD_PAD };
}

export function normaliseHex(hex: string | null | undefined): string | null {
  if (!hex) return null;
  const m = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const v = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return `#${v.toLowerCase()}`;
}

/** Builds stored items from inputs, landing each in the next free spot unless it brings its own. */
export function addMoodItems(existing: MoodItem[], inputs: MoodInput[]): MoodItem[] {
  const mood = [...existing];
  for (const input of inputs) {
    const hex = normaliseHex(input.hex);
    if (input.kind === "image" && !input.asset) continue;
    if (input.kind === "color" && !hex) continue;
    const d = DEFAULT_SIZE[input.kind];
    const w = clamp(input.w ?? d.w, 0.04, 0.6);
    const h = clamp(input.h ?? d.h, 0.03, 3);
    const at = input.x != null && input.y != null ? { x: clamp(input.x, 0, 1 - w), y: clamp(input.y, 0, 20) } : placeNext(mood, w);
    mood.push({
      id: uid("m"),
      kind: input.kind,
      x: at.x,
      y: at.y,
      w,
      h,
      r: 0,
      asset: input.kind === "image" ? (input.asset ?? null) : null,
      hex: input.kind === "color" ? hex : null,
      text: input.text?.slice(0, 400) ?? null,
    });
  }
  return mood;
}

export function patchMoodItem(item: MoodItem, patch: Partial<Pick<MoodItem, "x" | "y" | "w" | "h" | "r" | "hex" | "text">>): MoodItem {
  const next = { ...item, ...patch };
  next.w = clamp(next.w, 0.04, 1);
  next.h = clamp(next.h, 0.03, 3);
  next.x = clamp(next.x, 0, 1 - next.w);
  next.y = clamp(next.y, 0, 20);
  next.r = clamp(next.r, -15, 15);
  next.hex = item.kind === "color" ? (normaliseHex(next.hex) ?? item.hex) : null;
  return next;
}

/** Stable pseudo-random in [0, 1) per item, so a collage is the same every time. */
function hash(id: string, salt: number) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

/** Re-lays the board out. Every reference keeps its proportions; only size and place change. */
export function arrangeMood(items: MoodItem[], layout: MoodLayout): MoodItem[] {
  if (!items.length) return items;
  if (layout === "collage") return collage(items);

  // Colours gather into a compact palette strip on top; everything else is laid out below it
  const colours = items.filter((it) => it.kind === "color");
  const rest = items.filter((it) => it.kind !== "color");
  const placed = new Map<string, MoodItem>();
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

/** A contact sheet: equal cells, each reference fitted (not cropped) and centred in its cell. */
function grid(items: MoodItem[], top: number): MoodItem[] {
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

/** Equal columns, each reference dropped into the shortest one. */
function masonry(items: MoodItem[], top: number): MoodItem[] {
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

/** Loose and overlapping, like prints laid on a table; colours stay small, like paint chips. */
function collage(items: MoodItem[]): MoodItem[] {
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
