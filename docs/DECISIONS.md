# Decisions

Choices not covered by `docs/FORM-v1.md`, or confirmed from its section 3.2. Each entry: date, context, choice, alternative rejected. The newest is at the bottom.

---

### 2026-10-14 · Accounts, database and files
- **Context:** FORM-v1 §3.2 #1 and #2. The app needs accounts, server storage, file storage and rate limiting.
- **Choice:** Better Auth with the Drizzle adapter (magic link via Resend, plus Google OAuth). Postgres on Neon with Drizzle. Vercel Blob (private store). Upstash Redis for rate limits. Everything is installed from the Vercel Marketplace where possible. Confirmed by Nicola.
- **Rejected:** Clerk (managed and faster to integrate, but its UI must be restyled to the art direction and it costs money past the free tier). Supabase (one service for everything, but outside the Marketplace, and it would change the sync and storage design).

### 2026-10-14 · Language
- **Context:** FORM-v1 §3.2 #3.
- **Choice:** UI and captions in English. Commands are accepted in English and Italian. The deterministic fast lane stays English-only; Italian goes through Claude (§9). Clarify and decline texts are always English. Confirmed by Nicola.
- **Rejected:** English only.

### 2026-10-14 · Collaboration
- **Context:** FORM-v1 §3.2 #4.
- **Choice:** v1 has one user per workspace. The only thing shared outside is the brief link (`/b/[token]`). The schema already carries members, roles and commit authors, so real-time collaboration can come later without rewriting the model. Confirmed by Nicola.
- **Rejected:** invitations with roles in v1.

### 2026-10-14 · The current demo
- **Context:** FORM-v1 §3.2 #5.
- **Choice:** the current prototype stays public at `/demo`, with no account. It keeps the template, the deterministic parser, "Reset demo" and the engine indicator. In Phase 1 it is rebuilt on the new engine. Confirmed by Nicola.
- **Rejected:** removing it.

### 2026-10-14 · Phase workflow without the GitHub CLI
- **Context:** FORM-v1 §0.2 asks for a branch, a PR and a Vercel preview per phase. This machine has no `gh` CLI and no `vercel` CLI.
- **Choice:** each phase is pushed as its own branch (`phase-N-<name>`). The report gives the GitHub compare URL so Nicola can open the PR. Vercel builds a preview for every pushed branch through the existing GitHub integration. Up to Phase 2 there is no database to branch. From Phase 2, Neon preview branching comes from the Marketplace integration.
- **Rejected:** pushing phases straight to `main`. That was the v0 habit, and the v1 brief asks for a stop and review between phases.

### 2026-10-14 · Reference documents in the repo
- **Context:** FORM-v1 expects `docs/FORM-v0.md` next to it.
- **Choice:** `docs/FORM-v0.md` is the v0 context document written on 2026-10-14 from a full code inventory. Inaccuracies found in the Phase 0 audit are corrected there, and each one is listed in `docs/AUDIT.md`. `docs/FORM-v1.md` is the build prompt, verbatim.
- **Rejected:** keeping the documents outside the repo.

### 2026-10-14 · Typography: Satoshi and Geist Mono replace Aeonik
- **Context:** the Aeonik Pro licence could not be verified (AUDIT Q31). Nicola chose to replace the fonts. This supersedes FORM-v1 §1 "tipografia invariata".
- **Choice:**
  - **Satoshi** (Indian Type Foundry, ITF Free Font License 2.0) for titles, paragraphs, UI and numbers.
  - **Geist Mono** (SIL OFL, through `next/font/google`) only for eyebrows.
  - Satoshi is the official `Satoshi-Variable.woff2`, self-hosted as shipped (weight range 300–900, one file, 42.6 KB), with the licence next to it in `src/fonts/satoshi/`.
  - Both fonts use `display: swap` with next/font's size-adjusted fallbacks (AUDIT Q24).
  - The type scale and tracking are unchanged. Node capsule widths were re-measured for Satoshi.
- **Licence constraints, now rules:**
  - Never modify the Satoshi file: no subsetting, no format conversion, no renaming its metadata.
  - Never redistribute it through a public repository or a public server other than our own site.
  - Never offer it as a font that FORM users can pick for their own content.
  - The `form` repository must stay private. Before it is ever made public, remove the font from git and also purge the Aeonik files from history. They were removed from the tree today but remain in earlier commits; rewriting history was not done because it is destructive and the repository is private.
