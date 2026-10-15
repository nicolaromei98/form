// The pixel gate with expected differences (plan §10.8, step 19): C against B, 0 differing pixels
// outside the masked regions of ED-1 to ED-12 (e2e/expected-diffs.md), each masked region also
// asserted as text or state where it is captured.
//
// A reference run (--update-snapshots, compare.mjs's base) writes every capture unmasked, with a
// sidecar `<name>.gate.json` holding where its masks and crops were. A comparing run paints the
// union of both runs' masks (B's boxes and C's) over both images, so a masked line that wraps
// differently in one build can't leak a pixel, then compares:
//
//   - "page": the whole capture (full page for stills, the viewport for frames), when both builds
//     give the same size and nothing inside moves;
//   - "crops": for states whose expected text changes a height (ED-2, ED-4, ED-5), one capture of
//     the content with the fixed layers hidden, compared element by element (header, tabs,
//     metrics, each view surface, each brief line…), plus one capture of the fixed layers alone
//     (chrome, agent, caption) with the content hidden. A height change in an expected region then
//     moves crops without failing them, and a change anywhere else still fails its own crop.
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
/* What a capture masks and how it is cut                              */
/* ------------------------------------------------------------------ */

/** An expected difference: the region it covers is excluded from the pixel compare. */
export interface Mask {
  /** ED-1 … ED-12 (e2e/expected-diffs.md) */
  ed: string;
  /** What the region shows, for the report */
  what: string;
  target: (page: Page) => Locator;
  /** CSS pixels added around each box: glyph overhang, focus rings, blur edges (default 2) */
  pad?: number;
}

/** An element compared on its own in "crops" mode. Every match is a crop, paired by order. */
export interface Crop {
  name: string;
  target: (page: Page) => Locator;
}

export interface GateOptions {
  masks?: readonly Mask[];
  /** Crops mode: the content's elements, compared one by one */
  crops?: readonly Crop[];
  /** Full page (stills) or the viewport (frames) */
  fullPage?: boolean;
  /** Allowed differing pixels as a share of the compared pixels (frames: 0.1%); stills allow none */
  maxDiffPixelRatio?: number;
  /**
   * Exactly one screenshot (motion frames): a retake renders real frames the page could react to.
   * Stills retake until two agree.
   */
  once?: boolean;
}

/** CSS-pixel box at scroll 0 (where both engines draw fixed layers in a full-page capture too) */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Geometry {
  width: number;
  height: number;
  scale: number;
  masks: { ed: string; what: string; boxes: Box[] }[];
  crops: { name: string; boxes: Box[] }[];
}

interface Sidecar {
  page: Geometry;
  /** Crops mode: the content capture's and the fixed layers' geometry */
  content?: Geometry;
  layers?: Geometry;
}

export interface GateRecord {
  name: string;
  project: string;
  mode: "page" | "crops";
  ok: boolean;
  /** Differing pixels outside the masks, summed over every comparison of this capture */
  differing: number;
  /** Pixels compared, after the masks */
  compared: number;
  /** Pixels excluded by masks, by ED, in the comparing build's capture */
  masked: Record<string, number>;
  sizes: { reference: string; actual: string };
  failures: string[];
  /** Crops mode: every crop compared */
  crops?: { name: string; size: string; differing: number }[];
}

/* ------------------------------------------------------------------ */
/* In-page measurement and layers                                      */
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

async function geometry(page: Page, opts: GateOptions, size: { width: number; height: number }, crops: boolean): Promise<Geometry> {
  const scale = await page.evaluate(() => devicePixelRatio);
  const masks = [];
  for (const m of opts.masks ?? []) masks.push({ ed: m.ed, what: m.what, boxes: await boxes(m.target(page), m.pad ?? 2) });
  const cropBoxes = [];
  if (crops) for (const c of opts.crops ?? []) cropBoxes.push({ name: c.name, boxes: await boxes(c.target(page), 0) });
  return { ...size, scale, masks, crops: cropBoxes };
}

/**
 * The fixed layers drawn over the content: the chrome (veil, header, corners), the agent and its
 * captions, the intro. Everything the app renders next to `main` except the ground.
 */
const LAYERS = "body > :not(main, .ground, script, style)";

