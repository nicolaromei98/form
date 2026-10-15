#!/usr/bin/env node
// First-load JS of /demo in two commits (plan §11 step 19, §12 item 17): the scripts the
// prerendered page references, as the AUDIT measured them (§11.3 "Bundle"): raw bytes, gzip at
// zlib level 6 (what `next start` serves) and brotli at quality 11. The `nomodule` polyfill is left
// out, because modern browsers don't load it. CSS is reported on its own line.
//
//   node scripts/e2e/bundle.mjs                               base = the gate's baseline (B), head = HEAD
//   node scripts/e2e/bundle.mjs --base <ref> --head <ref>
//   node scripts/e2e/bundle.mjs --base-dir <checkout> --head-dir <checkout>   already built
//
// Builds are production builds without NEXT_PUBLIC_FORM_E2E (the e2e store handle stays out), each
// in a git worktree under --workdir (default the system temp dir), removed afterwards unless --keep.
// Writes the measurement to --out (default e2e/.out/bundle.json).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? undefined : argv[i + 1];
};
const keep = argv.includes("--keep");

const git = (...args) => {
  const r = spawnSync("git", args, { cwd: REPO, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.trim()}`);
  return r.stdout.trim();
};

function gateRef() {
  const gate = JSON.parse(readFileSync(join(REPO, "e2e/baselines/gate.json"), "utf8"));
  return JSON.parse(readFileSync(join(REPO, "e2e/baselines", `${gate.base}.json`), "utf8")).commit;
}

const made = [];

/** A production build of `ref` in its own worktree (no e2e handle) */
function build(ref, workdir) {
  const commit = git("rev-parse", "--verify", `${ref}^{commit}`);
  const dir = join(workdir, `bundle-${commit.slice(0, 9)}`);
  if (existsSync(join(dir, ".bundle-built")) && readFileSync(join(dir, ".bundle-built"), "utf8") === commit) return { dir, commit };
  if (existsSync(dir)) {
    spawnSync("git", ["worktree", "remove", "--force", dir], { cwd: REPO });
    rmSync(dir, { recursive: true, force: true });
  }
  mkdirSync(workdir, { recursive: true });
  git("worktree", "prune");
  git("worktree", "add", "--detach", dir, commit);
  made.push(dir);
  const lock = (root) => readFileSync(join(root, "package-lock.json"), "utf8");
  if (lock(dir) === lock(REPO) && spawnSync("cp", ["-cR", join(REPO, "node_modules"), join(dir, "node_modules")]).status === 0) {
    // cloned (APFS copy-on-write)
  } else if (spawnSync("npm", ["ci", "--no-audit", "--no-fund"], { cwd: dir, stdio: "inherit" }).status !== 0) throw new Error(`npm ci failed in ${dir}`);
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
  delete env.NEXT_PUBLIC_FORM_E2E;
  console.log(`· ${commit.slice(0, 9)}: next build`);
  const r = spawnSync(join(dir, "node_modules/.bin/next"), ["build"], { cwd: dir, env, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`next build failed for ${commit}:\n${(r.stdout + r.stderr).slice(-4000)}`);
  writeFileSync(join(dir, ".bundle-built"), commit);
  return { dir, commit };
}

/** The first-load scripts and stylesheets of /demo in a built checkout */
function measure(dir) {
  const html = readFileSync(join(dir, ".next/server/app/demo.html"), "utf8");
  const scripts = [...html.matchAll(/<script\b([^>]*)>/g)]
    .map((m) => m[1])
    .filter((attrs) => !/\bnomodule\b/i.test(attrs))
    .map((attrs) => /\bsrc="([^"]+)"/.exec(attrs)?.[1])
    .filter((src) => src?.startsWith("/_next/static/"));
  const styles = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map((m) => /\bhref="([^"]+)"/.exec(m[0])?.[1]).filter((h) => h?.startsWith("/_next/static/"));
  const size = (src) => {
    const bytes = readFileSync(join(dir, ".next", src.replace(/^\/_next\//, "").split("?")[0]));
    return {
      file: src.split("/").pop(),
      raw: bytes.length,
      gzip: gzipSync(bytes, { level: 6 }).length,
      brotli: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length } }).length,
    };
  };
  const js = [...new Set(scripts)].map(size).sort((a, b) => b.raw - a.raw);
  const css = [...new Set(styles)].map(size);
  const sum = (list) => list.reduce((t, c) => ({ raw: t.raw + c.raw, gzip: t.gzip + c.gzip, brotli: t.brotli + c.brotli }), { raw: 0, gzip: 0, brotli: 0 });
  return { js, css, total: sum(js), cssTotal: sum(css) };
}

function main() {
  const workdir = resolve(opt("workdir") ?? join(tmpdir(), "form-bundle"));
  const base = opt("base-dir") ? { dir: resolve(opt("base-dir")), commit: "(dir)" } : build(opt("base") ?? gateRef(), workdir);
  const head = opt("head-dir") ? { dir: resolve(opt("head-dir")), commit: "(dir)" } : build(opt("head") ?? "HEAD", workdir);
  const b = measure(base.dir);
  const h = measure(head.dir);
  const kb = (n) => (n / 1000).toFixed(1);
  const delta = (k) => h.total[k] - b.total[k];
  const result = {
    measuredAt: new Date().toISOString(),
    route: "/demo",
    method: "scripts referenced by .next/server/app/demo.html (nomodule excluded); gzip level 6 as next start serves; brotli quality 11",
    base: { commit: base.commit, ...b },
    head: { commit: head.commit, ...h },
    delta: { raw: delta("raw"), gzip: delta("gzip"), brotli: delta("brotli"), gzipPercent: Math.round((delta("gzip") / b.total.gzip) * 1000) / 10 },
  };
  const out = resolve(opt("out") ?? join(REPO, "e2e/.out/bundle.json"));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
  const row = (label, t) => `${label.padEnd(6)} ${kb(t.raw).padStart(9)} KB raw ${kb(t.gzip).padStart(8)} KB gzip ${kb(t.brotli).padStart(8)} KB brotli`;
  console.log(`First-load JS of /demo (${b.js.length} → ${h.js.length} scripts)`);
  console.log(row(`base`, b.total) + `  ${base.commit.slice(0, 9)}`);
  console.log(row(`head`, h.total) + `  ${head.commit.slice(0, 9)}`);
  console.log(`delta  ${kb(result.delta.raw).padStart(9)} KB raw ${kb(result.delta.gzip).padStart(8)} KB gzip ${kb(result.delta.brotli).padStart(8)} KB brotli (${result.delta.gzipPercent}% gzip)`);
  console.log(`CSS    ${kb(b.cssTotal.gzip)} → ${kb(h.cssTotal.gzip)} KB gzip`);
  console.log(`Written: ${relative(REPO, out)}`);
}

try {
  main();
} finally {
  if (!keep)
    for (const dir of made) {
      spawnSync("git", ["worktree", "remove", "--force", dir], { cwd: REPO });
      rmSync(dir, { recursive: true, force: true });
    }
  spawnSync("git", ["worktree", "prune"], { cwd: REPO });
}