- **Rejected:** keeping Aeonik pending licence documents; loading Satoshi through the Fontshare API (an outside dependency that the licence calls "at your own risk").

### 2026-10-14 · Answers to the Phase 0 questions (AUDIT §4)
- **Context:** Nicola delegated the answers ("rispondi tu"). Each one was weighed against the v1 principles: honesty, undo everywhere, simplest design that holds, no regressions without a reason.
- **Choice:** the proposed defaults in AUDIT §4, with these refinements:
  - **Q3 (capacity):** `capacityDaysPerWeek` becomes nullable.
    - A person created in a form starts with a visible, editable 5. This is a choice made in front of the user.
    - A person created by a command that names no capacity gets `null`, and FORM asks for it with a clarify chip.
    - Load against a null capacity shows the days of work but no over/under verdict.
    - "+ Duration" opens an empty editor instead of writing 1 day.
  - **Q16 (Claude key):** made moot by the safety patch below, since Claude now needs an explicit opt-in. Live smoke requests happen at the start of Phase 5, with a preview key that Nicola provides.
  - **Q23 (Safari and phone):** Playwright's WebKit build is the automated Safari proxy for perf and visual checks in CI (macOS runner). Profiles: 4× CPU for the mid-range phone, plus iPhone 13 and Pixel 6a viewport presets. A real-device pass stays on the launch checklist.
  - **Q24 (fonts):** done with the typography change above.
  - **Q31 (font licence):** resolved by the typography change. The launch checklist keeps "repository private or font out of git".
- **Everything else as proposed:**
  - Q1–Q2, Q4–Q15 (Phase 1 inputs);
  - Q17–Q22 (agent);
  - Q25–Q30 (performance and accessibility).
- **Rejected:** blocking Phase 1 on further questions.

### 2026-10-14 · v0 safety patch on `main` (AUDIT §3)
- **Context:** four reachable edits produced a document the schema rejects, and the next load then wiped the workspace. `/api/interpret` had no authentication or limits.
- **Choice:** one commit on `main` (the live demo):
  - **Every commit is validated** against `DocSchema` before it is applied. An invalid change is refused with the caption "That change would break the workspace, so FORM didn't apply it."
  - **The limits are also enforced where edits happen:**
    - the project title editor stops at 80 characters;
    - person names stop at 40;
    - "Add person" is disabled at 20, and the reducer refuses more;
    - moodboard additions stop at 200 items;
    - `arrangeMood` clamps every box to the stored bounds.
  - **An unreadable save is copied** to `form.workspace.v1.backup` before the first write can replace it.
  - **Claude runs only with `FORM_ENGINE=claude` and a key.** A key alone no longer enables it. Requests over 256 KB get a 413.
- **Rejected:** waiting for Phase 1, which rebuilds `/demo` weeks later; the risk is live today.


### 2026-10-14 · Phase 1 build plan
- **Context:** `docs/PHASE-1-PLAN.md` is the Phase 1 design. It was chosen from three independent architectures (adapter, port, core-and-contracts), scored by an engineering judge and a product judge, and synthesised. The port approach won on later-phase cost and correctness, with the best ideas from the other two grafted on.
- **Choice:** the plan's §13 decisions, adopted as written:

