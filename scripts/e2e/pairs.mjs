#!/usr/bin/env node
// Before/after stills of two captured baselines, for review by eye (plan §10.8: "B vs R: reviewed
// by eye"). For every still in the "after" manifest it compares the two PNGs with Playwright's own
// comparator at the gate's tolerance (per-pixel threshold 0.01), and copies each differing pair,
// with the diff, into a gitignored folder:
//
//   <out>/<project>/<state>.before.png · .after.png · .diff.png
//   <out>/summary.json and <out>/README.md (every still: identical, or how many pixels differ)
//
//   node scripts/e2e/pairs.mjs --before R --after T
//   node scripts/e2e/pairs.mjs --before R --after T --before-dir <snapshots> --out e2e/.out/pairs-R-T
//   node scripts/e2e/pairs.mjs --before T --after B --frames     the motion frames too
//
// With --frames the clock-stepped motion frames are compared as well, at the same per-pixel
// threshold; a frame within the motion tolerance (0.1% of its pixels, e2e/frames.ts) is reported
// with its count but not copied.
//
// Each manifest's stills are read from its local copy (<localCopy>/snapshots), or from --before-dir
// and --after-dir. Their SHA-256 is checked against the manifest first.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const { getComparator } = require("playwright-core/lib/coreBundle").utils;

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? undefined : argv[i + 1];
};
const before = opt("before");
const after = opt("after");
if (!before || !after) {
  console.error("Usage: node scripts/e2e/pairs.mjs --before <label> --after <label> [--frames] [--before-dir <dir>] [--after-dir <dir>] [--out <dir>]");
  process.exit(1);
}
const FRAMES = argv.includes("--frames");
/** e2e/frames.ts FRAME_TOLERANCE: differing pixels a motion frame may have, as a share of its pixels */
const FRAME_TOLERANCE = 0.001;

const manifest = (label) => JSON.parse(readFileSync(join(REPO, "e2e/baselines", `${label}.json`), "utf8"));
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** The baseline's stills (and, with --frames, its motion frames) on disk, checked against its manifest. */
function stills(label, dir) {
  const m = manifest(label);
  const root = resolve(dir ?? join(REPO, m.localCopy, "snapshots"));
  const map = new Map();
  for (const s of [...m.stills, ...(FRAMES ? m.frames : [])]) {
    const file = join(root, s.path);
    if (!existsSync(file)) throw new Error(`${label}: ${s.path} is missing from ${root}`);
    if (sha(file) !== s.sha256) throw new Error(`${label}: ${s.path} in ${root} doesn't match the manifest`);
    map.set(s.path, { file, sha256: s.sha256, width: s.width, height: s.height });
  }
  return { manifest: m, root, map };
}

const a = stills(before, opt("before-dir"));
const b = stills(after, opt("after-dir"));
const out = resolve(opt("out") ?? join(REPO, "e2e/.out", `pairs-${before}-${after}`));
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const THRESHOLD = 0.01;
const compare = getComparator("image/png");
const rows = [];
for (const [path, s] of b.map) {
  const r = a.map.get(path);
  // "chromium-desktop/visual.spec.ts/board.png" → project, state; motion.spec.ts files are frames
  const [project, spec, name] = path.split("/");
  const state = name.replace(/\.png$/, "");
  const kind = spec.startsWith("motion") ? "frame" : "still";
  if (!r) {
    rows.push({ project, kind, state, result: `only in ${after}` });
    continue;
  }
  if (r.sha256 === s.sha256) {
    rows.push({ project, kind, state, result: "identical" });
    continue;
  }
  const res = compare(readFileSync(s.file), readFileSync(r.file), { threshold: THRESHOLD, maxDiffPixels: 0 });
  const pixels = res ? Number(/(\d+) pixels/.exec(res.errorMessage ?? "")?.[1] ?? NaN) : 0;
  const size = r.width !== s.width || r.height !== s.height ? `${r.width}×${r.height} → ${s.width}×${s.height}` : `${s.width}×${s.height}`;
  if (!res) {
    rows.push({ project, kind, state, result: "within tolerance", size });
    continue;
  }
  if (kind === "frame" && r.width === s.width && r.height === s.height && pixels / (s.width * s.height) <= FRAME_TOLERANCE) {
    rows.push({ project, kind, state, result: "within tolerance", pixels, size });
    continue;
  }
  const dir = kind === "frame" ? join(out, project, "frames") : join(out, project);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${state}.before.png`), readFileSync(r.file));
  writeFileSync(join(dir, `${state}.after.png`), readFileSync(s.file));
  if (res.diff) writeFileSync(join(dir, `${state}.diff.png`), res.diff);
  rows.push({ project, kind, state, result: "differs", pixels: Number.isNaN(pixels) ? null : pixels, size, note: Number.isNaN(pixels) ? res.errorMessage : undefined });
}
rows.sort((x, y) => x.project.localeCompare(y.project) || x.kind.localeCompare(y.kind) || x.state.localeCompare(y.state));

const count = (list) => Object.fromEntries(["differs", "identical", "within tolerance"].map((k) => [k, list.filter((r) => r.result === k).length]));
const summary = {
  before: { label: before, commit: a.manifest.commit, stills: a.root },
  after: { label: after, commit: b.manifest.commit, stills: b.root },
  threshold: THRESHOLD,
  ...(FRAMES ? { frameTolerance: FRAME_TOLERANCE } : {}),
  counts: count(rows.filter((r) => r.kind === "still")),
  ...(FRAMES ? { frameCounts: count(rows.filter((r) => r.kind === "frame")) } : {}),
  stills: rows,
};
writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n");

const md = [
  `# ${before} → ${after}: before and after ${FRAMES ? "stills and motion frames" : "stills"}`,
  "",
  `${before} \`${a.manifest.commit.slice(0, 9)}\`, ${after} \`${b.manifest.commit.slice(0, 9)}\`. Per-pixel threshold ${THRESHOLD}, as the gate${FRAMES ? `; frames within ${FRAME_TOLERANCE * 100}% of their pixels are within tolerance` : ""}. Pairs: \`<project>/<state>.before.png\`, \`.after.png\`, \`.diff.png\`${FRAMES ? " (frames under `<project>/frames/`)" : ""}.`,
  "",
  "| Project | Kind | State | Result | Differing pixels | Size |",
  "|---|---|---|---|---:|---|",
  ...rows.map((r) => `| ${r.project} | ${r.kind} | ${r.state} | ${r.result} | ${r.pixels ?? ""} | ${r.size ?? ""} |`),
  "",
];
writeFileSync(join(out, "README.md"), md.join("\n"));
console.log(`${summary.stills.filter((r) => r.kind === "still").length} stills: ${JSON.stringify(summary.counts)}`);
if (FRAMES) console.log(`${rows.filter((r) => r.kind === "frame").length} frames: ${JSON.stringify(summary.frameCounts)}`);
console.log(`Pairs: ${relative(REPO, out)}`);
