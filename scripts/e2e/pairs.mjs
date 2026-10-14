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
  console.error("Usage: node scripts/e2e/pairs.mjs --before <label> --after <label> [--before-dir <dir>] [--after-dir <dir>] [--out <dir>]");
  process.exit(1);
}

const manifest = (label) => JSON.parse(readFileSync(join(REPO, "e2e/baselines", `${label}.json`), "utf8"));
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** The baseline's stills on disk, checked against its manifest. */
function stills(label, dir) {
  const m = manifest(label);
  const root = resolve(dir ?? join(REPO, m.localCopy, "snapshots"));
  const map = new Map();
  for (const s of m.stills) {
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
  // "chromium-desktop/visual.spec.ts/board.png" → project, state
  const [project, , name] = path.split("/");
  const state = name.replace(/\.png$/, "");
  if (!r) {
    rows.push({ project, state, result: `only in ${after}` });
    continue;
  }
  if (r.sha256 === s.sha256) {
    rows.push({ project, state, result: "identical" });
    continue;
  }
  const res = compare(readFileSync(s.file), readFileSync(r.file), { threshold: THRESHOLD, maxDiffPixels: 0 });
  const pixels = res ? Number(/(\d+) pixels/.exec(res.errorMessage ?? "")?.[1] ?? NaN) : 0;
  const size = r.width !== s.width || r.height !== s.height ? `${r.width}×${r.height} → ${s.width}×${s.height}` : `${s.width}×${s.height}`;
  if (!res) {
    rows.push({ project, state, result: "within tolerance", size });
    continue;
  }
  const dir = join(out, project);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${state}.before.png`), readFileSync(r.file));
  writeFileSync(join(dir, `${state}.after.png`), readFileSync(s.file));
  if (res.diff) writeFileSync(join(dir, `${state}.diff.png`), res.diff);
  rows.push({ project, state, result: "differs", pixels: Number.isNaN(pixels) ? null : pixels, size, note: Number.isNaN(pixels) ? res.errorMessage : undefined });
}
rows.sort((x, y) => x.project.localeCompare(y.project) || x.state.localeCompare(y.state));

const summary = {
  before: { label: before, commit: a.manifest.commit, stills: a.root },
  after: { label: after, commit: b.manifest.commit, stills: b.root },
  threshold: THRESHOLD,
  counts: Object.fromEntries(["differs", "identical", "within tolerance"].map((k) => [k, rows.filter((r) => r.result === k).length])),
  stills: rows,
};
writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n");

const md = [
  `# ${before} → ${after}: before and after stills`,
  "",
  `${before} \`${a.manifest.commit.slice(0, 9)}\`, ${after} \`${b.manifest.commit.slice(0, 9)}\`. Per-pixel threshold ${THRESHOLD}, as the gate. Pairs: \`<project>/<state>.before.png\`, \`.after.png\`, \`.diff.png\`.`,
  "",
  "| Project | State | Result | Differing pixels | Size |",
  "|---|---|---|---:|---|",
  ...rows.map((r) => `| ${r.project} | ${r.state} | ${r.result} | ${r.pixels ?? ""} | ${r.size ?? ""} |`),
  "",
];
writeFileSync(join(out, "README.md"), md.join("\n"));
console.log(`${rows.length} stills: ${JSON.stringify(summary.counts)}\nPairs: ${relative(REPO, out)}`);