1. **`/demo` strategy: port, not adapter.** Components move to v2 hooks in Phase 1, and the v0 lib is deleted (frozen copies are test-only). *Rejected:* a v0 view-model adapter (projection, op lowering, façades), which Phase 3 would throw away while paying for a second migration.
2. **Routes in Phase 1.** `/demo` serves the app; `/` returns a temporary 307 to `/demo` until Phase 2 ships the public intro with "Sign in". There is no `/app`, `/login` or `/b`. *Rejected:* empty `/app` or `/login` shells (dead UI without auth or data).
3. **The Claude path is removed until Phase 5**, and the engine label becomes "Demo parser · no AI model". *Rejected:* keeping the v0 route behind the v0 transport schema.
4. **View ids keep the v0 names** ("cards" is labelled Tracker), and `BlockKind` keeps header and collection. The §9.4 transport maps "tracker" ↔ "cards" in Phase 5. *Rejected:* renaming during the switchover.
5. **Q6 refinement.** Show, select and zoom are local intents outside the registry and commits. History entries restore the previous active view. viewConfig commits are hidden from Activity, while views and blocks are content. *Rejected:* view-scope ops in the registry or the commit schema.
6. **Q9 refinement.** Archived and deleted state lives only in the workspace index entry, and `ProjectStatus` has no "archived". No op mutates two documents. *Rejected:* duplicating archived state in the project document.
7. **Records keyed by id** for tasks, mood items, people, templates, closures, time off and the project index. Explicit order and z keys exist because `jsonb` reorders keys. *Rejected:* arrays, whose index-shifting patch paths break revert checks.
8. **No stored `updatedAt`**; `createdAt` and `completedAt` are stored from `ctx.now`. *Rejected:* stamping every patch, which makes Phase 2 revert conflicts false (deviation from v1 §5.4–§5.5).
9. **Ids** are a prefix plus 16 characters of `[0-9a-z]`, minted by producers; collisions are rejected; `duplicateProject` derives ids deterministically. *Rejected:* minting in the reducer, or an id-map payload.
10. **Field-shaped update ops and anchor-based ordering** computed in the reducer, plus an explicit `rebalanceOrder` op. *Rejected:* patch-shaped updates, producer-computed keys, and silent re-keying.
11. **The 66-op list** beyond v1 §16:
    - added: addClosure/removeClosure, restorePerson, deletePerson (Q8), updateWorkspace and updateTemplate (Q12), rebalanceOrder;
    - `setRepresentation` split into addView plus a local show;
    - `resetBriefLine` takes several keys;
    - arrangeMood and clearMood name their items.
12. **No runnable deprecated ops.** The 35 v0 names map to v2 in the registry `deprecates` fields and in a test-only lowering. *Rejected:* keeping v0 ops callable "for migration" (v0 never persisted ops).
13. **Status and progress table:**
    - leaving Done goes to 95%;
    - review@100 is valid only with `requireReview`, and turning `requireReview` off makes those tasks Done;
    - each op changes one field, and status wins when both are given.

    *Rejected:* keeping 100% after leaving Done.
14. **Milestones** have an estimate of 0, no steps and allocation 1. *Rejected:* a null estimate (null means unknown).
15. **"Blocked"** means a To-do task with an unfinished predecessor; started work is never hidden from Focus. *Rejected:* the literal v1 reading, which would block an urgent task already In progress.
16. **Unknown propagation:** float is null when any downstream task is unknown. Late requires a confirmed start, in `/demo` too.
17. **Load daily share** is `estimate / duration`, so total load equals the estimate. *Rejected:* allocation per day, which inflates half-day estimates.
18. **The Phase 1 Team lane** is the person's work window, with over and free summed per week. The sample capacities are 2/4/5 days a week. Team rows are project members. *Rejected:* a whole-span aggregate (it hides peaks) and fractional span capacities.
19. **Captions** come only from applied ops, local intents, typed query notes and fixed notices. Direct edits stay captionless as in v0. The cut at 280 characters happens after every suffix.
20. **Commits** are best-effort per op, validated after every op, with at most 12 non-system ops per command and workspace ops first. *Rejected:* all-or-nothing commits.
21. **Proposals.** One pending proposal; a new one replaces it; accept names the id and supports partial acceptance. `removeTask` deletes the brief edits keyed to the task (undo restores them).
22. **Q3 detail.** Team "Add person" gives a visible 5; a command gives null plus a suggestion chip; "+ Duration" opens empty and the first "+" sets 0.5.
23. **Q17 tiers** are computed now, with a `/demo` threshold of 0. The 340 ms beat stays for every `/demo` command until Phase 5 (Q19). "N weeks" is N × 5 working days.
24. **One currency per project** (`project.currency`, `budgetCents`); only manual `costCents` is stored. *Rejected:* currency per budget object or per task.
25. **Migration choices:**
    - the subtasks proposal wins over the plan;
    - orphan steps and steps beyond 40 are promoted to tasks;
    - non-sample capacities become null;
    - the log labels are dropped and the change count kept;
    - brief keys are rewritten, and edits on missing entities are dropped and reported.
