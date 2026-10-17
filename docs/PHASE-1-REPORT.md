# Phase 1 · Domain — report

- **Branch:** `phase-1-domain`, from `main` at `b201af8`.
- **PR:** https://github.com/nicolaromei98/form/compare/main...phase-1-domain?expand=1
- **Plan:** `docs/PHASE-1-PLAN.md`. Decisions are in `docs/DECISIONS.md`, from "Phase 1 build plan" through "Wave 8".

## What changed

`/demo` now runs on FORM's v2 domain, end to end. The v0 library and the never-run Claude path are deleted. Phase 5 rebuilds Claude on the operation registry.

**Domain**
- Two documents: workspace and project, schema v2, with explicit invariants.
- A 66-op registry. Each op carries its own schema, reducer (Immer, with patches), caption, parser phrases, palette entry and transport spec. A completeness test keeps them aligned.
- The reducer is deterministic: ids travel in the op payload. It never mints an id or reads a clock. A no-op creates no history entry.
- Every commit is validated against the schema and the invariants.

**Planning**
- A working-day calendar, with closures and time off.
- Dependencies, with forward and backward passes, float and the critical path.
- Unknown durations propagate to successors, and the cause is named.
- Risks, deadlines, weekly load across projects, role-aware balance, leveling, and Focus v2, which never suggests a blocked task.
- Brief v2, composed from the same plan.

**Store**
- Multi-document, with undo and redo by patches and gestures. Tab, selection and zoom are local state (Q6).
- Saved under `form.demo.v2`. An unreadable save is backed up, never wiped.

**Migration**
- On first load, the existing v0 workspace (`form.workspace.v1`) is migrated, and the v0 keys are never written.
- Checked on 30 fixtures.

**Parser and captions**
- The fast parser is ported to registry ops.
- Captions are composed only from the ops that applied. They follow the caption policy: at most four parts, one short line, no-ops said honestly.

**Agent**
- At rest the agent loop sleeps: 0 attribute writes per second instead of 3,000.
- Under reduced motion the agent is a static SVG.

**Accessibility**
- Q14 contrast tokens: 0 colour-contrast violations in all 23 states.

**Typography**
- Satoshi and Geist Mono replace Aeonik. This is on `main` already.

**Routes**
- `/demo` serves the app.
- `/` answers a temporary 307 to `/demo` until Phase 2 ships the public intro.

## Verification

**Pixel gate, the new engine (C) against baseline B**
- B is v0 plus the route move, Q14 and the agent fix.
- **Final run:** on `a82554d` (the branch head before this report update; `src/` unchanged since `4210fd6`), `E2E_CHROMIUM_ARGS=--disable-gpu npm run e2e:compare`, 4 workers. Head: 145 passed, 0 failed.
- **Stills:** 0 differing pixels outside the expected differences, in all 92 stills: 23 states × desktop and phone × Chromium and WebKit. That is about 288 million compared pixels. 91 matched at the first capture. One, `composer` on webkit-desktop, matched after a retry (see Known limits).
- **Motion:** 66/66 animation frames within 0.1%. 62 are exact, and the worst is 0.047% (`focus-enter` at 900 ms).
- **Expected differences:** ED-1 to ED-12 in `e2e/expected-diffs.md`. Each has a reason, a decision and an assertion that replaces the pixels:
  - working-day dates;
  - the timeline footer;
  - Team figures and the plan card;
  - the Focus sentence;
  - brief risks;
  - the engine label;
  - one palette phrase;
  - the "Schedule now skips weekends." notice;
  - Undo after a tab switch (Q6);
  - the moodboard collage, whose positions come from v2 ids.
- **One real regression was found and fixed.** The timeline start date was drawn as a single text node instead of v0's three, which moved one glyph.

**Other checks**
- **Flow:** the v0 demo path runs end to end in Chromium and WebKit, with videos recorded.
- **Agent idle:** 0 mutations per second at rest; it wakes in under 1 ms. The main thread at rest with 60 cards uses 0.6 ms/s (the audit measured 108).
- **Accessibility:** axe passes in all 23 states, with no rule beyond the v0 baseline's.

**Performance, in the browser at 4× CPU with 150 tasks** (budget < 8 ms)

| Case | Median |
|---|---|
| Planning | 0.28–0.38 ms |
| Focus | 0.28 ms |
| Brief | 0.18 ms |
| Plan + lanes + brief, cold | 0.78 ms (p95 0.96) |

**Tests**
- 2,450 unit, golden and DOM tests.
- The property suite runs green at 10,000 runs on 4 shards (reducer and planning included) and at 1,000 runs in about 15 s.
- 26 perf tests.
- Typecheck clean; lint with 0 errors.

**Bundle**
- `/demo` first-load JS grows by +71.9 KB gzip (+23.2%, 309.8 → 381.7 KB), all in the app chunk: immer, the registry schemas and planning.
- Plan §12 item 17 expected this. Code splitting is Phase 6.

## Known limits and follow-ups
- **Gate hardening (2026-10-16).** The first full run on the final commit (`380da0b`) failed 2 of 92 stills: tracker-list on chromium-phone (6,382 px) and brief-client on webkit-phone (1,966 px).
  - Neither was a regression. Each is a browser drawing the same page in one of two ways from one load to the next, and B and C both draw both images.
  - **Chromium:** a full-page screenshot can lay the page out at a 1×1 view, leaving the glass text 1 CSS px off.
  - **WebKit:** a snapshot taken right after the gate's collapse can rasterise the dot-grid tile harder-edged.
  - The 2+2-capture retry couldn't absorb either.
  - The gate now holds the document's width during Chromium full-page stills and waits 200 ms after a collapse. The retry stays at two captures per build, and a pass after a retry is listed apart in the run's output and `summary.json`.
  - Adversarial review checked that every visible C-only change tried still fails.
  - The details, measurements and what was not established are in `e2e/expected-diffs.md` and DECISIONS "Gate hardening after the final-commit run".
- **Residual quirk.** WebKit page stills, which get no wait, can still now and then draw the second dot-grid image. In the final run, `composer` on webkit-desktop did, at 16,166 px: the same count the hardening work had already measured for that image. It matched on the retry and was reported as a pass after a retry. If CI ever fails on a WebKit still at a count like that, rerun before investigating. Phase 6 can remove the quirk.
- **Running the gate.** A locked screen stalls headless Chromium, and sleep on battery breaks the runs. Keep the machine awake:

  ```
  E2E_CHROMIUM_ARGS=--disable-gpu npm run e2e:compare
  ```
- **CI.** The macOS e2e job runs on pull requests and on demand only, because of its cost.
- **`useWidth`** sometimes reads width 0 on the phone moodboard after a full-page screenshot, in both v0 and v2.
  - It is very likely the same 1×1 view inside Chromium's full-page capture, so a test artefact rather than something users meet. That was not reproduced on the moodboard itself.
  - Phase 3 should still check that `useWidth` survives a zero-width ResizeObserver entry.
- **Bundle size** is over the Phase 6 target. It was measured and left for code splitting.
- **Repository and fonts.** The repository must stay private (Satoshi licence), and the Aeonik files must be purged from git history before it is ever made public.

## What to look at
- Open `/demo` and walk the demo: create a timeline, add Team from the node, balance, Focus, brief, moodboard, undo.
- An existing local workspace is migrated on first load. You'll see "Schedule now skips weekends.".