/** Hides the content or the fixed layers (visibility only: nothing moves) */
async function hide(page: Page, what: "content" | "layers" | null) {
  await page.evaluate(
    ({ what, layers }) => {
      document.getElementById("e2e-gate-hide")?.remove();
      if (!what) return;
      const style = document.createElement("style");
      style.id = "e2e-gate-hide";
      style.textContent = `${what === "content" ? "main" : layers} { visibility: hidden !important; }`;
      document.head.append(style);
    },
    { what, layers: LAYERS },
  );
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

const MASK_RGBA = [255, 0, 255, 255];

/** A CSS box in device pixels, rounded outwards and clipped to the image */
function deviceRect(b: Box, scale: number, img: { width: number; height: number }) {
  const x0 = Math.max(0, Math.floor(b.x * scale));
  const y0 = Math.max(0, Math.floor(b.y * scale));
  const x1 = Math.min(img.width, Math.ceil((b.x + b.w) * scale));
  const y1 = Math.min(img.height, Math.ceil((b.y + b.h) * scale));
  return { x0, y0, x1, y1 };
}

function paint(img: Png, rects: { x0: number; y0: number; x1: number; y1: number }[]): number {
  let n = 0;
  for (const r of rects) {
    for (let y = r.y0; y < r.y1; y++)
      for (let x = r.x0; x < r.x1; x++) {
        const i = (y * img.width + x) * 4;
        if (img.data[i] === 255 && img.data[i + 1] === 0 && img.data[i + 2] === 255 && img.data[i + 3] === 255) continue;
        img.data[i] = MASK_RGBA[0];
        img.data[i + 1] = MASK_RGBA[1];
        img.data[i + 2] = MASK_RGBA[2];
        img.data[i + 3] = MASK_RGBA[3];
        n++;
      }
  }
  return n;
}

function crop(img: Png, r: { x0: number; y0: number; x1: number; y1: number }): Png {
  const out = new PNG({ width: r.x1 - r.x0, height: r.y1 - r.y0 });
  for (let y = r.y0; y < r.y1; y++) img.data.copy(out.data, (y - r.y0) * out.width * 4, (y * img.width + r.x0) * 4, (y * img.width + r.x1) * 4);
  return out;
}

const clone = (img: Png): Png => {
  const out = new PNG({ width: img.width, height: img.height });
  img.data.copy(out.data);
  return out;
};

/** Differing pixels between two same-sized images at the gate's per-pixel threshold */
function differing(actual: Png, expected: Png): { pixels: number; diff?: Buffer } {
  const res = compareImages(PNG.sync.write(actual), PNG.sync.write(expected), { threshold: THRESHOLD, maxDiffPixels: 0 });
  if (!res) return { pixels: 0 };
  const pixels = Number(/(\d+) pixels/.exec(res.errorMessage)?.[1] ?? NaN);
  return { pixels: Number.isNaN(pixels) ? actual.width * actual.height : pixels, diff: res.diff };
}

/** The masks of one geometry, as device rects in its own image, optionally relative to an origin */
function maskRects(g: Geometry, img: { width: number; height: number }, origin = { x: 0, y: 0 }) {
  return g.masks.flatMap((m) => m.boxes.map((b) => deviceRect({ ...b, x: b.x - origin.x, y: b.y - origin.y }, g.scale, img)));
}

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

/**
 * Captures `name` and compares it with the reference build's capture outside the expected
 * differences. Returns the record; the caller asserts `ok` (so a frame loop can finish first).
 */
export async function gate(page: Page, testInfo: TestInfo, name: string, opts: GateOptions = {}): Promise<GateRecord> {
  const fullPage = opts.fullPage ?? true;
  const ref = testInfo.snapshotPath(name);
  const side = ref.replace(/\.png$/, ".gate.json");
  const cropsMode = (opts.crops?.length ?? 0) > 0;

  // The page as the user sees it: always captured, the reference keeps it whole
  await hide(page, null);
  const shot = await stableShot(page, fullPage, opts.once);
  const shotPng = PNG.sync.read(shot);
  const sidecar: Sidecar = { page: await geometry(page, opts, shotPng, false) };
  let content: Buffer | null = null;
  let layers: Buffer | null = null;
  if (cropsMode) {
    await hide(page, "layers");
    content = await stableShot(page, true);
    sidecar.content = await geometry(page, opts, PNG.sync.read(content), true);
    await hide(page, "content");
    layers = await stableShot(page, false);
    sidecar.layers = await geometry(page, { masks: opts.masks }, PNG.sync.read(layers), false);
    await hide(page, null);
  }

  const files = { page: ref, content: ref.replace(/\.png$/, ".content.png"), layers: ref.replace(/\.png$/, ".layers.png") };
  if (isUpdate(testInfo) || !existsSync(ref) || !existsSync(side)) {
    mkdirSync(dirname(ref), { recursive: true });
    writeFileSync(files.page, shot);
    if (content) writeFileSync(files.content, content);
    if (layers) writeFileSync(files.layers, layers);
    writeFileSync(side, JSON.stringify(sidecar, null, 2) + "\n");
    const rec: GateRecord = {
      name,
      project: testInfo.project.name,
      mode: cropsMode ? "crops" : "page",
      ok: isUpdate(testInfo),
      differing: 0,
      compared: 0,
      masked: {},
      sizes: { reference: `${shotPng.width}×${shotPng.height}`, actual: `${shotPng.width}×${shotPng.height}` },
      failures: isUpdate(testInfo) ? [] : [`No reference for ${name}: written now`],
    };
    record(testInfo, rec);
    return rec;
  }

  const refSide = JSON.parse(readFileSync(side, "utf8")) as Sidecar;
  const refPng = PNG.sync.read(readFileSync(files.page));
  const rec: GateRecord = {
    name,
    project: testInfo.project.name,
    mode: cropsMode ? "crops" : "page",
    ok: true,
    differing: 0,
    compared: 0,
    masked: {},
    sizes: { reference: `${refPng.width}×${refPng.height}`, actual: `${shotPng.width}×${shotPng.height}` },
    failures: [],
  };
  const ratio = opts.maxDiffPixelRatio ?? 0;
  for (const m of sidecar.page.masks) rec.masked[m.ed] = (rec.masked[m.ed] ?? 0) + m.boxes.reduce((s, b) => s + Math.round(b.w * b.h * sidecar.page.scale ** 2), 0);

  /** Compares two same-sized images with both builds' masks painted over both */
  const compareMasked = (label: string, actual: Png, expected: Png, rects: ReturnType<typeof maskRects>) => {
    const a = clone(actual);
    const e = clone(expected);
    paint(a, rects);
    paint(e, rects);
    const { pixels, diff } = differing(a, e);
    const total = a.width * a.height;
    const masked = a.data.reduce((n, v, i) => (i % 4 === 0 && v === 255 && a.data[i + 1] === 0 && a.data[i + 2] === 255 ? n + 1 : n), 0);
    rec.compared += total - masked;
    rec.differing += pixels;
    if (pixels > Math.floor(ratio * total)) {
      rec.failures.push(`${label}: ${pixels} differing pixels outside the masks${ratio ? ` (allowed ${Math.floor(ratio * total)})` : ""}`);
      attach(testInfo, name, `${label}-expected`, e);
      attach(testInfo, name, `${label}-actual`, a);
      if (diff) attach(testInfo, name, `${label}-diff`, diff);
    }
    return pixels;
  };

  if (!cropsMode) {
    if (refPng.width !== shotPng.width || refPng.height !== shotPng.height) {
      rec.failures.push(`size changed: ${rec.sizes.reference} → ${rec.sizes.actual}`);
      attach(testInfo, name, "expected", refPng);
      attach(testInfo, name, "actual", shotPng);
    } else compareMasked("page", shotPng, refPng, [...maskRects(refSide.page, refPng), ...maskRects(sidecar.page, shotPng)]);
  } else {
    // The fixed layers over the bare ground: one viewport each
    const refLayers = PNG.sync.read(readFileSync(files.layers));
    const actLayers = PNG.sync.read(layers!);
    if (refLayers.width !== actLayers.width || refLayers.height !== actLayers.height) rec.failures.push(`layers: size changed`);
    else compareMasked("layers", actLayers, refLayers, [...maskRects(refSide.layers!, refLayers), ...maskRects(sidecar.layers!, actLayers)]);

    // The content, element by element
    const refContent = PNG.sync.read(readFileSync(files.content));
    const actContent = PNG.sync.read(content!);
    rec.crops = [];
    for (const c of sidecar.content!.crops) {
      const theirs = refSide.content!.crops.find((r) => r.name === c.name)?.boxes ?? [];
      if (theirs.length !== c.boxes.length) {
        rec.failures.push(`crop ${c.name}: ${theirs.length} element(s) in the reference, ${c.boxes.length} here`);
        continue;
      }
      c.boxes.forEach((box, i) => {
        const label = c.boxes.length > 1 ? `${c.name}[${i}]` : c.name;
        const mine = deviceRect(box, sidecar.content!.scale, actContent);
        const their = deviceRect(theirs[i], refSide.content!.scale, refContent);
        const size = `${mine.x1 - mine.x0}×${mine.y1 - mine.y0}`;
        if (mine.x1 - mine.x0 !== their.x1 - their.x0 || mine.y1 - mine.y0 !== their.y1 - their.y0) {
          rec.failures.push(`crop ${label}: size changed ${their.x1 - their.x0}×${their.y1 - their.y0} → ${size}`);
          rec.crops!.push({ name: label, size, differing: NaN });
          return;
        }
        const a = crop(actContent, mine);
        const e = crop(refContent, their);
        const rects = [
          ...maskRects(sidecar.content!, a, { x: box.x, y: box.y }),
          ...maskRects(refSide.content!, e, { x: theirs[i].x, y: theirs[i].y }),
        ];
        rec.crops!.push({ name: label, size, differing: compareMasked(`crop-${label}`, a, e, rects) });
      });
    }
  }
  rec.ok = rec.failures.length === 0;
  record(testInfo, rec);
  return rec;
}