26. **Demo storage.** The `form.demo.v2` envelope; the v0 keys are never written; an unreadable save goes to `.backup`; asset aliases are used instead of copying blobs; deleted projects are compacted on save.
27. **`/demo` keeps absolute sample dates** with the sample labels until Phase 4. Relative labels are computed now.
28. **Phase 1 visual baseline.** B is v0 plus the route move, Q14 and the agent fix, all on the v0 code. The engine port is gated at 0 differing pixels outside ED-1 to ED-10. Q14 is applied with the full verified token table, because raising `--text-3` alone would invert the ramp.
29. **Agent settling (Q26, Q29).** Breathing fades out after 4 s of no input; the loop sleeps once settled and wakes on prop changes, a nearby pointer or visibility; under reduced motion the agent is a static SVG. The Focus floats are unchanged until Phase 4 or 6.
30. **Phase workflow.** Every verified step is committed and pushed to `phase-1-domain`; `main` is untouched until Nicola merges.

### 2026-10-14 · Phase 1 step 1 tooling details
- **Context:** step 1 installed the phase's tooling. A few details differ from the plan's letter.
- **Choice:**
  - nanoid 6.0.2, not 5: same `customAlphabet` API.
  - `@types/node` 22, because vitest 5 needs it and Node 22 runs locally and in CI.
  - The config file is `vitest.config.mts` (ESM), as in the Next 16 guide.
  - An extra `unit-dom` Vitest project (happy-dom) for store and component tests.
  - `npm test` runs unit, unit-dom and golden (plan §10.1).
  - The fast parser may import **types only** from `lib/ops`. Its result types live there, and the lint config can't be edited by parallel lanes.
  - Cross-module relative imports (`../`) are a lint error, so the boundary rules always see `@/lib/...` paths.
  - The components allow-list is enforced from step 18.
  - Step 2 may edit `ci.yml` to wire the e2e job, the single exception to "only step 1 edits it".
  - Audit re-runs write to the gitignored `scripts/audit/.out/`.
- **Rejected:** pinning older versions to match the plan's letter.

### 2026-10-14 · Wave 2 outcomes (steps 2, 6, 7, 8)
- **Context:** the evidence, domain, schema and calendar lanes merged into `phase-1-domain`. Their reports list small deviations from the plan's letter.
- **Choice (accepted deviations):**
  - **Dates.** `IsoDate` accepts 1970-01-01 to 2199-12-31, so planning stays total. Computed dates may go further, within fromDayNum's range.
  - **Order keys.** `OrderKey` is also checked with fractional-indexing's own rules.
  - **Home view.** `homeView(views)` returns one of the project's own views; v0 returned "cards" even when the project didn't have it.
  - **Money** is always stored in hundredths of the major unit, for every currency.
  - **Schema files.** The template and draft schemas live in `schema/template.ts` and `schema/project.ts`, to avoid an import cycle.
  - **Cycle paths.** `wouldCycle` uses BFS, so the cycle caption names the shortest loop.
  - **Planning → active.** A project moves from planning to active only when a task becomes "active" (§5.5, literally).
  - **Leaving Done.** `LEFT_DONE_PROGRESS = 95`.
  - **Calendar ordinals** count from a fixed origin (1970-01-01), so memoised calendars never shift. Only differences between ordinals carry meaning.
  - **Baseline A** is the tag `phase1-baseline-a` at 864fb47. That is the v0 app plus the step 0–1 tooling only.
  - **Baselines are regenerated from git refs and never committed.** Only `e2e/baselines/A.json` (hashes and sizes) is in git.
  - **Still tolerance** is a per-pixel threshold of 0.01 with 0 differing pixels. Playwright's default (0.2) would hide a token change.
- **Choice (CI cost):** the macOS e2e job runs on pull requests and on manual dispatch only, not on every `phase-*` push. Typecheck, lint, unit, golden, property, perf and build still run on every push, on Linux.
- **Rejected:**
  - committing the 56 MB of PNG baselines;
  - running macOS e2e on every push (about 10× the cost of Linux minutes).

