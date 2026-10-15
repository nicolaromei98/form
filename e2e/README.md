# e2e: `/demo` visual, motion and flow baselines

Plan §10.8. Every build gets the same input (a v0 workspace from `test/fixtures/v0` under `form.workspace.v1`, then commands and clicks) and is captured in the same states.

| Spec | What | Projects |
|---|---|---|
| `visual.spec.ts` | 23 full-page stills (`states.ts`), reduced motion, through the pixel gate (`gate.ts`). From step 19 each state names its expected differences against B, and on a v2 build asserts their values (`expected.ts`, `expected-diffs.md`) | Chromium and WebKit, 1440×900 and iPhone 13 (390×844) |
| `motion.spec.ts` | 11 triggers × frames at 0, 120, 240, 480, 900, 1,750 ms, through the gate at 0.1% per frame with the trigger's masks; on a v2 build also the store's phases and fx (create phase within `CREATE_TOTAL_MS` ± 100 ms, tab switches shift, undo restores) | Chromium 1440×900 |
| `interactions.spec.ts` | ED-9: "+ Duration" opens empty, "Add person" gives 0/5d, a command-added person shows "Capacity unknown"; v2 builds only | Chromium 1440×900 |
| `perf.spec.ts` | planning, Focus and the brief at 150 tasks in the browser with the CPU throttled 4×, < 8 ms each (plan step 19). The engine is bundled from `e2e/perf/bench.ts` by `scripts/e2e/perf-bundle.mjs` and minified with Next's SWC; v2 builds only. Results in `artifacts/perf.json` | Chromium 1440×900 |
| `flow.spec.ts` | the v0 §15 path as a video, real time | Chromium and WebKit 1440×900 |
| `agent-idle.spec.ts` | the agent's attribute writes at rest, rAF calls, CDP main-thread time. From the agent fix (plan step 5) it asserts §9.1: 0 writes per second 1 s after settling in every idle state, with and without reduced motion; a pointer near the settled agent wakes it within 50 ms, and it settles again; a hidden tab writes nothing and resumes when shown. On older builds it records v0's endless loop | Chromium 1440×900 |
| `route.spec.ts` | `/` answers 307 → `/demo` (query string kept), `/demo` answers 200, a browser opening `/` lands on the mounted app; skipped on builds from before the route move | Chromium and WebKit 1440×900 |
| `a11y.spec.ts` | axe on every state, as rendered and with the ground flattened to its darkest end (`--paper-lo`), so the text axe can't decide over the gradient is decided. From the Q14 tokens on (plan step 4): no `color-contrast` violation in either pass, and no rule that A doesn't already break in that state (`e2e/baselines/a11y-A.json`). Earlier builds only record. Results in `artifacts/a11y/<state>.json` | Chromium 1440×900 |

## Running

```sh
npm run e2e:compare                                   # HEAD against the gate's baseline (e2e/baselines/gate.json)
npm run e2e:compare -- --base <ref> --head <ref>      # any two commits
npm run e2e:compare -- --capture <ref> --label A      # capture a baseline and write e2e/baselines/A.json
npm run e2e:compare -- --keep -- visual.spec.ts --project chromium-desktop   # Playwright args after the second --
npm run e2e:compare -- --keep --reuse-base --out e2e/.out/<run>   # the head again, against the references an earlier run wrote there
node scripts/e2e/bundle.mjs                           # first-load JS of /demo, gate baseline (B) against HEAD: raw, gzip, brotli
npm run e2e                                           # this checkout only, built and served on 3500
node scripts/e2e/pairs.mjs --before R --after T       # two captures' stills side by side, with diffs, in e2e/.out/pairs-R-T
node scripts/e2e/pairs.mjs --before T --after B --frames   # the same, plus the motion frames (0.1% tolerance reported)
node scripts/e2e/a11y-baseline.mjs <run>/base/artifacts <A's commit>   # a11y.spec.ts results of A → e2e/baselines/a11y-A.json
```

