// The pixel gate with expected differences (plan §10.8, step 19): C against B, 0 differing pixels
// outside the regions of ED-1 to ED-12 (e2e/expected-diffs.md), each of which is also asserted as
// text or state where it is captured (e2e/expected.ts, the specs).
//
// A reference run (--update-snapshots, compare.mjs's base) writes every capture with a sidecar
// `<name>.gate.json` holding where its masks were. A comparing run paints the union of both runs'
// masks (B's boxes and C's) over both images, so a masked line that wraps differently in one build
// can't leak a pixel, then compares the two images at the gate's tolerance.
//
// Two kinds of expected difference:
//   - masked: the region keeps its place and size in both builds (a label, a figure, a chart), and
//     is painted over before the compare;
//   - collapsed: the region's text is shorter or longer in v2 (ED-2, ED-4, ED-5) or its size
//     follows ids (ED-12), so everything after it moves. It is taken out of the layout
//     (`display: none`) in both builds before the capture, and the page that remains, the header,
//     tabs, metrics, every other part of the view surface and the chrome, is compared whole. A
//     height change inside an expected region then can't fail the page or hide a change elsewhere.
//     (Per-element crops of the shifted page can't reach 0 pixels: a fractional shift rasterises
//     text and antialiased edges differently, which the first gate run measured.)
//
// Every comparison is recorded in <artifacts>/gate/<project>/<spec>/<name>.json for the report.
import type { Locator, Page, TestInfo } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { ARTIFACTS_DIR, THRESHOLD } from "./env";

const load = createRequire(__filename);

interface Png {
  width: number;
  height: number;
  data: Buffer;
}
const { PNG } = load("playwright-core/lib/utilsBundle") as {
  PNG: { new (o: { width: number; height: number }): Png; sync: { read(b: Buffer): Png; write(p: Png): Buffer } };
};
type Comparator = (actual: Buffer, expected: Buffer, options: { threshold: number; maxDiffPixels?: number; maxDiffPixelRatio?: number }) => { errorMessage: string; diff?: Buffer } | null;
const compareImages = (load("playwright-core/lib/coreBundle") as { utils: { getComparator(type: string): Comparator } }).utils.getComparator("image/png");

/* ------------------------------------------------------------------ */
/* What a capture leaves out                                           */
/* ------------------------------------------------------------------ */

/** CSS-pixel box at scroll 0 (where both engines draw fixed layers in a full-page capture too) */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** An expected difference: the region it covers is left out of the pixel compare. */
export interface Mask {
  /** ED-1 … ED-12 (e2e/expected-diffs.md) */
  ed: string;
  /** What the region shows, for the report */
  what: string;
  /** Every matching element is left out */
  target: (page: Page) => Locator;
  /** Masks only: a computed region instead of the target's boxes (page coordinates at scroll 0) */
  region?: (page: Page) => Promise<Box[]>;
  /** Masks only: CSS pixels added around each box, for glyph overhang and blur edges (default 2) */
  pad?: number;
}

export interface GateOptions {
  /** Expected differences painted over, in place */
  masks?: readonly Mask[];
  /** Expected differences taken out of the layout in both builds before the capture */
  collapse?: readonly Mask[];
  /** Full page (stills) or the viewport (frames) */
  fullPage?: boolean;
  /** Allowed differing pixels as a share of the image (frames: 0.1%); stills allow none */
  maxDiffPixelRatio?: number;
  /**
   * Exactly one screenshot (motion frames): a retake renders real frames the page could react to.
   * Stills retake until two agree.
   */
  once?: boolean;
}

interface Geometry {
  width: number;
  height: number;
  scale: number;
  masks: { ed: string; what: string; boxes: Box[] }[];
}

interface Sidecar {
  page: Geometry;
  /** With collapsed regions: the page's size and the collapsed boxes before they were taken out */
  full?: { width: number; height: number; collapsed: { ed: string; what: string; boxes: Box[] }[] };
}

export interface GateRecord {
  name: string;
  project: string;
  mode: "page" | "collapsed";
  ok: boolean;
  /** Differing pixels outside the masks */
  differing: number;
  /** Pixels compared, after the masks */
  compared: number;
  /** CSS-pixel area left out per expected difference (this build's boxes, masked or collapsed) */
  masked: Record<string, number>;
  /** Capture sizes (device pixels); with collapsed regions, also the page's own size in each build */
  sizes: { reference: string; actual: string; referencePage?: string; actualPage?: string };
  failures: string[];
}