### 2026-10-14 · Wave 3 outcomes (steps 3, 4, 5, 9, 11)
- **Context:** the UI lane (route move, Q14, agent loop), the ops core and the planning schedule merged into `phase-1-domain`. Baselines now exist as R (route), T (tokens) and B (gate, tag `phase1-baseline-b`).
- **Choice (accepted deviations):**
  - **Route move.** R vs A has 0 differing pixels in all 92 stills. 22 motion frames differ by ≤ 0.06%, within the 0.1% frame tolerance. The cause is effects committing at a different fake millisecond under the `/demo` tree, which only moves the scramble glyphs and fluid particles.
  - **Q14.** Checked by a live-token script (`scripts/audit/a11y/q14.mjs`, also run as a unit test): 208 checks pass. axe has 0 colour-contrast violations in all 23 states, in two passes (as rendered, and with the ground flattened to paper-lo). Additions inside the listed components:
    - the Team over-capacity ring uses `--signal-graphic`;
    - a segment's "· N%" loses its opacity;
    - ColorPicker fields get a focus ring;
    - moodboard swatch labels pick their ink by contrast.
  - **Agent loop.** The agent has its own filter id, `#form-agent-goo`, with a region limited to its box; `#form-goo` stays for FocusView. At rest it makes 0 writes per second, wakes within 1 ms on a nearby pointer, and settles about 8 s after load (the 4 s breath fade starts after the birth). The pointer pull fades out at the wake radius, so a distant pointer can't keep the loop alive. With 60 cards at rest the main thread drops from 108 ms/s (audit) to about 1 ms/s.
  - **Ops core.** Op samples are loosely typed and checked by parsing them against their schemas. The 61 stubs carry `stub: {family, until: 1}`, and the completeness test fails if any survive into Phase 2. Four behaviours go beyond the letter of the plan:
    - addTask adds its owner to the members;
    - removeTask also bridges plan-proposal seeds;
    - turning a task into a milestone drops its subtasks proposal;
    - v0's columns/layout rules are kept.
  - **Planning.** `TaskTiming.last` holds the end ordinal. Milestone dates follow the predecessors' end day (or the pin). Absurd chains are capped at `PLAN_SPAN_MAX` = 400,000 working days and marked unknown with reason "horizon". Relative mode measures float against the planned end, steps are clamped into their parent's window, and done tasks carry no risk.
- **Rejected:** forcing motion frames to be byte-identical across routes, which would have meant patching React's commit timing in the harness.

### 2026-10-15 · Wave 4 outcomes (steps 10a–e, 12, 13, 14)
- **Context:** the five op families, planning (load, lanes, balance, level, focus), the brief composer v2 and the v0 → v2 migration merged into `phase-1-domain`. Two earlier attempts stopped at the session usage limit. The second left partial work, which was saved as "WIP" commits and finished by the third run, now limited to four agents at a time and committing often.
- **Choice (accepted deviations):**
  - **Ten finished ops still carry a stub mark.** They are complete and unit-tested: resetBrief, removeBriefLine, resetBriefLine, updateBriefLine, removeClosure, removeTimeOff, updateTemplate, deleteTemplate, restorePerson and restoreProject. No named fixture holds the entity their sample needs, and the families were not allowed to edit fixtures. The same gap explains three more items:
    - `addMember` accepts an unknown person id (read as missing at read time, Q7);
    - the property generators for createProject, duplicateProject and rebalanceOrder return null.

    Wave 5 adds the fixtures and removes the marks. The palette completeness check accepts 42 placed phrases while marks remain.
  - **Proposals.** `propose*` payloads carry `source` ("parser" | "agent" | "direct"), so a replay keeps it. `only` takes step ids for subtasks and task ids for other kinds. acceptProposal checks fresh ids outside the proposal.
  - **Moodboard.** addMoodItems now clamps a free spot past the board floor (y 20). v0 could produce an invalid document there. updateMoodItem has captions, because the completeness test requires one.
  - **Focus.** A pinned task wins while it is open, even if blocked, so "Focus on Development" still works in the demo. A blocked pin's why reads "Waits on <task>." The two strongest reasons are joined with " and " (two adjectives) or "; " (clauses).
  - **Brief.** "X starts after Y" names X's last-ending unfinished predecessor, following dependencies. Risk phrases rank by FOCUS_WEIGHTS, at most 2 per task, as in v0.
  - **Migration.** memberIds are every imported person: v0's Team showed all of doc.people. readV0 returns the whole stored value. A missing sample flag reads as "sample", so nothing shows as late. Totality repairs (parent loops, duplicate names, size guards) are each reported.
- **Rejected:** families editing shared fixtures in parallel, which would have caused merge conflicts.

### 2026-10-15 · Wave 5 outcomes (steps 15, 16) and the caption policy
- **Context:** the fast parser port (step 15) and the full property suite with the wave-4 close-out (step 16) merged. Results:
  - no stub is left, and the palette check is strict at 42;
  - addMember is strict;
  - 10,000 runs pass on 4 shards (reducer 142–195 s, planning 94–122 s);
  - the parser matches the frozen v0 parser on 156 of 212 corpus commands, with 56 reviewed differences.
