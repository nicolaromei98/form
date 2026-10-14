#!/usr/bin/env node
// Builds two commits in temporary git worktrees, serves them with `next start` on 3500 and 3501,
// and runs this checkout's Playwright specs against both (plan §10.8): the base run writes the
// reference screenshots, the head run is compared with them. With --capture, one commit is built
// and captured as a named baseline, and its manifest is written to e2e/baselines/<label>.json.
//
//   node scripts/e2e/compare.mjs                          base from e2e/baselines/gate.json, head HEAD
//   node scripts/e2e/compare.mjs --base <ref> --head <ref>
//   node scripts/e2e/compare.mjs --capture <ref> --label A
//   … -- <playwright args>                                e.g. -- visual.spec.ts --project chromium-desktop
//
// Options: --out <dir> (default e2e/.out/<run>), --workdir <dir> (worktrees; default the system
// temp dir), --keep (keep the worktrees and their builds for the next run).
// Never touches port 3417 (the dev server) and never stops a process it didn't start.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PORTS = { base: 3500, head: 3501 };
const BASELINES = join(REPO, "e2e/baselines");

/* ------------------------------------------------------------------ */
/* Arguments                                                           */
/* ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const dash = argv.indexOf("--");
const own = dash < 0 ? argv : argv.slice(0, dash);
const passthrough = dash < 0 ? [] : argv.slice(dash + 1);
const opt = (name) => {
  const i = own.indexOf(`--${name}`);
  return i < 0 ? undefined : own[i + 1];
};
const flag = (name) => own.includes(`--${name}`);

const git = (...args) => {
  const r = spawnSync("git", args, { cwd: REPO, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.trim()}`);
  return r.stdout.trim();
};
const sha = (ref) => git("rev-parse", "--verify", `${ref}^{commit}`);
const short = (s) => s.slice(0, 9);

/** The gate's reference: e2e/baselines/gate.json names a baseline, whose manifest holds the commit. */
function gateBase() {
  const gate = JSON.parse(readFileSync(join(BASELINES, "gate.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(join(BASELINES, `${gate.base}.json`), "utf8"));
  return { ref: manifest.commit, label: gate.base };
}

/* ------------------------------------------------------------------ */
/* Worktrees, builds, servers                                          */
/* ------------------------------------------------------------------ */

const children = new Set();
const worktrees = new Set();
const keep = flag("keep");

function run(cmd, args, { cwd, env, log }) {
  return new Promise((done, fail) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: log ? ["ignore", "pipe", "pipe"] : "inherit" });
    if (log) {
      child.stdout.on("data", (d) => log.push(String(d)));
      child.stderr.on("data", (d) => log.push(String(d)));
    }
    child.on("error", fail);
    child.on("exit", (code) => (code === 0 ? done() : fail(new Error(`${cmd} ${args.join(" ")} exited with ${code}${log ? "\n" + log.join("").slice(-4000) : ""}`))));
  });
}

/** A detached worktree of `commit` with its dependencies installed and a production build. */
async function prepare(commit, workdir) {
  const dir = join(workdir, short(commit));
  const marker = join(dir, ".e2e-built");
  if (existsSync(marker) && readFileSync(marker, "utf8") === commit) {
    console.log(`· ${short(commit)}: reusing the build in ${dir}`);
    worktrees.add(dir);
    return dir;
  }
  if (existsSync(dir)) {
    spawnSync("git", ["worktree", "remove", "--force", dir], { cwd: REPO });
    rmSync(dir, { recursive: true, force: true });
  }
  mkdirSync(workdir, { recursive: true });
  // A worktree removed by hand stays registered until pruned, and then can't be added again
  git("worktree", "prune");
  git("worktree", "add", "--detach", dir, commit);
  worktrees.add(dir);

  // Same lockfile: clone this checkout's node_modules (APFS copy-on-write, so instant on macOS);
  // a real copy, since Turbopack rejects a symlinked node_modules. Otherwise install from the lockfile.
  const lock = (root) => readFileSync(join(root, "package-lock.json"), "utf8");
  const log = [];
  if (existsSync(join(REPO, "node_modules")) && lock(dir) === lock(REPO)) {
    console.log(`· ${short(commit)}: copying node_modules`);
    const cloned = spawnSync("cp", ["-cR", join(REPO, "node_modules"), join(dir, "node_modules")]);
    if (cloned.status !== 0) await run("cp", ["-R", join(REPO, "node_modules"), join(dir, "node_modules")], { cwd: dir, log });
  } else {
    console.log(`· ${short(commit)}: npm ci (its lockfile differs from this checkout's)`);
    await run("npm", ["ci", "--no-audit", "--no-fund"], { cwd: dir, log });
  }
  console.log(`· ${short(commit)}: next build`);
  await run(join(dir, "node_modules/.bin/next"), ["build"], { cwd: dir, env: { NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_FORM_E2E: "1" }, log });
  writeFileSync(marker, commit);
  return dir;
}