/* ------------------------------------------------------------------ */
/* In-page work                                                        */
/* ------------------------------------------------------------------ */

async function boxes(locator: Locator, pad: number): Promise<Box[]> {
  return locator.evaluateAll(
    (els, pad) =>
      els
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => ({ x: r.left + scrollX - pad, y: r.top + scrollY - pad, w: r.width + 2 * pad, h: r.height + 2 * pad })),
    pad,
  );
}

async function measure(page: Page, masks: readonly Mask[] = [], padded = true) {
  const out = [];
  for (const m of masks) {
    const pad = padded ? (m.pad ?? 2) : 0;
    const found = m.region ? (await m.region(page)).map((b) => ({ x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad })) : await boxes(m.target(page), pad);
    out.push({ ed: m.ed, what: m.what, boxes: found });
  }
  return out;
}

/** Takes the collapsed regions out of the layout (or puts them back, with none) */
async function collapse(page: Page, regions: readonly Mask[]) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("[data-e2e-collapsed]")) el.removeAttribute("data-e2e-collapsed");
    document.getElementById("e2e-collapse")?.remove();
  });
  if (!regions.length) return;
  for (const r of regions) await r.target(page).evaluateAll((els) => els.forEach((el) => el.setAttribute("data-e2e-collapsed", "")));
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.id = "e2e-collapse";
    style.textContent = "[data-e2e-collapsed] { display: none !important; }";
    document.head.append(style);
  });
}

/** Screenshots until two in a row agree (the page is settled; this only waits out raster work). */
async function stableShot(page: Page, fullPage: boolean, once = false): Promise<Buffer> {
  // Frames keep their animations where frame control seeked them; stills disable them as toHaveScreenshot did
  if (once) return page.screenshot({ fullPage, animations: "allow", caret: "hide", scale: "device" });
  const take = () => page.screenshot({ fullPage, animations: "disabled", caret: "hide", scale: "device" });
  let prev = await take();
  for (let i = 0; i < 4; i++) {
    const next = await take();
    if (next.equals(prev)) return next;
    prev = next;
  }
  return prev;
}

/* ------------------------------------------------------------------ */
/* Image work                                                          */
/* ------------------------------------------------------------------ */

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A CSS box in device pixels, rounded outwards and clipped to the image */
function deviceRect(b: Box, scale: number, img: { width: number; height: number }): Rect {
  return {
    x0: Math.max(0, Math.floor(b.x * scale)),
    y0: Math.max(0, Math.floor(b.y * scale)),
    x1: Math.min(img.width, Math.ceil((b.x + b.w) * scale)),
    y1: Math.min(img.height, Math.ceil((b.y + b.h) * scale)),
  };
}

function paint(img: Png, rects: Rect[]) {
  for (const r of rects)
    for (let y = r.y0; y < r.y1; y++)
      for (let x = r.x0; x < r.x1; x++) {
        const i = (y * img.width + x) * 4;
        img.data[i] = 255;
        img.data[i + 1] = 0;
        img.data[i + 2] = 255;
        img.data[i + 3] = 255;
      }
}

const maskRects = (g: Geometry, img: { width: number; height: number }) => g.masks.flatMap((m) => m.boxes.map((b) => deviceRect(b, g.scale, img)));

/* ------------------------------------------------------------------ */
/* The gate                                                            */
/* ------------------------------------------------------------------ */

const isUpdate = (testInfo: TestInfo) => testInfo.config.updateSnapshots === "all" || testInfo.config.updateSnapshots === "changed";

