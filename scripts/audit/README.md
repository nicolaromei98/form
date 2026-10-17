# Phase 0 audit harnesses

The scripts, fixtures and raw results behind `docs/AUDIT.md`, moved here from `docs/audit/harness/` in Phase 1 step 1. They are evidence, kept for reproducibility, and are not part of the build or of CI.

| Folder | What it holds |
|---|---|
| `domain/` | jiti probes of the v0 reducer: purity, invariants, schema limits, persistence. `results.json` is the recorded run. |
| `agent/` | Probes of the interpretation pipeline: a parser battery, a mocked SDK, and the JSON Schema sent to Claude (`schema.raw.json` is the Zod output, `schema.sent.json` the payload after the SDK transform) with its parameter counts. |
| `diagnosis/` | Checks of the v1 §2 points: the working-day schedule, scale benchmarks, contrast maths. |
| `perf/` | `tools/`: the headless-Chrome harness (puppeteer-core + CDP, axe-core). `scripts/`: document generators and analysers. `fixtures/`: the demo, 60-task and 150-task documents (copied to `test/fixtures/v0/`). `results/`: the recorded measurements. |
| `a11y/` | Contrast calculator and font name-table reader, with their output. `q14.mjs` is the exception to "evidence only": the Q14 check (plan §9.2), which reads the live tokens from `src/app/globals.css` and the dimmed surfaces from the components, and fails when a text pair drops below 4.5:1 or a meaningful stroke or red graphic below 3:1. `src/app/__tests__/contrast.test.ts` runs it in `npm test`. |

## Running

Every path is resolved from `paths.mjs`, so the probes run from any checkout. Run them from the repo root, for example:

```sh
node scripts/audit/domain/verify4.mjs
node scripts/audit/agent/probe.mjs sanitize
node scripts/audit/perf/scripts/derived-bench.mjs              # this checkout, doc60
node scripts/audit/perf/scripts/gen-doc.mjs ../form-b201af8     # another checkout (a git worktree)
```

- The probes load the v0 modules with jiti (a dev dependency). Phase 1 step 18 deleted them from `src/lib/`, with the v0 store and `@anthropic-ai/sdk`; `LIB` in `paths.mjs` now points at the frozen copies of the pure modules in `test/legacy/v0/lib/` (commit `b201af8`), so the probes that use only those still run here. The perf generators and benches take another checkout as their first argument and load its `src/lib/`. The probes that load the store, the Claude module or the SDK (`domain/verify.mjs`, `domain/verify2.mjs`, `agent/probe.mjs`, `agent/schema.mjs`, `agent/mock-sdk.mjs`, `diagnosis/schema.mjs`) run only on a checkout of a commit before step 18.
- Re-runs that are not deterministic (ids, timings, browser measurements) write to `scripts/audit/.out/` (gitignored), never over the recorded results. `agent/schema.mjs` and `diagnosis/schema.mjs` regenerate their committed JSON in place; the output is byte-identical at `b201af8`.
- The perf harness needs `npm install` inside `perf/tools/` (puppeteer-core, axe-core) and Google Chrome at the standard macOS path, or `CHROME_PATH`. It drives a production build served on port 3499.