- **Choice (accepted deviations):**
  - **Named fixture.** One named fixture, `demoExtras`, holds the entities several samples need. The property suite has 5 start states, with enriched generated states.
  - **Demo workspace.** It already contains the sample team at 2/4/5 days a week.
  - **Clarify replies.** The parser keeps v0's clarify replies for removing a missing or last view.
  - **Limits.** Estimates are capped at 250 days, and weekly capacities are rounded to half days.
  - **Research's `completedAt`** is the creation time for Done seeds. Unknown would be more honest, but createProject records Done seeds at `now`. It is listed in the seed golden test.
- **Choice (caption policy).** A product review of the 56 differences keeps the honest changes:
  - no-ops say so;
  - capacity is asked for, not invented;
  - dependency bridges are named;
  - status wins over progress.

  It rejects the captions that grew, because the caption is the agent's only voice and must stay one short line. Rules for the composer and the parser, implemented in wave 6:
  1. **Group parts that repeat a template across entities.** "Giulia and Paolo added to the team · capacity not set", not one part per person.
  2. **Drop implied parts.** "X joins the project" is implied when X was added to the team in the same command.
  3. **Demo expansions speak as one.** "Add a sample team" → "Sample team added · Marta, Sara and Luca · Marta over capacity". The per-op assignment parts are not listed.
  4. **A view that opens as a side effect adds no part**, unless it was created ("<View> view added", once). A view's own status sentence ("Marta over capacity", "for the client · composed from the project, nothing invented") is said only when opening that view is the command's intent.
  5. **No-op parts are never swallowed by a view part.** They come first: "The moodboard is already empty".
  6. **The honest sample-dates note comes back** on a timeline birth while the start is unconfirmed.
  7. **At most four parts.**
- **Rejected:** keeping the long concatenated captions as "accurate". Accurate and readable are both required.

### 2026-10-15 · Wave 6 outcomes (step 17 store, caption policy)
- **Context:** the store and the caption policy merged into `phase-1-domain`. The store is built and tested but not mounted yet; the components switch over in wave 7.
- **Store.** Deviations accepted:
  - Undo and redo return the exact documents by reference when they can, and use patches only otherwise. Planning memos keep hitting, and Phase 2 merges still have the patches.
  - Gestures have an explicit cancel.
  - Typed undo, redo and reset say "Nothing to undo/redo/reset" on an empty stack (v0 always said "Undone").
  - The composer closes on done, proposal and info tones.
  - The store is created lazily, so importing it has no server side effects.
  - When `.backup` already holds a different copy, a second unreadable save goes to `.backup.2`…`.9`, and nothing is ever wiped.
  - `CAPTION_PLANNING` is the single planning implementation behind captions, shared by the store, the property runner and the golden harness.
- **Captions.** The rules are implemented in the composer, with every target asserted word for word in `captions.golden.test.ts`:
  - **Expansions** are a typed marker (`sampleTeam`, `demoProject`). The composer renders their summary from the ops that applied, and the parser writes no text.
  - **The sample-dates note** belongs to createProject's own caption. It is said only when the project is born as a timeline with an unconfirmed start.
  - **Side-effect views** carry `reveal: true` and say nothing.
  - **The four-part cap** counts " · " segments and never drops a refusal.
  - **Three captions exceed 120 characters.** All three are v0 wording and are listed, the longest being "Create a timeline for my project" at 126.
- **Rejected:** a fixed notice for the sample dates, because a notice would let the parser assert something about the result.

### 2026-10-15 · Wave 7 outcomes (step 18, component switchover)
- **Context:** the seven component areas and the integration merged into `phase-1-domain`. Every component reads v2 through `lib/store/hooks`. The v0 lib, the Claude route and its SDK dependency are deleted. The components allow-list is enforced by lint.
- **What was checked:**
  - The v0 §15 path runs end to end on the production build in Chromium and WebKit; an asserted 20-step copy has no console errors.
  - All 30 v0 fixtures load and migrate, and `form.workspace.v1` is never written.
  - 2,449 tests pass.
