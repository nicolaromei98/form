# Phase 0 audit harnesses

These are the scripts, fixtures and raw results behind `docs/AUDIT.md`. They are evidence, kept for reproducibility. They are **not wired into the build**: `package.json` gains no scripts or dependencies from them.

| Folder | What it holds |
|---|---|
| `domain/` | jiti probes of the reducer: purity, invariants, schema limits, persistence. `results.json` holds the recorded outputs. |
| `agent/` | Probes of the interpretation pipeline: a parser battery, a mocked SDK, and the JSON Schema sent to Claude (`schema.raw.json` is the Zod output, `schema.sent.json` is the payload after the SDK transform) with its parameter counts. |
| `diagnosis/` | Checks of the v1 §2 points: the working-day schedule, scale benchmarks, contrast maths. |
| `perf/` | `tools/`: the headless-Chrome harness (puppeteer-core + CDP, axe-core). `scripts/`: document generators and analysers. `fixtures/`: 60-task and 150-task docs plus the demo doc. `results/`: JSON measurements. The `traces/` folder was not kept (214 MB). |
| `a11y/` | Contrast calculator and font name-table reader, with their output. |

Several scripts still point at the scratch directory used during the audit (`/private/tmp/claude-501/...`) and at the absolute repo path. Phase 1 moves the useful ones into `scripts/` and `e2e/` with relative paths, proper dependencies and CI wiring (FORM-v1 §15).

To re-run a probe as it is today, copy it to a scratch directory and fix the paths at the top. The perf harness needs `npm i` inside `perf/tools/`, plus Google Chrome at the standard macOS path.
