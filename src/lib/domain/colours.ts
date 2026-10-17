/**
 * Colours (moved from the v0 parser and `lib/mood.ts`). Moodboard colours are stored as
 * lowercase "#rrggbb".
 */

/** A stored colour: "#" and six lowercase hex digits */
export const HEX_COLOUR = /^#[0-9a-f]{6}$/;

/**
 * Plain colour names the parser recognises, with their swatches, in v0's order. A name that
 * contains another ("off white", "white") comes first, so a matcher that blanks out what it found
 * never reads "off white" again as "white".
 */
export const NAMED_COLOURS: readonly (readonly [name: string, hex: string])[] = [
  ["off white", "#f2efe8"],
  ["off-white", "#f2efe8"],
  ["terracotta", "#c65d3b"],
  ["burgundy", "#7a1f2b"],
  ["charcoal", "#36393d"],
  ["mustard", "#d4a017"],
  ["chocolate", "#4e342e"],
  ["ivory", "#f6f1e3"],
  ["cream", "#f1e6cf"],
  ["beige", "#e3d5bd"],
  ["sand", "#d8c3a5"],
  ["olive", "#6f7a3a"],
  ["sage", "#9caf88"],
  ["teal", "#2a8c86"],
  ["navy", "#1f2a44"],
  ["lilac", "#c3aed6"],
  ["blush", "#efc9c2"],
  ["rust", "#a9461f"],
  ["gold", "#c9a227"],
  ["silver", "#c0c0c0"],
  ["black", "#0c0c0c"],
  ["white", "#ffffff"],
  ["grey", "#8a8a8a"],
  ["gray", "#8a8a8a"],
  ["blue", "#2f5bea"],
  ["green", "#2e7d4f"],
  ["yellow", "#f2c94c"],
  ["orange", "#f2994a"],
  ["red", "#d64545"],
  ["pink", "#f4a6b7"],
  ["purple", "#6b4fa0"],
  ["brown", "#7b5544"],
];

/** "#E4572E", "e4572e" and "#e52" → "#e4572e" / "#ee5522"; anything else → null */
export function normaliseHex(hex: string | null | undefined): string | null {
  if (!hex) return null;
  const m = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const v = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return `#${v.toLowerCase()}`;
}