- **Real bug fixed:** Next's production minifier folded `const i = indexOf(d); return prefix[i]` in `planning/calendar.ts` into a read before the horizon grew. In the built app every task read "Too far out to date", while the unminified unit tests passed. Fixed. `calendar.minify.test.ts` runs the module through Next's own SWC minify and compares the results.
- **Choice (accepted deviations):**
  - **Allow-list.** Components may also import, as values, `domain/{limits,money,colours,dates}`, and anything under `lib/domain` and `lib/store/actions` as types. Everything else goes through hooks; useNextViews, useProposalCells, useWorkspacePeople, useCanAddPerson and useHasSamplePerson were added.
  - **Focus lead.** `summaryOf` lives in `planning/format`, and FocusView uses it.
  - **TextMotion** reads reduced motion from the new store.
  - **CommandSheet** keeps v0's hint text, so its pixels match B.
- **Open for step 19 (pixel gate C vs B), not covered by ED-1…ED-10:**
  - **Undo button.** The top-bar Undo is disabled where B had it enabled, because tab switches are no longer history (Q6).
  - **Collage.** The moodboard collage is laid out from item ids, which v2 mints differently, so positions differ.
  - **Page heights** change where ED-4 and ED-5 shorten text, so full-page stills need clipped captures.
  - **Harness hover.** The harness leaves the pointer near the dock after dismissing the ED-10 caption.
  - **Random stream.** v2 mints ids without Math.random, so the seeded stream sits at a different offset (scramble glyphs, agent volumes).

