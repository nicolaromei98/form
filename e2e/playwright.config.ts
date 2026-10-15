// Playwright for the /demo visual, motion and flow baselines (plan §10.8).
//
//   npm run e2e            this checkout: builds it and serves it on 3500 (or reuses a server there)
//   npm run e2e:compare    two commits built in worktrees and served on 3500 and 3501 (scripts/e2e/compare.mjs)
//
// Stills run in Chromium and WebKit at 1440×900 and on the iPhone 13 preset; frame stepping, the
// idle probe and the CDP measurements need Chromium; the v0 §15 videos are recorded in both engines;
// axe runs in Chromium at 1440×900, as the Phase 0 audit did.
import { defineConfig, devices, type Project } from "@playwright/test";
import { join } from "node:path";
import { BASE_URL, OUT_DIR, PORT, REPO, SNAPSHOT_DIR, THRESHOLD } from "./env";

const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
/** The iPhone 13 preset (touch, DSF 3) at the plan's 390×844; the preset's own viewport leaves out the browser chrome. */
const PHONE = { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } };

const CHROMIUM_ONLY = /(motion|agent-idle|a11y|perf)\.spec\.ts$/;

const projects: Project[] = [
  { name: "chromium-desktop", use: { ...devices["Desktop Chrome"], ...DESKTOP } },
  { name: "webkit-desktop", use: { ...devices["Desktop Safari"], ...DESKTOP }, testIgnore: CHROMIUM_ONLY },
  { name: "chromium-phone", use: { ...PHONE, browserName: "chromium" }, testMatch: /visual\.spec\.ts$/ },
  { name: "webkit-phone", use: { ...PHONE, browserName: "webkit" }, testMatch: /visual\.spec\.ts$/ },
];

export default defineConfig({
  testDir: ".",
  testMatch: /\.spec\.ts$/,
  outputDir: join(OUT_DIR, "test-results"),
  snapshotPathTemplate: `${SNAPSHOT_DIR}/{projectName}/{testFileName}/{arg}{ext}`,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // A baseline must not hide a flaky state behind a retry
  retries: 0,
  workers: process.env.CI ? 3 : 4,
  timeout: 300_000,
  reporter: [["list"], ["html", { outputFolder: join(OUT_DIR, "report"), open: "never" }], ["json", { outputFile: join(OUT_DIR, "results.json") }]],
  expect: {
    timeout: 60_000,
    toHaveScreenshot: { maxDiffPixels: 0, threshold: THRESHOLD, animations: "disabled", caret: "hide", scale: "device" },
  },
  use: {
    baseURL: BASE_URL,
    locale: "en-US",
    timezoneId: "Europe/Rome",
    colorScheme: "light",
    trace: "retain-on-failure",
    video: "off",
  },
  projects,
  // Without E2E_BASE_URL, serve this checkout's production build (never the dev server on 3417)
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run build && npx next start -p ${PORT}`,
        cwd: REPO,
        url: `${BASE_URL}/`,
        reuseExistingServer: !process.env.CI,
        timeout: 600_000,
        env: { NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_FORM_E2E: "1" },
      },
});
