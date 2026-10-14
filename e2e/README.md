# e2e: `/demo` visual, motion and flow baselines

Plan §10.8. Every build gets the same input (a v0 workspace from `test/fixtures/v0` under `form.workspace.v1`, then commands and clicks) and is captured in the same states.

| Spec | What | Projects |
|---|---|---|
| `visual.spec.ts` | 23 full-page stills (`states.ts`), reduced motion | Chromium and WebKit, 1440×900 and iPhone 13 (390×844) |
| `motion.spec.ts` | 11 triggers × frames at 0, 120, 240, 480, 900, 1,750 ms | Chromium 1440×900 |
| `flow.spec.ts` | the v0 §15 path as a video, real time | Chromium and WebKit 1440×900 |
| `agent-idle.spec.ts` | the agent's attribute writes at rest, rAF calls, CDP main-thread time | Chromium 1440×900 |

## Running

```sh
npm run e2e:compare                                   # HEAD against the gate's baseline (e2e/baselines/gate.json)
npm run e2e:compare -- --base <ref> --head <ref>      # any two commits
npm run e2e:compare -- --capture <ref> --label A      # capture a baseline and write e2e/baselines/A.json
npm run e2e:compare -- --keep -- visual.spec.ts --project chromium-desktop   # Playwright args after the second --
npm run e2e                                           # this checkout only, built and served on 3500
```

`compare.mjs` builds each commit in a git worktree under the system temp dir, serves it with `next start` on 3500 (base) and 3501 (head), runs these specs against the base with `--update-snapshots=all`, then against the head. Port 3417 is never used. Everything a run writes goes to the gitignored `e2e/.out/<run>/`: `snapshots/`, `base|head/report` (HTML), `base|head/test-results` (diffs, traces), `base|head/artifacts/{agent-idle.json,videos/}`.

## Baselines

- No screenshot is committed. A baseline is a commit plus a manifest in `e2e/baselines/<label>.json` (environment, SHA-256 of every still and frame, videos, the idle probe's numbers). Rebuilding from the commit on the same machine and browsers gives the same bytes; CI rebuilds both sides on one runner.
- **A** is the v0 app at `864fb47`, tagged `phase1-baseline-a` locally. It builds the same app as `main@b201af8`: only devDependencies, the unimported `src/lib/phase.ts` and tests differ. Captured on 2026-10-14: 92 stills (56 MB), 66 frames (13 MB), 2 videos (37 MB), and the idle probe at about 3,000 agent attribute writes per second in every state.
- `gate.json` names the baseline CI compares with. The UI lane moves it to R after the route move and to B after the agent fix, capturing each with `--capture`.

## Determinism

- The clock is Playwright's fake one, paused at 2026-10-14 10:00 Europe/Rome and moved only by `runFor`. `performance.now()` and `requestAnimationFrame` are re-based on the fake `Date`, so frames fall at the same instants on every run (`settle.ts`, `frameGrid`).
- Frame control (`frames.ts`) pauses every Web Animation (Motion's WAAPI, CSS transitions, keyframes) and seeks it to its age on the fake clock; in Chromium the real document timeline is also stopped. Randomness (`Math.random`, `crypto`) is seeded, so v0's ids and the collage are the same every run.
- A settle lasts whole 2 s blocks of fake time and needs 1.5 s without DOM changes outside the agent and no unfinished animation.
- Frames: the clock steps 16 ms at a time, and after each step the browser renders four real frames, so ResizeObserver callbacks (`useWidth`, the Focus stage) reach React at the same fake instant on every run. React's scheduler is moved onto the fake `setTimeout`.
- Tolerances: stills `maxDiffPixels: 0` with a per-pixel threshold of 0.01 (two RGB levels of raster noise on blurred glass); frames 0.1% of pixels; one screenshot per frame. Measured on an M5: rebuilding A from its commit reproduced all 92 stills and 65 of 66 frames byte for byte (the other within tolerance), and `npm run e2e:compare` (A against the step 2 commit) passed all 108 tests. Under heavy machine load the only failures seen were timeouts, hence the generous test and screenshot timeouts.

## Knobs

`E2E_BASE_URL`, `E2E_APP_PATH` (`/` or `/demo`, read from the served commit by `compare.mjs`), `E2E_OUT_DIR`, `E2E_SNAPSHOT_DIR`, `E2E_ARTIFACTS_DIR`, `E2E_THRESHOLD`, `E2E_AGENT_EXPECT=settled` (assert the §9.1 criteria instead of recording), `E2E_TRACE_DIR` (a DOM and animation dump next to every motion frame, to find where two runs diverge).
