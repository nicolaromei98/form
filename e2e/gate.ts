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
  /** The retry protocol's steps, when the first capture differed (see `gate`) */
  retries?: string[];
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

/**
 * Holds the page's layout still while Chromium takes full-page screenshots (stills), or lets it go.
 *
 * Chromium takes a full-page screenshot (Page.captureScreenshot with captureBeyondViewport) by
 * emulating a 1×1 view, then the capture size, then restoring the page (page_handler.cc, the
 * crbug.com/40727379 workaround). Now and then, mostly on a screenshot taken right after another,
 * the renderer lays the page out and paints at that 1×1 view. The containers Blink composites with
 * their own paint offset (the backdrop-filter glass of the view tabs and of the metrics, the fixed
 * "Ask FORM" pill, which useViewport also moves on the resize) land on other subpixel positions, and
 * their text is painted there. Blink doesn't repaint the descendants of such a container when it
 * moves back by a fraction of a pixel (paint_invalidator.cc, crbug.com/833083), so the capture shows
 * that text 1 CSS px off: a second image of the same page, drawn by B and C alike (chromium-phone
 * tracker-list, e2e/expected-diffs.md). With the document's width held and the app's resize
 * listeners kept from the capture's transient sizes, nothing moves, and every capture paints the
 * page as it is at rest. WebKit snapshots the page in one pass without resizing it, so it isn't held.
 */
async function hold(page: Page, on: boolean) {
  await page.evaluate((on) => {
    const w = window as unknown as { __e2eHold?: () => void };
    w.__e2eHold?.();
    delete w.__e2eHold;
    if (!on) return;
    const style = document.createElement("style");
    style.id = "e2e-capture-hold";
    style.textContent = `html { width: ${document.documentElement.getBoundingClientRect().width}px !important; }`;
    document.head.append(style);
    // At the target, capture listeners run before the app's own: the resize never reaches them
    const quiet = (e: Event) => e.stopImmediatePropagation();
    addEventListener("resize", quiet, { capture: true });
    visualViewport?.addEventListener("resize", quiet, { capture: true });
    w.__e2eHold = () => {
      style.remove();
      removeEventListener("resize", quiet, { capture: true });
      visualViewport?.removeEventListener("resize", quiet, { capture: true });
    };
  }, on);
}