function record(testInfo: TestInfo, rec: GateRecord) {
  const dir = join(ARTIFACTS_DIR, "gate", testInfo.project.name, testInfo.file.split("/").pop()!);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${rec.name.replace(/\.png$/, "")}.json`), JSON.stringify(rec, null, 2) + "\n");
}

function attach(testInfo: TestInfo, name: string, kind: string, png: Png | Buffer) {
  const file = testInfo.outputPath(`${name.replace(/\.png$/, "")}-${kind}.png`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.isBuffer(png) ? png : PNG.sync.write(png));
  void testInfo.attach(`${name}-${kind}`, { path: file, contentType: "image/png" });
}

const size = (s: { width: number; height: number }) => `${s.width}×${s.height}`;

/**
 * Captures `name` and compares it with the reference build's capture outside the expected
 * differences. Returns the record; the caller asserts `ok` (so a frame loop can finish first).
 */
export async function gate(page: Page, testInfo: TestInfo, name: string, opts: GateOptions = {}): Promise<GateRecord> {
  const fullPage = opts.fullPage ?? true;
  const ref = testInfo.snapshotPath(name);
  const side = ref.replace(/\.png$/, ".gate.json");
  const collapsed = opts.collapse ?? [];
  const scale = await page.evaluate(() => devicePixelRatio);

  // With collapsed regions: the page as it is (its size, and where they were), then without them
  const sidecar = {} as Sidecar;
  if (collapsed.length) {
    const whole = PNG.sync.read(await stableShot(page, fullPage, opts.once));
    sidecar.full = { width: whole.width, height: whole.height, collapsed: await measure(page, collapsed, false) };
    await collapse(page, collapsed);
  }
  const shot = await stableShot(page, fullPage, opts.once);
  const shotPng = PNG.sync.read(shot);
  sidecar.page = { width: shotPng.width, height: shotPng.height, scale, masks: await measure(page, opts.masks) };
  if (collapsed.length) await collapse(page, []);

  const masked: Record<string, number> = {};
  for (const m of [...sidecar.page.masks, ...(sidecar.full?.collapsed ?? [])]) masked[m.ed] = (masked[m.ed] ?? 0) + Math.round(m.boxes.reduce((s, b) => s + b.w * b.h, 0));
  const rec: GateRecord = {
    name,
    project: testInfo.project.name,
    mode: collapsed.length ? "collapsed" : "page",
    ok: true,
    differing: 0,
    compared: 0,
    masked,
    sizes: { reference: size(shotPng), actual: size(shotPng), ...(sidecar.full ? { referencePage: size(sidecar.full), actualPage: size(sidecar.full) } : {}) },
    failures: [],
  };

  if (isUpdate(testInfo) || !existsSync(ref) || !existsSync(side)) {
    mkdirSync(dirname(ref), { recursive: true });
    writeFileSync(ref, shot);
    writeFileSync(side, JSON.stringify(sidecar, null, 2) + "\n");
    if (!isUpdate(testInfo)) rec.failures.push(`No reference for ${name}: written now`);
    rec.ok = rec.failures.length === 0;
    record(testInfo, rec);
    return rec;
  }

  const refSide = JSON.parse(readFileSync(side, "utf8")) as Sidecar;
  const refPng = PNG.sync.read(readFileSync(ref));
  rec.sizes.reference = size(refPng);
  if (refSide.full) rec.sizes.referencePage = size(refSide.full);

  if (refPng.width !== shotPng.width || refPng.height !== shotPng.height) {
    rec.failures.push(`size changed: ${rec.sizes.reference} → ${rec.sizes.actual}`);
    attach(testInfo, name, "expected", refPng);
    attach(testInfo, name, "actual", shotPng);
  } else {
    const rects = [...maskRects(refSide.page, refPng), ...maskRects(sidecar.page, shotPng)];
    paint(shotPng, rects);
    paint(refPng, rects);
    const res = compareImages(PNG.sync.write(shotPng), PNG.sync.write(refPng), { threshold: THRESHOLD, maxDiffPixels: 0 });
    const total = shotPng.width * shotPng.height;
    let maskedPx = 0;
    for (let i = 0; i < shotPng.data.length; i += 4) if (shotPng.data[i] === 255 && shotPng.data[i + 1] === 0 && shotPng.data[i + 2] === 255 && shotPng.data[i + 3] === 255) maskedPx++;
    rec.compared = total - maskedPx;
    if (res) {
      const pixels = Number(/(\d+) pixels/.exec(res.errorMessage)?.[1] ?? NaN);
      rec.differing = Number.isNaN(pixels) ? total : pixels;
    }
    const allowed = Math.floor((opts.maxDiffPixelRatio ?? 0) * total);
    if (rec.differing > allowed) {
      rec.failures.push(`${rec.differing} differing pixels outside the expected differences${allowed ? ` (allowed ${allowed})` : ""}`);
      attach(testInfo, name, "expected", refPng);
      attach(testInfo, name, "actual", shotPng);
      if (res?.diff) attach(testInfo, name, "diff", res.diff);
    }
  }
  rec.ok = rec.failures.length === 0;
  record(testInfo, rec);
  return rec;
}