function portFree(port) {
  return new Promise((done) => {
    const probe = net.createServer().once("error", () => done(false));
    probe.once("listening", () => probe.close(() => done(true)));
    probe.listen(port);
  });
}

async function serve(dir, port, logFile) {
  if (port === 3417) throw new Error("3417 is the dev server's port");
  if (!(await portFree(port))) throw new Error(`Port ${port} is in use: stop whatever serves it, or it would be tested instead of ${dir}`);
  const out = [];
  mkdirSync(dirname(logFile), { recursive: true });
  const child = spawn(join(dir, "node_modules/.bin/next"), ["start", "-p", String(port)], { cwd: dir, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  children.add(child);
  child.stdout.on("data", (d) => out.push(String(d)));
  child.stderr.on("data", (d) => out.push(String(d)));
  child.on("exit", () => {
    children.delete(child);
    writeFileSync(logFile, out.join(""));
  });
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://localhost:${port}/`, { redirect: "manual" });
      if (r.status < 500) return child;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`next start on ${port} never answered`);
}

async function cleanup() {
  for (const child of children) {
    child.kill("SIGTERM");
    await new Promise((r) => {
      const t = setTimeout(() => {
        child.kill("SIGKILL");
        r();
      }, 5000);
      child.once("exit", () => {
        clearTimeout(t);
        r();
      });
    });
  }
  if (keep) return;
  for (const dir of worktrees) {
    spawnSync("git", ["worktree", "remove", "--force", dir], { cwd: REPO });
    rmSync(dir, { recursive: true, force: true });
  }
  spawnSync("git", ["worktree", "prune"], { cwd: REPO });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await cleanup();
    process.exit(130);
  });
}

/* ------------------------------------------------------------------ */
/* Playwright                                                          */
/* ------------------------------------------------------------------ */

/** The route that renders the app in `commit`: "/demo" from the route move (plan step 3) on. */
const appPath = (commit) => (spawnSync("git", ["cat-file", "-e", `${commit}:src/app/demo/page.tsx`], { cwd: REPO }).status === 0 ? "/demo" : "/");

/** Runs this checkout's specs against one served build. Resolves to Playwright's exit code. */
function playwright({ port, commit, out, snapshots, update }) {
  const args = ["playwright", "test", "--config", "e2e/playwright.config.ts", ...(update ? ["--update-snapshots=all"] : []), ...passthrough];
  const env = {
    E2E_BASE_URL: `http://localhost:${port}`,
    E2E_APP_PATH: appPath(commit),
    E2E_OUT_DIR: out,
    E2E_SNAPSHOT_DIR: snapshots,
    E2E_ARTIFACTS_DIR: join(out, "artifacts"),
  };
  console.log(`· playwright → ${env.E2E_BASE_URL}${env.E2E_APP_PATH} (${short(commit)}${update ? ", writing references" : ", comparing"})`);
  return new Promise((done) => {
    const child = spawn("npx", args, { cwd: REPO, env: { ...process.env, ...env }, stdio: "inherit" });
    children.add(child);
    child.on("exit", (code) => {
      children.delete(child);
      done(code ?? 1);
    });
  });
}

/** Pass, fail and skip counts from the JSON report. */
function stats(out) {
  try {
    const s = JSON.parse(readFileSync(join(out, "results.json"), "utf8")).stats;
    return { passed: s.expected, failed: s.unexpected, flaky: s.flaky, skipped: s.skipped, ms: Math.round(s.duration) };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Baseline manifest                                                   */
/* ------------------------------------------------------------------ */

function files(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name), base) : [relative(base, join(dir, e.name))])).sort();
}

const digest = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** Width and height from a PNG header. */
function pngSize(file) {
  const b = readFileSync(file);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function environment() {
  const browsers = JSON.parse(readFileSync(join(REPO, "node_modules/playwright-core/browsers.json"), "utf8")).browsers;
  const version = (name) => browsers.find((b) => b.name === name)?.browserVersion;
  const pw = JSON.parse(readFileSync(join(REPO, "node_modules/@playwright/test/package.json"), "utf8")).version;
  const os = spawnSync("uname", ["-srm"], { encoding: "utf8" }).stdout.trim();
  const mac = spawnSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).stdout?.trim();
  return { os: mac ? `macOS ${mac} (${os})` : os, node: process.version, playwright: pw, chromium: version("chromium"), webkit: version("webkit") };
}