/** Screenshots until two in a row agree (the page is settled; this only waits out raster work). */
async function stableShot(page: Page, fullPage: boolean, once = false): Promise<Buffer> {
  // Frames keep their animations where frame control seeked them; stills disable them as toHaveScreenshot did
  if (once) return page.screenshot({ fullPage, animations: "allow", caret: "hide", scale: "device" });
  const take = () => page.screenshot({ fullPage, animations: "disabled", caret: "hide", scale: "device" });
  const held = fullPage && page.context().browser()?.browserType().name() === "chromium";
  if (held) await hold(page, true);
  try {
    let prev = await take();
    for (let i = 0; i < 4; i++) {
      const next = await take();
      if (next.equals(prev)) return next;
      prev = next;
    }
    return prev;
  } finally {
    if (held) await hold(page, false);
  }
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

interface Capture {
  shot: Buffer;
  sidecar: Sidecar;
}

/**
 * Real time between taking the collapsed regions out and the first screenshot.
 *
 * WebKit draws the ground's dot grid (`.ground`, a radial-gradient tiled every 11 px) from one tile
 * it rasterises and caches for a few seconds (StyleGradientImage). A snapshot painted before the
 * rendering update that follows a layout change can make that tile itself, in a second, harder-edged
 * rasterisation, and every later screenshot of the page reuses it: 1 to 5 grey levels on every dot of
 * the first viewport, B and C alike. The collapse is such a layout change: straight after it,
 * brief-client drew that second image in 12 of 72 captures of B and 28 of 72 of C, and none did with
 * 20 ms or more here. Only here: on a page at rest the same wait made that image likelier, not less
 * (webkit-desktop composer, C: 5 of 42 captures with it, 0 of 40 without).
 */
const COLLAPSE_RENDER_MS = 200;

/** One capture of the page as the gate compares it, with where its masks (and collapsed regions) were */
async function capture(page: Page, opts: GateOptions): Promise<Capture> {
  const fullPage = opts.fullPage ?? true;
  const collapsed = opts.collapse ?? [];
  const scale = await page.evaluate(() => devicePixelRatio);
  // With collapsed regions: the page as it is (its size, and where they were), then without them.
  // Measured before any screenshot: in phone emulation a full-page screenshot fires a resize, after
  // which the moodboard's board has been seen measuring a zero width (B and C alike), so a capture
  // taken first would report the board missing
  const sidecar = {} as Sidecar;
  if (collapsed.length) {
    const whole = await page.evaluate((fullPage) => {
      const el = document.documentElement;
      const w = fullPage ? Math.max(el.scrollWidth, innerWidth) : innerWidth;
      const h = fullPage ? Math.max(el.scrollHeight, innerHeight) : innerHeight;
      return { width: Math.round(w * devicePixelRatio), height: Math.round(h * devicePixelRatio) };
    }, fullPage);
    sidecar.full = { ...whole, collapsed: await measure(page, collapsed, false) };
    await collapse(page, collapsed);
    // Let the browser render the collapsed layout before the first screenshot (WebKit's dot tile)
    await page.waitForTimeout(COLLAPSE_RENDER_MS);
  }
  const shot = await stableShot(page, fullPage, opts.once);
  const png = PNG.sync.read(shot);
  sidecar.page = { width: png.width, height: png.height, scale, masks: await measure(page, opts.masks) };
  if (collapsed.length) await collapse(page, []);
  return { shot, sidecar };
}

interface Comparison {
  differing: number;
  compared: number;
  failure: string | null;
  images?: { expected: Png; actual: Png; diff?: Buffer };
}

/**
 * The collapsed regions a capture didn't find on the page. A collapsed region is left out of the
 * compare, so one that is missing (a moodboard whose board hasn't measured itself yet) would pass
 * unseen: the page must show every one before it is taken out.
 */
const missing = (c: Capture) => (c.sidecar.full?.collapsed ?? []).filter((r) => r.boxes.length === 0).map((r) => `${r.ed} ${r.what}`);

/** Two captures, compared with the union of their masks painted over both */
function compare(ref: Capture, act: Capture, ratio: number): Comparison {
  const e = PNG.sync.read(ref.shot);
  const a = PNG.sync.read(act.shot);
  const gone = [...missing(ref).map((m) => `reference: ${m}`), ...missing(act).map((m) => `candidate: ${m}`)];
  if (gone.length) return { differing: NaN, compared: 0, failure: `expected region not on the page (${gone.join("; ")})`, images: { expected: e, actual: a } };
  if (e.width !== a.width || e.height !== a.height) return { differing: NaN, compared: 0, failure: `size changed: ${size(e)} → ${size(a)}`, images: { expected: e, actual: a } };
  const rects = [...maskRects(ref.sidecar.page, e), ...maskRects(act.sidecar.page, a)];
  paint(a, rects);
  paint(e, rects);
  const res = compareImages(PNG.sync.write(a), PNG.sync.write(e), { threshold: THRESHOLD, maxDiffPixels: 0 });
  const total = a.width * a.height;
  let maskedPx = 0;
  for (let i = 0; i < a.data.length; i += 4) if (a.data[i] === 255 && a.data[i + 1] === 0 && a.data[i + 2] === 255 && a.data[i + 3] === 255) maskedPx++;
  const pixels = res ? Number(/(\d+) pixels/.exec(res.errorMessage)?.[1] ?? NaN) : 0;
  const differing = Number.isNaN(pixels) ? total : pixels;
  const allowed = Math.floor(ratio * total);
  return {
    differing,
    compared: total - maskedPx,
    failure: differing > allowed ? `${differing} differing pixels outside the expected differences${allowed ? ` (allowed ${allowed})` : ""}` : null,
    images: { expected: e, actual: a, diff: res?.diff },
  };
}

/** The record's sizes and masked areas, from the pair of captures the verdict rests on */
function describe(rec: GateRecord, ref: Capture, act: Capture) {
  rec.masked = {};
  for (const m of [...act.sidecar.page.masks, ...(act.sidecar.full?.collapsed ?? [])]) rec.masked[m.ed] = (rec.masked[m.ed] ?? 0) + Math.round(m.boxes.reduce((s, b) => s + b.w * b.h, 0));
  rec.sizes = { reference: size(ref.sidecar.page), actual: size(act.sidecar.page) };
  if (ref.sidecar.full) rec.sizes.referencePage = size(ref.sidecar.full);
  if (act.sidecar.full) rec.sizes.actualPage = size(act.sidecar.full);
}

/**
 * Fresh captures for the retry protocol (stills only): the same state reached again from its seed in
 * a new browser context, on the candidate build and, when its server is up (compare.mjs keeps it
 * running), on the reference build.
 */
export interface Again {
  candidate?: () => Promise<Page>;
  reference?: () => Promise<Page>;
}

/** Rounds of the retry protocol at most: each reaches the state again on the candidate, then on the reference */
const RETRY_ROUNDS = 2;

/**
 * Captures `name` and compares it with the reference build's capture outside the expected
 * differences. Returns the record; the caller asserts `ok` (so a frame loop can finish first).
 *
 * Retry protocol, for stills: a browser can rasterise the same page of the same build in two ways
 * from one load to the next. The two such quirks the gate runs have met (Chromium's 1×1 layout
 * during full-page screenshots, WebKit's dot tile right after the collapse) are held off at capture
 * (`hold`, COLLAPSE_RENDER_MS); this is the backstop for any other. When a still differs, the state is
 * reached again in a fresh context, on the candidate and then on the reference build, for up to
 * RETRY_ROUNDS rounds: up to three captures per build, the first ones included. Each new capture is
 * compared with every capture of the other build so far, and the gate passes only on an exact match
 * outside the expected differences (no pixel budget). A change in the candidate's code fails every
 * pair. Every capture and comparison is recorded, in order.
 */
export async function gate(page: Page, testInfo: TestInfo, name: string, opts: GateOptions = {}, again: Again = {}): Promise<GateRecord> {
  const ref = testInfo.snapshotPath(name);
  const side = ref.replace(/\.png$/, ".gate.json");
  const mine = await capture(page, opts);
  const { sidecar } = mine;

  const masked: Record<string, number> = {};
  for (const m of [...sidecar.page.masks, ...(sidecar.full?.collapsed ?? [])]) masked[m.ed] = (masked[m.ed] ?? 0) + Math.round(m.boxes.reduce((s, b) => s + b.w * b.h, 0));
  const rec: GateRecord = {
    name,
    project: testInfo.project.name,
    mode: opts.collapse?.length ? "collapsed" : "page",
    ok: true,
    differing: 0,
    compared: 0,
    masked,
    sizes: { reference: size(sidecar.page), actual: size(sidecar.page), ...(sidecar.full ? { referencePage: size(sidecar.full), actualPage: size(sidecar.full) } : {}) },
    failures: [],
  };

  if (isUpdate(testInfo) || !existsSync(ref) || !existsSync(side)) {
    mkdirSync(dirname(ref), { recursive: true });
    writeFileSync(ref, mine.shot);
    writeFileSync(side, JSON.stringify(sidecar, null, 2) + "\n");
    if (!isUpdate(testInfo)) rec.failures.push(`No reference for ${name}: written now`);
    // A reference without an expected region would excuse the candidate from showing it
    for (const m of missing(mine)) rec.failures.push(`expected region not on the page: ${m}`);
    rec.ok = rec.failures.length === 0;
    record(testInfo, rec);
    return rec;
  }

  const theirs: Capture = { shot: readFileSync(ref), sidecar: JSON.parse(readFileSync(side, "utf8")) as Sidecar };
  describe(rec, theirs, mine);
  const ratio = opts.maxDiffPixelRatio ?? 0;
  let result = compare(theirs, mine, ratio);

  if (result.failure && (again.candidate || again.reference)) {
    const retries = (rec.retries = [`first capture: ${result.failure}`]);
    // Reference capture 1 is the one the reference run wrote, candidate capture 1 this test's first
    const refs = [theirs];
    const cands = [mine];
    const pair = (r: number, c: number) => {
      const res = compare(refs[r], cands[c], ratio);
      retries.push(`reference capture ${r + 1} against candidate capture ${c + 1}: ${res.failure ?? "matches"}`);
      if (res.failure) return false;
      result = res;
      describe(rec, refs[r], cands[c]);
      return true;
    };
    for (let round = 0; result.failure && round < RETRY_ROUNDS; round++) {
      if (again.candidate) {
        cands.push(await capture(await again.candidate(), opts));
        retries.push(`candidate capture ${cands.length}: reached again`);
        if (refs.some((_, r) => pair(r, cands.length - 1))) break;
      }
      if (again.reference) {
        refs.push(await capture(await again.reference(), opts));
        retries.push(`reference capture ${refs.length}: reached again`);
        if (cands.some((_, c) => pair(refs.length - 1, c))) break;
      }
    }
  }

  rec.differing = result.differing;
  rec.compared = result.compared;
  if (result.failure) {
    rec.failures.push(result.failure);
    if (result.images) {
      attach(testInfo, name, "expected", result.images.expected);
      attach(testInfo, name, "actual", result.images.actual);
      if (result.images.diff) attach(testInfo, name, "diff", result.images.diff);
    }
  }
  rec.ok = rec.failures.length === 0;
  record(testInfo, rec);
  return rec;
}
