import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

// Test projects (plan §10.1). `npm test` runs unit, unit-dom and golden; the property and perf
// suites run on their own (`npm run test:property`, `npm run test:perf`) and in CI.

const SRC = fileURLToPath(new URL("./src/", import.meta.url));

// fast-check globals: FC_SEED replays a run, FC_RUNS scales it (default 500).
const FAST_CHECK = ["test/setup/fast-check.ts"];

// Unit tests that need a DOM or browser storage: the store and its persistence, and components.
const DOM_TESTS = ["src/lib/store/**/__tests__/**/*.test.ts", "src/components/**/__tests__/**/*.test.{ts,tsx}"];

export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: SRC }],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
          exclude: [...configDefaults.exclude, ...DOM_TESTS],
          environment: "node",
          setupFiles: FAST_CHECK,
        },
      },
      {
        extends: true,
        test: {
          name: "unit-dom",
          include: DOM_TESTS,
          environment: "happy-dom",
          setupFiles: FAST_CHECK,
        },
      },
      {
        extends: true,
        test: {
          name: "property",
          include: ["test/property/**/*.test.ts"],
          environment: "node",
          setupFiles: FAST_CHECK,
          testTimeout: 15 * 60_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: "golden",
          include: ["test/golden/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "perf",
          include: ["test/perf/**/*.test.ts"],
          environment: "node",
          // One worker at a time, so timings never compete with another test file
          pool: "forks",
          fileParallelism: false,
          retry: 1,
          testTimeout: 120_000,
        },
      },
    ],
  },
});
