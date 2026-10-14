# Phase 0 audit harnesses

The scripts, fixtures and raw results behind `docs/AUDIT.md`, moved here from `docs/audit/harness/` in Phase 1 step 1. They are evidence, kept for reproducibility, and are not part of the build or of CI.

| Folder | What it holds |
|---|---|
| `domain/` | jiti probes of the v0 reducer: purity, invariants, schema limits, persistence. `results.json` is the recorded run. |
| `agent/` | Probes of the interpretation pipeline: a parser battery, a mocked SDK, and the JSON Schema sent to Claude (`schema.raw.json` is the Zod output, `schema.sent.json` the payload after the SDK transform) with its parameter counts. |
| `diagnosis/` | Checks of the v1 §2 points: the working-day schedule, scale benchmarks, contrast maths. |
| `perf/` | `tools/`: the headless-Chrome harness (puppeteer-core + CDP, axe-core). `scripts/`: document generators and analysers. `fixtures/`: the demo, 60-task and 150-task documents (copied to `test/fixtures/v0/`). `results/`: the recorded measurements. |
| `a11y/` | Contrast calculator and font name-table reader, with their output. |

## Running

Every path is resolved from `paths.mjs`, so the probes run from any checkout. Run them from the repo root, for example:

```sh
node scripts/audit/domain/verify4.mjs
node scripts/audit/agent/probe.mjs sanitize
node scripts/audit/perf/scripts/derived-bench.mjs              # this checkout, doc60
node scripts/audit/perf/scripts/gen-doc.mjs ../form-b201af8     # another checkout (a git worktree)
```

- The probes load the v0 modules in `src/lib/` with jiti (a dev dependency). Phase 1 step 18 deletes those modules, the v0 store and `@anthropic-ai/sdk`. The pure modules stay in `test/legacy/v0/lib/` (commit `b201af8`): after step 18, point `LIB` in `paths.mjs` there to re-run the probes that use only them. The probes that load the store, the Claude module or the SDK run only on commits before step 18.
- Re-runs that are not deterministic (ids, timings, browser measurements) write to `scripts/audit/.out/` (gitignored), never over the recorded results. `agent/schema.mjs` and `diagnosis/schema.mjs` regenerate their committed JSON in place; the output is byte-identical at `b201af8`.
- The perf harness needs `npm install` inside `perf/tools/` (puppeteer-core, axe-core) and Google Chrome at the standard macOS path, or `CHROME_PATH`. It drives a production build served on port 3499.