`compare.mjs` builds each commit in a git worktree under the system temp dir, serves it with `next start` on 3500 (base) and 3501 (head), runs these specs against the base with `--update-snapshots=all`, then against the head. The base server stays up during the head run, for the gate's retry protocol. Port 3417 is never used. Everything a run writes goes to the gitignored `e2e/.out/<run>/`: `snapshots/` (every capture and its `.gate.json` sidecar of mask boxes), `base|head/report` (HTML), `base|head/test-results` (diffs, traces), `base|head/artifacts/{agent-idle.json,a11y/,videos/,gate/,perf.json}`. `summary.json` adds the gate's totals per project and spec, which the run also prints.

## The C vs B gate (step 19)

`gate.ts` compares a capture with the reference build's capture of the same name at 0 differing pixels (frames: 0.1%), outside the expected differences of `expected-diffs.md`:

- **masked**: the union of both builds' boxes is painted over both images;
- **collapsed**: a region whose size changes is taken out of the layout in both builds before the capture.

On a v2 build each masked or collapsed value is asserted as text or state. A still that differs is reached again on fresh contexts of both builds before it fails (the retry protocol, for a raster quirk of Chromium's phone emulation). Each comparison writes `artifacts/gate/<project>/<spec>/<name>.json`: mode, pixels compared and differing, area masked per ED, sizes, retries.

## Baselines

- No screenshot is committed. A baseline is a commit plus a manifest in `e2e/baselines/<label>.json` (environment, SHA-256 of every still and frame, videos, the idle probe's numbers). Rebuilding from the commit on the same machine and browsers gives the same bytes; CI rebuilds both sides on one runner.
- **A** is the v0 app at `864fb47`, tagged `phase1-baseline-a` locally. It builds the same app as `main@b201af8`: only devDependencies, the unimported `src/lib/phase.ts` and tests differ. Captured on 2026-10-14: 92 stills (56 MB), 66 frames (13 MB), 2 videos (37 MB), and the idle probe at about 3,000 agent attribute writes per second in every state.
- **R** is the route move at `8ceb390` (plan step 3), served at `/demo`. Captured on 2026-10-14: 116 passed and 1 skipped, with 92 stills (56 MB), 66 frames (13 MB), 2 videos (38 MB), and the idle probe still at about 2,700 to 3,000 writes per second. Against A, all 92 stills are byte-identical (0 differing pixels), and `npm run e2e:compare -- --base phase1-baseline-a --head 8ceb390` passed all 116 tests. 22 motion frames differ from A by at most 0.06% of their pixels, within the 0.1% frame tolerance. The differences reproduce: a second R run repeated them, apart from one-level raster noise that A also shows against itself. At those instants the clock, the styled DOM and every Web Animation are identical. Only two rAF loops differ, and both take their start time from `performance.now()` inside a React effect:
  - the text scramble's glyphs. The seeded random stream sits one value apart (A has drawn 162 values when `open()` returns, R 161), and the scramble is its only consumer;
  - the agent fluid's particle positions.

  The likely cause is effects committing at a slightly different fake millisecond under the `/demo` route tree.
- **T** is the Q14 tokens commit at `01e67f1` (plan step 4: the token table, surface dimming, `--signal-text`/`--signal-graphic`, `--line-strong`), served at `/demo`. Captured on 2026-10-14: 139 passed and 1 skipped (140 with `a11y.spec.ts`), with 92 stills (56 MB), 66 frames (13 MB), 2 videos (39 MB); the idle probe is unchanged (about 2,800 to 3,000 writes per second; the agent fix is step 5). Against R, all 92 stills differ by design (the text ramp is on every screen): from about 3,100 pixels (empty, desktop) to 178,000 (tracker-urgent, phone), the most where the urgent highlight used to fade whole cards (tracker-urgent, caption-undo). No still changes size. `node scripts/e2e/pairs.mjs --before R --after T` lays the pairs out for review. On axe, A shows colour-contrast violations as rendered in 11 of 23 states and, on the flattened ground, in all 23; T shows none in either pass, and no rule A doesn't break in the same state (`e2e/baselines/a11y-A.json`). T was the reference for step 5's frames; it was never a gate.
- **B** is the agent fix at `f6e635f` (plan step 5: the settling loop, the agent's own goo region, the static reduced-motion agent, the SVG's compositing layer), served at `/demo` and tagged `phase1-baseline-b` locally. Captured on 2026-10-14: 141 passed (the idle probe now asserts §9.1), with 92 stills (56 MB), 66 frames (13 MB), 2 videos (44 MB). Idle probe: 0 agent mutations per second 1 s after settling in all five idle cases, settled 7.6 to 8.8 s after mount (at once under reduced motion); a pointer near the settled ring or pill woke it within 1 ms, and it settled again 5.7 and 6.7 s later; a hidden tab 0. Main thread at rest with 60 cards: 1.1 ms/s (T: 54.6). Against T (`node scripts/e2e/pairs.mjs --before T --after B --frames`):
  - **Frames:** 45 of 66 identical, the other 21 within the per-pixel threshold (one pixel over it in `agent-input-1750ms`). While the material breathes, the settling loop moves it exactly as v0's loop did, and every motion trigger comes before the breath fades, so no frame shows an idle-breathing difference. The fade (Q29) shows only on real time: in the `flow.spec.ts` videos the ring and the pill go still about 6 s after the last input, where T keeps breathing.
  - **Stills:** 87 identical, 1 within the threshold, 4 differ at the goo silhouette's edge: chromium-phone composer (30 pixels), palette (25), empty (2), chromium-desktop composer (1). The cause is the SVG's own compositing layer (`will-change: transform`, plan §9.1 A2) on pages that don't scroll, where the fixed SVG was not composited before: toggling it at runtime gives T's pixels back, while the agent's user-space filter region alone is pixel-identical to v0's.
- `gate.json` names the baseline CI compares with: B since the agent fix (R before it).

## Determinism

- The clock is Playwright's fake one, paused at 2026-10-14 10:00 Europe/Rome and moved only by `runFor`. `performance.now()` and `requestAnimationFrame` are re-based on the fake `Date`, so frames fall at the same instants on every run (`settle.ts`, `frameGrid`).
- Frame control (`frames.ts`) pauses every Web Animation (Motion's WAAPI, CSS transitions, keyframes) and seeks it to its age on the fake clock; in Chromium the real document timeline is also stopped. Randomness is seeded, so ids and the collage are the same every run: `Math.random` and `crypto` draw from two streams (v2's ids never move the text scramble's values), and both restart before each motion trigger (`__e2e.reseed()`).
- A settle lasts whole 2 s blocks of fake time and needs 1.5 s without DOM changes outside the agent, no unfinished animation and no image still loading.
- After a v2 build's first-load caption (ED-10) the pointer is parked at (0, 0) and the agent settles. With full motion every stepped open then runs the clock to `OPEN_MS` (24 s) after the frozen time, so both builds meet a trigger in the same phase.
- Frames: the clock steps 16 ms at a time, and after each step the browser renders four real frames, so ResizeObserver callbacks (`useWidth`, the Focus stage) reach React at the same fake instant on every run. React's scheduler is moved onto the fake `setTimeout`.
- Tolerances: stills `maxDiffPixels: 0` with a per-pixel threshold of 0.01 (two RGB levels of raster noise on blurred glass); frames 0.1% of pixels; one screenshot per frame. Measured on an M5: rebuilding A from its commit reproduced all 92 stills and 65 of 66 frames byte for byte (the other within tolerance), and `npm run e2e:compare` (A against the step 2 commit) passed all 108 tests. Under heavy machine load the only failures seen were timeouts, hence the generous test and screenshot timeouts.

## Knobs

`E2E_BASE_URL`, `E2E_APP_PATH` (`/` or `/demo`, read from the served commit by `compare.mjs`), `E2E_OUT_DIR`, `E2E_SNAPSHOT_DIR`, `E2E_ARTIFACTS_DIR`, `E2E_THRESHOLD`, `E2E_AGENT_EXPECT` (`settled`, the default: assert the §9.1 criteria; `record`: record v0's endless loop. `compare.mjs` picks it per served commit, from whether it has `src/components/agent/loop.ts`), `E2E_TRACE_DIR` (a DOM and animation dump next to every motion frame, to find where two runs diverge), `E2E_ENGINE` (`v0` or `v2`, from whether the served commit has `src/lib/store/engine.ts`: the expected differences are asserted on `v2`), `E2E_REFERENCE_URL` (the reference build's server during a comparing run, for the retry protocol).
