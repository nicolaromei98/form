/**
 * Agent geometry. Every visual state of FORM's agent is a set of circles
 * plus (optionally) a capsule body and a satellite circle, all fused by
 * the same goo filter. States differ only in where these volumes sit.
 */

export type AgentMode = "idle" | "hover" | "input" | "processing" | "emit" | "compact";

export interface Circle {
  cx: number;
  cy: number;
  r: number;
}
export interface Capsule {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Vec {
  x: number;
  y: number;
}

export interface AgentShape {
  blobs: Circle[];
  body: Capsule;
  satellite: Circle;
}

/** Ring of connected volumes — after the black metaball reference. */
export const RING: { a: number; r: number }[] = [
  { a: -150, r: 30 },
  { a: -112, r: 24 }, // fuses with the previous volume into a bean
  { a: -50, r: 29 },
  { a: -8, r: 19 }, // necked to the previous volume
  { a: 50, r: 31 },
  { a: 100, r: 35 }, // fused pair, bottom
  { a: 160, r: 26 },
];
export const RING_R = 74;

/** Agent scale by viewport: holds the negative space on large screens. */
export function agentScale(vw: number) {
  return vw >= 1280 ? 1.22 : vw >= 900 ? 1.1 : vw >= 600 ? 1 : 0.86;
}
/** Droplets that travel between volumes and fuse into the nucleus on hover */
export const DROPS: { a: number; r: number }[] = [
  { a: -81, r: 12 },
  { a: 129, r: 12 },
];
export const BLOB_COUNT = RING.length + DROPS.length;

export const COMPOSER = { h: 68, sat: 68, gap: 12, maxW: 620, minW: 220 };
/** At rest the goo silhouette sits just inside the crisp DOM surface, so no soft edge shows */
const REST_INSET = 3;
export const COMPACT = { h: 46, lead: 54, w: 184, overlap: 2 };

const rad = (d: number) => (d * Math.PI) / 180;

export function composerWidth(vw: number) {
  return Math.round(Math.min(COMPOSER.maxW, Math.max(COMPOSER.minW, vw - 32 - COMPOSER.sat - COMPOSER.gap)));
}

/** Composer body + satellite placement around an anchor. */
export function composerFrame(anchor: Vec, vw: number) {
  const w = composerWidth(vw);
  const total = w + COMPOSER.gap + COMPOSER.sat;
  const x0 = anchor.x - total / 2;
  return {
    body: { x: x0, y: anchor.y - COMPOSER.h / 2, w, h: COMPOSER.h },
    satellite: { cx: x0 + w + COMPOSER.gap + COMPOSER.sat / 2, cy: anchor.y, r: COMPOSER.sat / 2 },
  };
}

export function compactFrame(anchor: Vec) {
  const total = COMPACT.lead + COMPACT.w - COMPACT.overlap;
  const x0 = anchor.x - total / 2;
  return {
    lead: { cx: x0 + COMPACT.lead / 2, cy: anchor.y, r: COMPACT.lead / 2 },
    body: { x: x0 + COMPACT.lead - COMPACT.overlap, y: anchor.y - COMPACT.h / 2, w: COMPACT.w, h: COMPACT.h },
  };
}

const collapsed = (a: Vec): Capsule => ({ x: a.x, y: a.y, w: 0, h: 0 });

export function agentShape(mode: AgentMode, anchor: Vec, vw: number, docked = false): AgentShape {
  const { x: ax, y: ay } = anchor;

  const sc = agentScale(vw);

  if (mode === "idle" || mode === "hover") {
    const hover = mode === "hover";
    const R = (hover ? RING_R * 0.95 : RING_R) * sc;
    const k = (hover ? 1.03 : 1) * sc;
    const blobs = RING.map(({ a, r }) => ({ cx: ax + Math.cos(rad(a)) * R, cy: ay + Math.sin(rad(a)) * R, r: r * k }));
    for (const d of DROPS) blobs.push({ cx: ax + Math.cos(rad(d.a)) * R, cy: ay + Math.sin(rad(d.a)) * R, r: d.r * sc });
    // Satellite rests inside the small right-hand volume
    const host = blobs[3];
    return { blobs, body: collapsed(anchor), satellite: { cx: host.cx, cy: host.cy, r: host.r * 0.8 } };
  }

  if (mode === "input") {
    const frame = composerFrame(anchor, vw);
    const body = { x: frame.body.x + REST_INSET, y: frame.body.y + REST_INSET, w: frame.body.w - REST_INSET * 2, h: frame.body.h - REST_INSET * 2 };
    const satellite = { ...frame.satellite, r: frame.satellite.r - REST_INSET };
    const inner = COMPOSER.h / 2 - 12;
    const blobs = Array.from({ length: BLOB_COUNT }, (_, i) => ({
      cx: frame.body.x + COMPOSER.h / 2 + (i * (frame.body.w - COMPOSER.h)) / (BLOB_COUNT - 1),
      cy: ay,
      r: inner,
    }));
    return { blobs, body, satellite };
  }

  if (mode === "processing" || mode === "emit") {
    // Three volumes that separate and reconnect; the rest fold into the middle one.
    // At the dock they work inside a short capsule sized to the pill, so nothing pokes out.
    if (docked) {
      const blobs: Circle[] = Array.from({ length: BLOB_COUNT }, () => ({ cx: ax, cy: ay, r: 10 }));
      blobs[0] = { cx: ax - 30, cy: ay, r: 15 };
      blobs[1] = { cx: ax, cy: ay, r: 17 };
      blobs[2] = { cx: ax + 30, cy: ay, r: 15 };
      return { blobs, body: { x: ax - 46, y: ay - 18, w: 92, h: 36 }, satellite: { cx: ax, cy: ay, r: 0 } };
    }
    const blobs: Circle[] = Array.from({ length: BLOB_COUNT }, () => ({ cx: ax, cy: ay, r: 14 }));
    blobs[0] = { cx: ax - 40 * sc, cy: ay, r: 21 * sc };
    blobs[1] = { cx: ax, cy: ay, r: 27 * sc };
    blobs[2] = { cx: ax + 40 * sc, cy: ay, r: 21 * sc };
    return { blobs, body: collapsed(anchor), satellite: { cx: ax, cy: ay, r: 0 } };
  }

  // compact: lead circle fused to a small capsule
  const { lead, body } = compactFrame(anchor);
  const inner = COMPACT.h / 2 - 9;
  const blobs = Array.from({ length: BLOB_COUNT }, (_, i) => ({
    cx: body.x + COMPACT.h / 2 + (i * (body.w - COMPACT.h)) / (BLOB_COUNT - 1),
    cy: anchor.y,
    r: inner,
  }));
  blobs[0] = lead;
  return { blobs, body, satellite: { cx: body.x + body.w - COMPACT.h / 2, cy: anchor.y, r: 0 } };
}