function writeManifest({ label, commit, ref, out, snapshots, result }) {
  const stills = files(snapshots).filter((f) => f.endsWith(".png"));
  const artifacts = join(out, "artifacts");
  const entry = (root, f) => ({ path: f, bytes: statSync(join(root, f)).size, sha256: digest(join(root, f)), ...(f.endsWith(".png") ? pngSize(join(root, f)) : {}) });
  const idle = existsSync(join(artifacts, "agent-idle.json")) ? JSON.parse(readFileSync(join(artifacts, "agent-idle.json"), "utf8")) : null;
  const manifest = {
    label,
    ref,
    commit,
    appPath: appPath(commit),
    capturedAt: new Date().toISOString(),
    command: `node scripts/e2e/compare.mjs --capture ${ref} --label ${label}${passthrough.length ? " -- " + passthrough.join(" ") : ""}`,
    environment: environment(),
    result,
    regenerate: `git tag phase1-baseline-${label.toLowerCase()} ${short(commit)} (local), then the command above; same machine, same browsers for identical bytes`,
    localCopy: relative(REPO, out),
    stills: stills.filter((f) => !f.includes("/motion.spec.ts/")).map((f) => entry(snapshots, f)),
    frames: stills.filter((f) => f.includes("/motion.spec.ts/")).map((f) => entry(snapshots, f)),
    videos: files(join(artifacts, "videos")).map((f) => entry(join(artifacts, "videos"), f)),
    agentIdle: idle,
  };
  mkdirSync(BASELINES, { recursive: true });
  const file = join(BASELINES, `${label}.json`);
  writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
  const mb = (list) => (list.reduce((s, e) => s + e.bytes, 0) / 1048576).toFixed(1);
  console.log(`\nBaseline ${label}: ${manifest.stills.length} stills (${mb(manifest.stills)} MB), ${manifest.frames.length} frames (${mb(manifest.frames)} MB), ${manifest.videos.length} videos (${mb(manifest.videos)} MB)`);
  console.log(`Manifest: ${relative(REPO, file)}\nFiles:    ${relative(REPO, out)}`);
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const workdir = resolve(opt("workdir") ?? join(tmpdir(), "form-e2e"));
  const capture = opt("capture");

  if (capture) {
    const label = opt("label");
    if (!label) throw new Error("--capture needs --label (A, R, B…)");
    const commit = sha(capture);
    const out = resolve(opt("out") ?? join(REPO, "e2e/.out", `baseline-${label}`));
    rmSync(out, { recursive: true, force: true });
    const snapshots = join(out, "snapshots");
    const dir = await prepare(commit, workdir);
    await serve(dir, PORTS.base, join(out, "server.log"));
    const code = await playwright({ port: PORTS.base, commit, out, snapshots, update: true });
    writeManifest({ label, commit, ref: capture, out, snapshots, result: { exitCode: code, ...stats(out) } });
    return code;
  }

  const gate = opt("base") ? { ref: opt("base"), label: null } : gateBase();
  const base = sha(gate.ref);
  const head = sha(opt("head") ?? "HEAD");
  const out = resolve(opt("out") ?? join(REPO, "e2e/.out", `compare-${short(base)}-${short(head)}`));
  rmSync(out, { recursive: true, force: true });
  const snapshots = join(out, "snapshots");
  console.log(`Comparing ${short(head)} (head) with ${short(base)} (base${gate.label ? `, baseline ${gate.label}` : ""})`);

  const [baseDir, headDir] = [await prepare(base, workdir), await prepare(head, workdir)];
  await serve(baseDir, PORTS.base, join(out, "base-server.log"));
  await serve(headDir, PORTS.head, join(out, "head-server.log"));

  const baseCode = await playwright({ port: PORTS.base, commit: base, out: join(out, "base"), snapshots, update: true });
  const headCode = await playwright({ port: PORTS.head, commit: head, out: join(out, "head"), snapshots, update: false });
  const summary = { base: { commit: base, exitCode: baseCode, ...stats(join(out, "base")) }, head: { commit: head, exitCode: headCode, ...stats(join(out, "head")) } };
  writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(`\nBase ${short(base)}: ${JSON.stringify(summary.base)}\nHead ${short(head)}: ${JSON.stringify(summary.head)}`);
  console.log(`Reports: ${relative(REPO, join(out, "head/report"))} (head), ${relative(REPO, join(out, "base/report"))} (base)`);
  return baseCode || headCode;
}

main()
  .then(async (code) => {
    await cleanup();
    process.exit(code);
  })
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await cleanup();
    process.exit(1);
  });
