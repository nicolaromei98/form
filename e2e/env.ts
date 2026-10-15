// Where the app under test is served and where the run writes, shared by the config and the specs.
// scripts/e2e/compare.mjs sets these for each build it serves; a plain `npm run e2e` uses the defaults.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export const REPO = resolve(__dirname, "..");

/** Never 3417: that port belongs to the developer's `next dev`. */
export const PORT = Number(process.env.E2E_PORT ?? 3500);
if (PORT === 3417) throw new Error("Port 3417 is the dev server's; serve the build under test on 3500 or 3501.");

export const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

/**
 * The route that renders the app: "/" up to the route move (plan step 3), "/demo" after it.
 * compare.mjs reads it from each served commit; otherwise this checkout decides.
 */
export const APP_PATH = process.env.E2E_APP_PATH ?? (existsSync(join(REPO, "src/app/demo/page.tsx")) ? "/demo" : "/");

/**
 * The engine of the build under test: "v0" up to baseline B, "v2" from the switchover (plan step
 * 18). compare.mjs reads it from each served commit; otherwise this checkout decides. The expected
 * differences (e2e/expected-diffs.md) assert their v2 values only on a v2 build.
 */
export const ENGINE: "v0" | "v2" = (process.env.E2E_ENGINE as "v0" | "v2" | undefined) ?? (existsSync(join(REPO, "src/lib/store/engine.ts")) ? "v2" : "v0");
if (ENGINE !== "v0" && ENGINE !== "v2") throw new Error(`E2E_ENGINE is "v0" or "v2", not "${process.env.E2E_ENGINE}"`);

/** Everything a run writes (snapshots aside): reports, test results, measurements, videos. Gitignored. */
export const OUT_DIR = resolve(process.env.E2E_OUT_DIR ?? join(REPO, "e2e/.out/local"));

/** Reference screenshots: written with --update-snapshots, compared against otherwise. */
export const SNAPSHOT_DIR = resolve(process.env.E2E_SNAPSHOT_DIR ?? join(OUT_DIR, "snapshots"));

/** Measurements and videos the specs keep (agent-idle.json, flow videos), next to the snapshots. */
export const ARTIFACTS_DIR = resolve(process.env.E2E_ARTIFACTS_DIR ?? join(OUT_DIR, "artifacts"));

/**
 * Per-pixel colour tolerance (pixelmatch YIQ, 0–1). Two runs of the same build differ by one or two
 * RGB levels on a few pixels at the rounded edges of blurred glass (raster noise); 0.01 lets up to
 * two grey levels through and fails from three. Playwright's default, 0.2, would hide a whole
 * contrast-token change (the Q14 text alphas move text by about ten levels).
 */
export const THRESHOLD = Number(process.env.E2E_THRESHOLD ?? 0.01);