### 2026-10-16 · Wave 8 outcomes (step 19, verification gate) and Phase 1 close
- **Context:** the pixel gate compared the new engine (C) with baseline B. The results are in `docs/PHASE-1-REPORT.md`.
- **Choice:**
  - **ED-11** (Undo availability after tab switches, Q6) and **ED-12** (collage positions from v2 ids) are added to the plan's ED-1 to ED-10. Each is replaced by an explicit assertion (`e2e/expected-diffs.md`).
  - **Text that changes height.** Regions whose height changes by design are collapsed in both builds, and the rest of the page is compared whole at 0 px. Per-element crops of a shifted page can't reach 0 px, because fractional offsets rasterise differently.
  - **Phone retries.** A phone still that differs is captured again in fresh contexts on both builds. It passes only on an exact match, and every retry is recorded. This is Chromium phone-emulation noise, about 1 still in 50.
  - **GPU.** Chromium e2e runs with `--disable-gpu` (`E2E_CHROMIUM_ARGS`) on both builds. A locked screen stalls GPU compositing.
  - **The one regression found** (the timeline start date drawn as one text node instead of v0's three) is fixed, with a test.
  - **Bundle.** The +71.9 KB gzip growth is accepted for Phase 1. Code splitting stays in Phase 6.
- **Phase 1 is closed** on `phase-1-domain` and waits for Nicola's review before Phase 2.
- **Rejected:** loosening the 0-pixel threshold to absorb shifted text.

### 2026-10-16 · Gate hardening after the final-commit run
- **Context:** the full gate run on `380da0b` (`E2E_CHROMIUM_ARGS=--disable-gpu`) passed 90 of 92 stills, although `src/` is byte-identical to `4210fd6`, whose run passed all 92.
  - The failures: `tracker-list` on chromium-phone (6,382 px, text in the glass tabs, the metric eyebrows and the Ask FORM pill) and `brief-client` on webkit-phone (1,966 px, the ground's dot grid in the first viewport).
  - The retry protocol, two captures per build, got the same count in all four comparisons.
  - Four investigations measured both. Each is one page drawn two ways, and B and C draw both:
    - tracker-list: two images over 562 captures; B drew the second in 10 of 281, C in 20 of 281.
    - brief-client: B 12 of 72, C 28 of 72.
  - **Chromium.** A full-page screenshot emulates a 1×1 view before the capture size. When the page is laid out at that view in between, Blink moves the composited glass by a fraction of a pixel and back, and doesn't repaint its text (crbug.com/833083). The path inside Chromium wasn't traced.
  - **WebKit.** The dot grid is drawn from a cached 11 px tile. A snapshot taken right after a layout change can rasterise that tile harder-edged, and the page keeps it. `658bb10` put the first screenshot right after the collapse.
  - This supersedes the "Phone retries" bullet of the Wave 8 entry. What it called Chromium phone-emulation noise is the first quirk, and the second is WebKit's.
- **Choice:**
  - **Hold the document's width during Chromium's full-page stills** (`gate.ts` `hold`), so the page doesn't reflow at the 1×1 view. WebKit doesn't resize the view for a full-page snapshot, so it isn't held.
    - Only the width. The app still gets the capture's `resize` events, and the Ask FORM pill (`useViewport`) moves during a held capture, to whole pixels on tracker-list, and back.
    - The first commit of this hardening also tried to keep `resize` from the app, and this entry said it did. Its capture-phase listener ran after the app's, because Chromium runs the window's listeners in the order they were added, so it stopped nothing. It is removed; the measurements taken with it were in effect the width hold alone.
  - **Wait 200 ms of real time after the collapse** (`COLLAPSE_RENDER_MS`), so the browser renders the collapsed layout before the first screenshot.
  - **Retry protocol unchanged: two captures per build.** After retries the gate JSON names the pair that matched, and `compare.mjs` lists a still that passed only after a retry apart from the clean passes, in its output and in `summary.json`.
  - **Measured** (2 workers, `--disable-gpu`, B writing one reference per repeat, C compared with B's server up):
    - The two stills, 30 times each on both phone projects: C matched B at the first capture in 120 of 120, with no retry. B wrote one image per still in 30 of 30: the baseline bytes for tracker-list, and the first dot image for brief-client. With `380da0b`'s gate in the same harness, run later the same day, tracker-list's first capture differed 8 times in 30, and brief-client's 17 times, 3 of them failing after the retries. A review interleaved the first commit of this hardening (the same first capture as now) with `380da0b`'s gate 25 times: brief-client's first capture differed 0 times against 9.
    - All 23 states on all four projects: 92 of 92 at the first capture. 63 of B's 64 page stills are byte-identical to `e2e/baselines/B.json`; the other, chromium-desktop `palette`, alternates between two images 2 grey levels apart under `380da0b`'s gate too.
    - Sensitivity, with CSS added to C pages only: a 1 CSS px shift of the tab labels in the glass tablist failed 8 of 8, its ink pill 3 levels lighter 4 of 4, and a tablist that gains 1 px of margin after any resize 2 of 2, each after all four pairs. A 1-level change passes, as before (`THRESHOLD`).
    - Cost: a passing still pays two page calls for the hold in Chromium, and 200 ms per collapsed capture. A failing still takes two more reaches of its state, as before: 35 to 52 s, against 12 to 18 s for a passing one.
- **Rejected:**
  - **A third capture per build** (the first version). A review moved the tab labels 1 CSS px down on C's first two page loads only: three captures per build passed it 4 of 4, at C's third capture. With two captures per build the same change fails 8 of 8. With both quirks held off, no still needed a retry, so the third capture bought nothing.
  - **Keeping `resize` from the app** with a listener registered before the app's. It would also hide a candidate whose resize handling changes the page, which the gate sees on chromium-phone because of the capture's resizes.
  - **Holding and waiting before every still, in both engines** (the first version's first draft). On a page at rest the wait was followed by WebKit's second dot image more often: the webkit-desktop composer on C drew it in 5 of 42 captures with the wait, and in 0 of 40 without (Fisher p ≈ 0.055, an observation rather than an established effect).
  - Raising `THRESHOLD`, a pixel budget, or masking the glass text or the dot grid. Each would also hide a real 1 px shift of that text, or a change to the ground.
  - Forcing `will-change: transform` on the glass. It makes the paint independent of history too, but every capture becomes the second image, so B would need new references, and it changes `src/`.
  - Going back to `4210fd6`'s order (an uncollapsed screenshot first). It fixes WebKit, but brings back the screenshot before the collapsed regions are measured (the phone moodboard).
  - More retries alone. At brief-client's rates, three captures per build would still fail about 3.5% of runs, and each extra capture makes an intermittent C-only change likelier to pass.
- **Outcome, full gate on `a82554d`** (4 workers, `E2E_CHROMIUM_ARGS=--disable-gpu`, `compare.mjs` as written): head 145 passed, 0 failed. All 92 stills at 0 differing pixels outside the expected differences; 66 of 66 frames within 0.1% (62 exact, worst 0.047%).
  - 91 stills matched at the first capture.
  - `composer` on webkit-desktop matched only after a retry, and `compare.mjs` listed it apart. Its first capture differed by 16,166 px, the count the hardening had already measured for WebKit's second dot image on that still. That still is a page state, where the gate doesn't wait, by the choice above.
  - So WebKit page stills can still draw that image now and then. The retry absorbs it and the run reports it. Removing it is left to Phase 6 (`docs/PHASE-1-REPORT.md`, Known limits).
