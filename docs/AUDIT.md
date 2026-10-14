# FORM · Phase 0 audit

- **Date:** 14 October 2026
- **Code audited:** `main` at `177e822`, clean tree
- **Branch:** `phase-0-audit`
- **Scope:** FORM-v1 §18, Phase 0
  - map the repo;
  - compare the real operations, reducer, parser and Claude route with `docs/FORM-v0.md` and `docs/FORM-v1.md`;
  - verify the v1 diagnosis (§2);
  - profile performance;
  - run axe and analyse the bundle;
  - confirm the §3.2 decisions.

**No application code was changed in this phase.** The branch adds only `docs/`.

**Method**
- Five parallel audits, each reading the code with file:line evidence and running the real modules (jiti) from scratch scripts:
  - domain and reducer;
  - interpretation pipeline;
  - diagnosis check;
  - performance, bundle and axe;
  - accessibility and contrast.
- Runtime numbers come from a production build served locally and driven by headless Chrome 155 (puppeteer-core + CDP) on an Apple M5, at 1× and 4× CPU throttling.
- Harnesses, fixtures and raw results are in `docs/audit/harness/`.

**Not measured here, and why**
- Safari: automation needs a system setting this audit must not change.
- A mid-range phone: no device attached.
- A live Claude request: no API key, and no paid call without approval.
- Screen-reader behaviour: needs VoiceOver or NVDA by hand.

Each section says how to measure these.

---

## 1. Summary

### What blocks v1 as designed
1. **The reducer is not deterministic.** Six operations mint ids with `Math.random` inside `applyOperation`: createProject, addTask, acceptProposal, addPerson, addBriefLine, addMoodItems. The same op on the same document gives a different document. §10.2 ("the server re-applies the same reducer", client replay after a 409) cannot work until ids travel inside the op payload. Inputs are never mutated and no clock is read, so the rest of the reducer is sound.
2. **The output schema sent to Claude is already past the documented limits.**
   - It has 43 optional parameters (limit 24) and 18 union-typed parameters (limit 16).
   - The installed SDK helper (`@anthropic-ai/sdk` 0.133.0, `transform-json-schema.js`) moves `enum` and `const` into `description`. The API supports them; this helper drops them. So op names and enum values are not grammar-constrained.
   - If a key is ever set, the Claude path probably fails on every command and silently falls back to the parser.
   - v1 §9.4 is therefore a requirement, not an option. The schemas must be built by hand and asserted in a test.
   - Confirm with one keyed request.
3. **No tests exist.** There is no test runner and no test dependency. The v1 §15 property suite has to start from zero, and it assumes item 1 is fixed.

### Risks in the live v0 deployment (outside the phase plan)
4. **Silent loss of the whole workspace.** Four reachable edits produce a document that `DocSchema` rejects:
   - a project title over 80 characters (the inline editor allows 140);
   - more than 20 people ("Add person" has no cap);
   - more than 200 moodboard items (repeated drops);
   - "Arrange" on tall, narrow notes (output not clamped).

   On the next load the store drops the document without a word, and the first state change overwrites localStorage. Verified end to end. See §3 for a proposed hotfix.
5. **`/api/interpret` has no authentication and no rate limit**, and it accepts an unbounded document. If `ANTHROPIC_API_KEY` is set on Vercel, anyone can spend it. It is unknown whether it is set.

### Model and honesty
6. **Captions are not composed from applied operations, in either engine.** Claude writes its own `message`, kept even when the sanitizer drops every op. Parser captions are written before the reducer runs. One demo caption is false today: breaking down a 3-day task proposes 4 × 1 day and says "fits its 3d estimate". No-op commands still record an undo step and claim a change.
7. **Status and progress are not always coherent.** Five reachable incoherences were measured, for example "mark UI Design done at 40%" gives Done at 40%, and dragging an In-review task's slider through 100% ends In progress.
8. **The schedule counts weekends and treats unknown durations as zero.**
   - Visual Direction runs Thu 1 → Sun 4 Oct, and Development ends Sun 18 Oct. On working days it would end Mon 26 Oct.
   - Clearing an estimate pulls the following tasks earlier, with dates that look certain.
9. **Routing is inverted, with no timeout.** With a key, every command goes to Claude, including "undo" and palette items. The SDK default is a 10-minute timeout with 2 retries, while the UI blocks input.
10. **The parser gives confident wrong answers to future v1 commands**, so it cannot become the fast lane as it is:
    - "Set the deadline to 30 November", "Level the schedule" and "Zoom the timeline to weeks" open the Timeline;
    - "Budget is 12k" sets a €12,000 cost on the selected task;
    - "Start QA on the 10th" marks the selected task In progress;
    - "UI Design is finished, move on to Development" marks Development Done.

### Performance (v1 §12 targets)
11. **Initial JS is 307.8 KB gzip against 180 KB (+71%)**, with no code splitting at all. The framework alone is about 135 KB.
12. **The agent's animation loop never stops.**
    - At rest it makes 3,000 SVG attribute writes per second, also under reduced motion.
    - The full-viewport goo filter repaints the whole page every frame.
    - Hiding the agent cuts renderer main-thread time from 108 to 22 ms/s with 60 cards.
13. **Derived data is super-linear.** At 150 tasks, `focusPick` takes about 150 ms and `composeBrief` about 300 ms, on every change.
14. **With 60 tasks, view switches fail INP at 4× CPU.** Board takes 424 ms, tracker 296–352 ms. The tracker carries 67 `backdrop-filter` elements, and card blur is about 2/3 of GPU time at rest. Lab LCP with mobile throttling is 4–5 s, because the HTML is client-only and six fonts are preloaded (three unused).

### Accessibility (WCAG 2.2 AA)
15. **The tertiary text token (`--text-3`, ink 38%) is 2.5:1 on every surface.** It is used 79 times. Dimmed tasks bring even primary text below 4.5:1. Red as text is 2.9–3.2:1. Fixing this changes the v0 look, which conflicts with v1 §0.5 "no visual regressions" (question Q14).
16. **axe flags `aria-prohibited-attr` in 8 of 9 states.** Animated text puts its content in `aria-label` on role-less spans, so the caption (the agent's only voice) is probably silent to screen readers.
17. **Not keyboard-operable:**
    - popovers and menus;
    - Team segments;
    - moodboard tiles.

    Priority dots (13×18 px, touching) fail 2.5.8. The caption timer does not pause.

### The v1 diagnosis (§2)
- 22 of 23 points are confirmed; points 18 and 22 are worse than stated.
- **#20 is partial.** Birth volumes are already capped at 6, not one per card, and board cards have no blur (only lanes do).
- **#21:** the token is 38%, not 40%.

Details in §8.

---

## 2. Decisions confirmed (v1 §3.2)

Confirmed by Nicola on 14 October 2026. Recorded in `docs/DECISIONS.md`.

| # | Decision | Choice |
|---|---|---|
| 1–2 | Auth and data | Better Auth (Drizzle adapter, magic link via Resend, Google) · Neon Postgres + Drizzle · Vercel Blob (private) · Upstash |
| 3 | Language | UI and captions in English; commands in English and Italian |
| 4 | Collaboration | One user per workspace; outside sharing only through the brief link |
| 5 | Demo | Stays public at `/demo` |

Process note: there is no `gh` or `vercel` CLI on this machine. Each phase is pushed as a branch, and the report gives the compare URL for the PR (DECISIONS.md).

---

## 3. Proposed: v0 safety patch before Phase 1

This is outside the phase plan. It needs your yes, because it would go to `main` (the live demo) rather than to a phase branch. Small, one commit:

1. **Enforce document limits where edits happen:**
   - the title editor at 80 characters;
   - "Add person" stops at 20;
   - moodboard adds stop at 200;
   - `arrangeMood` clamps its output to the schema bounds.
2. **Never wipe the workspace on a failed load.** Copy the raw saved value to `form.workspace.v1.backup`, then keep the parsed-or-empty document. This makes the v2 importer (§5.8) able to salvage it later.
3. **`/api/interpret`.** If a key is configured in production: answer `available:false` unless `FORM_ENGINE=claude` is set explicitly, and cap the document size. Or simply confirm that no key is set.

---

## 4. Questions for Nicola

Each has a proposed default. "OK to the defaults" answers all of them. They are grouped by the phase that needs the answer.

### Before Phase 1 (domain)
| # | Question | Proposed default |
|---|---|---|
| Q1 | v1 Step has no estimate, but v0 steps carry estimates that the timeline and proposals use. | Keep an optional `estimateDays` on Step (null by default); the timeline uses it only inside the parent's window. |
| Q2 | Normalising incoherent v0 tasks on import: which field wins? | Status wins. Done ⇒ 100; To do ⇒ 0 unless progress > 0, then In progress. `completedAt` is null for imported Done tasks (unknown), never invented. |
| Q3 | Defaults for capacity and duration. v0 invents 10 days ("Add person") and 1 day ("+ Duration"); v1 §5.3 defaults capacity to 5/week. | Capacity 5 days/week shown as an editable default when a person is created, accepted as a visible choice. "+ Duration" opens the editor empty instead of setting 1 day. |
| Q4 | Import the v0 document into `/app`? It is almost always the sample template with sample people and dates. | Offer the import, but flag sample data. People named Marta, Sara and Luca with the sample ids are imported only if the user ticks "Include sample team". |
| Q5 | v0 estimates are calendar days ("2 weeks" = 14). | Keep the numbers as working days and show the one-off caption "Schedule now skips weekends". No ×5/7 conversion. |
| Q6 | View state (tab, sort, density, filters, focus pin): synced commits in the undo stack, as in v0, or URL and local state, per v1 §4 `replaceState`? | Views created and removed, plus blocks, stay as commits (they are content). Active tab, selection and zoom go into the URL and are not undoable. Sort, density, filters and focus pin are commits, but excluded from Activity. |
| Q7 | Cross-document invariants: owner exists in the workspace, archive unassigns across projects, cost derived from day rate. | Compute them at read time (selectors), never stored. Archiving a person doesn't rewrite projects; open tasks show "Owner archived" until reassigned. |
| Q8 | Hard delete of a person, beyond `archivePerson`. | Yes, only from Settings, only when the person owns no task; GDPR deletion goes through account deletion. |
| Q9 | Where do index-level ops (create, duplicate, archive, delete project) commit? | On the workspace document, which keeps the project index; the project document is created or flagged by the same server transaction. |
| Q10 | Re-mint ids at import (`t-ui` → `tsk_…`), rewriting owners, order, parents, proposals and brief keys? | Yes, all at once, with a tested mapping function. |
| Q11 | Task title limit: v0 140, v1 120. | 140 in v2. Nothing to truncate, and 120 had no reason given. |
| Q12 | §16 has no op for `setFields`, `setStartDate`, the workspace name, timezone, currency or opt-in, or for editing a template. | Fold `setFields` into `setView`; `setStartDate` into `updateProject`; add `updateWorkspace(field)` and `updateTemplate`. |
| Q13 | `/demo` in Phase 1: switch to working days (Development then ends 26 Oct)? Unknown durations blocking successors? The one-off caption? | Yes to working days and to unknown blocking. The caption shows once in `/demo` too. |
| Q14 | Contrast fixes visibly change v0. Do they override "no visual regressions" (§0.5)? | Yes. They land in Phase 1 as token changes with before/after screenshots: `--text-3` 38% → 60%, dimming applied to the surface instead of the text, red as text → `#b81f17`. |
| Q15 | Will `/app` live on the same origin as today's demo, so the importer can read localStorage and IndexedDB? | Yes, same Vercel project and domain, `/demo` beside `/app`. |

### Before Phase 5 (agent)
| # | Question | Proposed default |
|---|---|---|
| Q16 | Is `ANTHROPIC_API_KEY` set on Vercel today? May we make a few paid smoke requests (cents) to confirm the schema rejection and measure latency? | You check the env. Smoke requests happen at the start of Phase 5, with a preview key. |
| Q17 | Fast-lane confidence model. | Tiers: exact palette phrase 1.0, anchored template 0.9, keyword rule 0.5. The threshold lives in config (default 0.85). Any leftover content word lowers the score. |
| Q18 | Remove the parser's "budget" and "comparison" refusals, so those commands reach Claude and the Budget block? | Yes. |
| Q19 | Keep the 340 ms "processing" beat for fast-lane commands? | No for view, sort and undo (instant). Yes for commands that change content, so the shape change reads. |
| Q20 | Step breakdown: keep the deterministic website step library outside `/demo`? | Only in `/demo`. The app uses Claude `propose`. |
| Q21 | Forced `tool_choice` returns 400 on Opus 5.5 and Sonnet 5.5 (confirmed in the current API docs). Accept `tool_choice: auto` with strict tools, a prompt rule, and server handling of a text-only reply as a decline? | Yes. |

### Before Phase 6 (performance, accessibility, launch)
| # | Question | Proposed default |
|---|---|---|
| Q22 | Does the 180 KB budget include the framework (about 135 KB here)? | App code only: ≤ 180 KB gzip on top of the framework for the project route, measured as served (brotli). |
| Q23 | Which device is the mid-range phone, and who runs the Safari/Instruments protocol? | iPhone 13 (Safari) and Pixel 6a (Chrome); Nicola runs the Safari protocol described in §11 ("Safari and real devices"). |
| Q24 | Fonts: drop the three unused faces, and move from `display: block` to `swap` with a size-adjusted fallback? | Yes to both. |
| Q25 | Server-render a static shell (header and skeleton) for LCP? | Yes, for `/app` routes. `/demo` keeps the client-only birth. |
| Q26 | Reduced motion: render the agent as a static SVG with no animation loop? | Yes. |
| Q27 | Priority dots and 2.5.8: (a) one 24 px control with the dots as its face plus a menu, or (b) dots spread to a 24 px pitch? | (a). The drawing stays identical. |
| Q28 | Captions: stop auto-dismissing proposals and clarifications? | Yes, they stay until acted on. Others pause on hover and focus. |
| Q29 | Ambient motion (Focus floats, agent breathing): stop after settling? | Yes, it resumes on pointer movement near the agent. |
| Q30 | Moodboard keyboard order. | Reading order (top-left to bottom-right). Accessible name: note text, colour name or hex, "Image n". |
| Q31 | Font licence. | Needs the CoType licence documents (web/app use, self-hosted woff2, repository hosting, preview domains), and whether the GitHub repo is public. This is a launch blocker until then. |

---

## 5. Updated phase plan

The phases follow v1 §18. Additions from this audit are marked **+**.

### Phase 0 · Audit (this branch)
This document, the reference docs, `DECISIONS.md` and the audit harnesses. Then stop.

### Phase 1 · Domain
As in v1, plus:
- **+** The test infrastructure comes first: Vitest and fast-check, with the audit harnesses moved into `scripts/` and `e2e/`.
- **+** Deterministic reducer:
  - ids are minted by the action creator and carried in the op;
  - the reducer rejects an existing id instead of re-minting;
  - `commit.createdAt` is passed in as context for timestamps.
- **+** Every commit is validated with Zod, whatever its source.
- **+** The reducer returns `{doc, rejected?: reason}`, and no-ops are detected, so they create no history and claim no change.
- **+** Invariants are normalised after every patch shape, including the five measured incoherences.
- **+** Captions are composed from applied ops through the registry (§16), for both engines, from Phase 1 on.
- **+** Scheduling, focus and brief computations are O(n log n) or better and memoised by document version. Target at 150 tasks: under 8 ms.
- **+** Unknown durations propagate "unknown" to their successors.
- **+** The agent's animation loop stops when the material is settled and in reduced motion, and the goo filter region is limited to the agent box. This is cheap, and `/demo` is rebuilt in this phase anyway.
- **+** Contrast tokens (Q14).

### Phase 2 · Backend and sync
As in v1, plus:
- **+** The importer reads raw `form.workspace.v1` (and `.backup`) before any v0 store hydrates, with a lenient salvage parse.
- **+** Only blobs referenced by `doc.mood` are uploaded; missing blobs are reported.
- **+** SVGs are rasterised before upload.
- **+** `/api/interpret` gets auth and a rate limit as soon as auth exists, even before Phase 5.

### Phase 3 · Real projects
As in v1, plus:
- **+** The popover/menu primitive is fixed first (focus management, roving arrows, focus returned to the anchor, reposition rather than close on scroll), because Phase 3 adds many more menus.
- **+** Keyboard paths for the Team ("Move to…") and the moodboard (arrows and Alt+arrows).
- **+** The tabs pattern with manual activation.

### Phase 4 · Planning in the views
As in v1, plus:
- **+** The Timeline stops rendering one element per calendar day: per-week rendering at Week/Month zoom, and virtualised rows.
- **+** Focus is capped at 7 volumes plus "+N", done tasks excluded.

### Phase 5 · Agent v2
As in v1, plus:
- **+** JSON schemas are built by hand (never `betaZodOutputFormat`'s transform), with a test that asserts the wire payload and the §9.4 limits.
- **+** `tool_choice: auto` with strict tools (forced choice is a 400 on Opus 5.5 and Sonnet 5.5).
- **+** The stop reason is checked before parsing (refusal, max_tokens).
- **+** An AbortSignal timeout on the client and on the SDK.
- **+** The parser's broad keyword triggers are narrowed (deadline, level, zoom, budget, start), and multi-entity sentences go to Claude or a clarify.

### Phase 6 · Hardening and launch
As in v1, plus:
- **+** Code splitting from 307.8 KB (`next/dynamic` views, lazy GSAP and SplitText, `LazyMotion`, a lighter Zod on the client).
- **+** Blur only on floating layers (TaskCard blur removed; lanes and panels on flat translucent fill).
- **+** An SSR shell.
- **+** The caption gets a permanent sr-only live region, replacing `aria-label` on spans.
- **+** The font-licence gate.

---

## 6. Corrections to `docs/FORM-v1.md` (facts, not scope)

- **§2 #20:** birth volumes are already capped at 6 (`Workspace.tsx:21`, `CardsView.tsx:35`), not one per card. Board cards have no `backdrop-filter`; only lanes and panels do. The blur to remove is `TaskCard.tsx:123`.
- **§2 #21:** `--text-3` is 38% (2.49:1), not 40%.
- **§3.1:** the repo runs React 19.3.0 and Next 16.4.0, not React 19.2. `cacheComponents` and `partialPrefetching` are already on. React Compiler is not enabled.
- **§13:** the proposed red text token `#c0221a` passes on paper (4.95:1) but fails on `paper-lo` (4.38) and on ink (3.29). `#b81f17` passes on every light surface (4.70–6.31). See §12.
- **§16:** see Q12 for missing ops. Index-level ops cannot be single-project commits (Q9).
- **§5.7 vs §10.2:** cross-document invariants cannot be enforced by single-document commits (Q7).

## 7. Corrections to `docs/FORM-v0.md`

23 inaccuracies, listed at the end of `docs/FORM-v0.md` under "Errata". The most misleading are corrected in its text:
- honesty defaults;
- reducer determinism;
- status/progress coherence;
- the engine indicator;
- Claude fallback and route security;
- silent wipe on load;
- the image format;
- focus scoring.

---
## 8. Verification of the v1 diagnosis (§2, points 1–23)

**Method.** I read the code at HEAD `177e822` (clean tree). I computed derived values by loading `src/lib/*` through jiti from a scratch directory, without touching the repo. "Today" is 2026-10-14 (browser-local `new Date()`, as the app uses). Ratios follow WCAG 2.x relative luminance. Alpha is composited over the token backgrounds.

#### Summary

| # | Point | Verdict | Nuance |
|---|---|---|---|
| 1 | Same 4-task website for every request | CONFIRMED | It also brings in the sample team and the sample start date. It only applies to phrases the parser recognises as "create" ("Help me organise my wedding" creates nothing). |
| 2 | One project at a time | CONFIRMED | A replacement can be undone, but only in-session (60 steps). After a reload the old project is gone. |
| 3 | Browser-only persistence | CONFIRMED | Also: images are never deleted from IndexedDB, and a schema-invalid save silently drops the whole workspace. |
| 4 | People inside the project | CONFIRMED | `createProject` overwrites `people` with the sample team. |
| 5 | Calendar days, not working days | CONFIRMED | Visual Direction runs Thu 1 → Sun 4 Oct. Development runs Sun 11 → Sun 18 Oct. 6 of the 21 scheduled days are weekend days. |
| 6 | Sequential only | CONFIRMED | Worse than stated: a task with no estimate takes 0 days, so the tasks after it get definite, earlier dates. |
| 7 | Capacity without a period | CONFIRMED | Load also counts the **full** estimate whatever the progress: 85%-done Visual Direction still counts 4d. |
| 8 | No deadline; "late" depends on the day | CONFIRMED | On 28 Sep UI Design is not late. From 11 Oct onward it is "Overdue on the sample schedule · ended 10 Oct". |
| 9 | Focus can pick a blocked task | CONFIRMED | There is no dependency model at all. "X waits on it" is positional: every later To-do task. |
| 10 | Balancing is role-blind | CONFIRMED | Reproduced: art director work goes to the developer. It also moves In-review tasks. |
| 11 | 100% always means Done | CONFIRMED | Plus four more status/progress incoherences (below). |
| 12 | Incomplete parity | CONFIRMED | `moveTask` exists in the vocabulary but no UI or parser path emits it. |
| 13 | No place for task details | CONFIRMED | Task has no description, links, due date or dependencies. |
| 14 | Weak filters | CONFIRMED | "Urgent" is a highlight that dims cards, not a filter. "Hide done" is the only real filter. |
| 15 | No deep links | CONFIRMED | One route; no URL state anywhere. |
| 16 | Parser is English-only and pattern-bound | CONFIRMED | It also mis-targets: "UI Design is finished, move on to Development" marks **Development** Done. |
| 17 | Routing is inverted | CONFIRMED | Only the view nodes are forced to the parser. ⌘Z and the top-bar Undo skip the interpreter entirely. |
| 18 | The schema won't scale | CONFIRMED, stronger | It **already** exceeds both documented limits: 43 optional params (limit 24) and 18 union params (limit 16). |
| 19 | Captions are written by the model | CONFIRMED | Demo-parser captions are not derived from applied ops either. One of them is false today. |
| 20 | Designed for 4 tasks and 3 people | PARTIAL | Core claim holds and is measured. Two sub-claims are wrong: birth volumes are **already capped at 6**, and board cards have no `backdrop-filter`. |
| 21 | Contrast | CONFIRMED | The real token is 38%, not 40%: 2.49:1 on paper. The red-graphics-below-3:1 claim holds only directly on paper. |
| 22 | Known accessibility gaps | CONFIRMED | Worse: Team segments and moodboard tiles cannot be reached by keyboard at all. The priority dots fail 2.5.8. |
| 23 | Font licence | CONFIRMED (open risk) | Cannot be verified from the repo. The fonts are self-converted woff2 files committed to git. |

#### A. Structural limits

**1.** `ops.ts:31-44` always builds `websiteTemplate(op.title)`. Both `ToolSchema.template` and the `createProject` op are `z.literal("website")` (`schema.ts:89`, `schema.ts:206`), so the Claude path cannot produce anything else either. Measured outputs:
- "Create a board for my brand identity for Forno Rossi" gives title "Brand identity for Forno Rossi", tasks [Research, Visual Direction, UI Design, Development] and people [Marta, Sara, Luca].
- The caption note "Demo mode ships one template" is added only when a non-web subject is named (`demo.ts:109`).
- "Help me organise my wedding" fails the create regex (`demo.ts:83-85`) and answers "Nothing to shape yet" (`demo.ts:114-116`).

**2.** The doc holds a single `tool: ToolSchema.nullable()` (`schema.ts:171`). `createProject` replaces tasks, people, mood and brief wholesale (`ops.ts:33-44`), and `replacesProject` gates it (`views.ts:67-71`). Undo history is session-only and capped at 60 (`store.ts:52`, `store.ts:211`, `store.ts:343`).

**3.**
- The doc and log are persisted to localStorage under `form.workspace.v1` (`store.ts:340-343`).
- Images go to IndexedDB `form-assets` (`assets.ts:12-29`).
- There is no delete path in `assets.ts`, so removed or cleared items and replaced projects leave orphaned blobs.
- If `DocSchema.safeParse` fails on load, the saved doc is silently replaced by an empty one (`store.ts:344-348`): no backup, no notice.

**4.** `people` is a field of the project doc (`schema.ts:179`). `PersonSchema.capacity` is documented as "Working days available for this project" (`schema.ts:37`). `createProject` installs `sampleTeam()` (`ops.ts:41`, `seed.ts:79-85`).

#### B. Planning model errors

**5.** `schedule()` advances a calendar-day cursor (`selectors.ts:109-129`). The Timeline turns slots into dates with `addDays` (`TimelineView.tsx:149-155`). It shades weekends (`TimelineView.tsx:57`, `TimelineView.tsx:87`) but still counts them. Computed from `SAMPLE_START_DATE = "2026-09-28"` (Mon, `seed.ts:29`):

| Task | Est. | Code | Weekend days counted | Same estimates on Mon–Fri |
|---|---|---|---|---|
| Research | 3d | Mon 28 Sep → Wed 30 Sep | none | 28 Sep → 30 Sep |
| Visual Direction | 4d | Thu 1 Oct → **Sun 4 Oct** | Sat 3, Sun 4 | 1 Oct → Tue 6 Oct |
| UI Design | 6d | Mon 5 Oct → **Sat 10 Oct** | Sat 10 | Wed 7 → Wed 14 Oct |
| Development | 8d | **Sun 11 Oct → Sun 18 Oct** | Sun 11, Sat 17, Sun 18 | Thu 15 → Mon 26 Oct |

A working-day schedule ends 8 calendar days later (26 Oct, not 18 Oct). Moving to working days will therefore change every v0 date, the "overdue" reasons and the brief.

**6.** Tasks run one after another in `doc.order` (`selectors.ts:113-127`). There is no `dependsOn` field anywhere (`schema.ts:10-27`).
- Steps run back to back inside the parent from its start (`selectors.ts:119-125`), with no clamp, so they can overflow the parent bar.
- A task with no estimate is skipped without advancing the cursor (`selectors.ts:114-117`). Measured: if UI Design's estimate is cleared, Development moves from 11 Oct to 5 Oct with definite dates. This contradicts v1 §7.2 ("successors have unknown dates").

**7.** `loadsOf` sums `t.estimate` over open top-level tasks, with no time window and no progress discount (`team.ts:31-47`, line 35). Marta's "10/7d · 3d over" counts all 4d of Visual Direction although it is 85% done.

**8.** `ToolSchema` has no deadline (`schema.ts:86-107`). Overdue is `today ≥ derived end` (`focus.ts:46-51`), with today taken from the browser clock (`focus.ts:34`, `TimelineView.tsx:35`). Measured top Focus reasons for UI Design:
- On 2026-09-28: Urgent 40, In progress 15, waits 5.
- On 2026-10-14 and on 2027-01-15: Urgent 40, **Overdue on the sample schedule · ended 10 Oct** 35, In progress 15.

**9.** `focusPick` scores every open top-level task (`focus.ts:66-84`). Nothing checks predecessors, because none exist.
- "X waits on it" is 5 × every later **To-do** task in workflow order, named after the first one (`focus.ts:60-61`).
- Reproduced with start 2026-11-02, Visual Direction done, UI Design Low and Development Urgent: Development scores 40 and UI Design 24, so Development is chosen while UI Design is In progress at 30%.

**10.** `roomiest()` filters and sorts on free capacity only (`team.ts:59-64`). Candidates are any non-done task owned by the most-overloaded person, least progress first (`team.ts:74`).
- With Luca's capacity set to 20, the plan is "UI Design (Art director's task) → Luca (Developer)".
- With Marta at 2d and UI Design done, it proposes moving **In-review** Visual Direction (85%) to Sara.

**11.** `progress ≥ 100 → status "done"` unconditionally (`ops.ts:73-74`). Other reducer results, measured:

| Change | Result |
|---|---|
| Patch `{status:"done", progress:40}` | Done at 40% (`ops.ts:71`: coercion only when one field is set) |
| Done → In review | In review at 100% |
| Done → In progress | In progress at 100% |
| To do → In review | In review at 0% |
| In-review task, slider dragged 90 → 95 → **100** → 95 → 90 (live updates, `parts.tsx:226-230`) | Ends **In progress / 90**: the review status is lost |

#### C. Interaction

**12.** View controls are limited to Sort, Compact, Hide done and Urgent (`blocks.tsx:202-273`). Layout, columns and field visibility are reachable only through the parser (`demo.ts:318-402`).
- The board has no drag-and-drop. Its lane arrows are `opacity-0` until hover or focus (`BoardView.tsx:126-127`, `BoardView.tsx:148`).
- `moveTask` is defined (`schema.ts:225`, `ops.ts:113-119`), but the UI and parser never emit it; only Claude could.
- The start date moves only ±7 days (`TimelineView.tsx:262-267`).
- In the Team view, the only direct edits are "Add person" and renaming (`TeamView.tsx:161`, `TeamView.tsx:337`). Capacity and role are command-only (`demo.ts:720-724`).

**13.** `TaskSchema` (`schema.ts:10-27`) has title, status, priority, progress, estimate, cost, parentId, emphasis, origin and owner, and nothing else. No detail panel component exists.

**14.** `ViewSchema` has only `hideDone` and `highlightUrgent` (`schema.ts:68-84`). `visibleTasks` filters only on `hideDone` (`selectors.ts:23`). `highlightUrgent` dims the other cards (`TaskCard.tsx:32`, `TaskCard.tsx:104`) and removes nothing.

**15.** The only route is `src/app/page.tsx`, which renders `<ClientRoot/>`. There is no `useSearchParams`, router, or `history.*State` anywhere in `src/`.

#### D. Agent

**16.** The parser is pure English regex (`demo.ts:38-440`). Results measured:
- "Sposta lo sviluppo a lunedì", "Segna UI Design come fatto", "Chi è sovraccarico la prossima settimana?", "Fammi il brief per il cliente", "annulla": all unsupported.
- Mis-targeting: `findNamedTask` takes the longest title mentioned (`demo.ts:818-827`). "UI Design is finished, move on to Development" therefore produces `updateTask(t-dev, done)` with caption "Development → Done".

**17.** Commands routed to Claude once a key is present:
- `FormApp.tsx:28-33` switches the session engine to `"claude"` when `GET /api/interpret` reports a key. `store.ts:148` then sends **every** `submit` to Claude, including typed "undo" and "redo" (which the parser handles at `demo.ts:55-56`).
- This covers palette items (`Composer.tsx:264` → `run` → `submit`, `Composer.tsx:85`), suggestion chips (`Composer.tsx:137`), Focus "Break it down" (`FocusView.tsx:171`) and Team "Balance with FORM" (`TeamView.tsx:170`).
- Only the view nodes force the parser (`AgentLayer.tsx:173`).
- ⌘Z, ⇧⌘Z and the top-bar buttons call `store.undo/redo` directly (`FormApp.tsx:41-45`).

Related facts:
- The palette footer always says "Demo parser · deterministic" (`CommandSheet.tsx:91`), even when its items go to Claude.
- Each call sends the whole doc (`interpret/index.ts:29`) with `max_tokens: 8000` (`claude.server.ts:140`).
- `/api/interpret` has no authentication or rate limit and accepts any client-supplied doc (`route.ts:6-31`).

**18.** `InterpretationSchema` wraps a 35-variant discriminated union (`schema.ts:202-271`) and is sent through `betaZodOutputFormat` (`claude.server.ts:142`). I compiled it with the installed SDK (0.133.0) transform:
- 12 KB of JSON, 14 `$defs`.
- **43 optional properties** and **18 union-typed parameters**, counting each `$def` once.
- The current docs (platform.claude.com structured outputs) set **24 optional** and **16 union** parameters, summed across all strict and JSON-output schemas in a request.
- Unsupported keywords (min/max, minLength/maxLength, pattern, maxItems, minItems > 1) are **not** a blocker: the SDK moves them into descriptions (`node_modules/@anthropic-ai/sdk/lib/transform-json-schema.js`), and Zod re-validates on the client.
- No recursion.

So the schema does not merely risk outgrowing the limits; on paper it is already over both. Whether the API rejects it today cannot be measured here (no key; network calls not made). If it does, every Claude command 502s at `route.ts:29` and ends with " · Claude unavailable, demo parser used". To measure: in a preview with `ANTHROPIC_API_KEY`, send one command and read the upstream error message, which `route.ts` currently discards.

**19.** The caption comes from model output: `InterpretationSchema.message`, system prompt rule at `claude.server.ts:30`, rendered at `store.ts:188`.
- `sanitise()` can drop ops while the message is kept unchanged (`claude.server.ts:160`).
- Demo-parser captions are written before the reducer runs, so they are not derived from applied ops either:
  - "Mark Research done" on a Done task still shows "Research → Done". It also records an undo step, because `updateTask` always returns a new object (`ops.ts:69`) and `commit` compares references only (`store.ts:204`).
  - Breaking down a 3d "Copywriting" proposes 4 × 1d = 4d, yet the caption says **"fits its 3d estimate"** (`demo.ts:164`, `library.ts:52-63`). That caption is false today.

#### E. Scale, performance, accessibility, licences

**20. Per-card blur.** `backdrop-blur-[22px]` is on every tracker card (`TaskCard.tsx:123`) and every moodboard note (`.glass-hi`, `Moodboard.tsx:487`). Board cards use a flat 72% white with no blur (`BoardView.tsx:94`); only the 4 lanes use `.glass`.

**Focus.** There is one goo-fused volume per top-level task, **done tasks included** unless "Hide done" is on (`FocusView.tsx:27`, `FocusView.tsx:280-307`). Each volume has two infinite tweens (`FocusView.tsx:190-193`), all inside one SVG goo filter (`FocusView.tsx:255`).

**Birth (v1 wording is INCORRECT here).** Spawn is already capped at 6 (`CardsView.tsx:35`, `BoardView.tsx:29`, `TimelineView.tsx:141`, `Workspace.tsx:21`). The choreography length is hard-coded for 4 cards: `CREATE_TOTAL_MS = createRevealAt(3)…` (`motion.ts:37`).

**Timeline.** It has no virtualization. It renders one div and one label per calendar day plus every row (`TimelineView.tsx:54-58`, `80-91`, `122-131`, `137`), with chart width = days × 24px (`TimelineView.tsx:43`). At 150 tasks the schedule spans 461 days, about 11,000px.

**Derived computations (Node, this Mac, tasks + 3 steps each):**

| Tasks | `focusPick` | `composeBrief` |
|---|---|---|
| 30 | 1.1 ms | 2.0 ms |
| 60 | 6.3 ms | 12.8 ms |
| 150 | **89 ms** | **179 ms** |

These grow fast because `reasonsFor` re-runs `schedule()` for every task (`focus.ts:44`), and `subtasksOf` scans every task each time (`selectors.ts:7-9`). Every view subscribes to the whole doc (`CardsView.tsx:14`, `BoardView.tsx:16`, `TimelineView.tsx:26`, `FocusView.tsx:25`). Each card also runs an O(n) selector (`TaskCard.tsx:97`).

Frame time, Safari compositing and phone timings cannot be measured here. Measure with the Chrome and Safari Performance panels on a 60-task doc injected through `window.__form` (`FormApp.tsx:23-25`, dev only), on desktop and a mid-range phone.

**21.** Tokens are `--text-2` 58%, `--text-3` **38%** and `--text-4` 20% (`globals.css:23-25`). `text-3`/`c-fg-3` appears 79 times in `src/components`.

| Pair | Ratio |
|---|---|
| ink 38% on paper `#e9e9e6` / on glass card / on glass-hi | **2.49** / 2.53 / 2.54 |
| ink 40% on paper (v1 figure) | 2.64 |
| ink 58% on paper / on paper-lo `#dcdcd8` (vignette edge) | 4.61 / **4.43** |
| min ink alpha for 4.5:1 on paper / on glass | 57.5% / 56.5% |
| `#ff3b2f` on paper / glass card / glass-hi | **2.92** / 3.24 / 3.36 |
| `#c0221a` on paper (v1 §13 proposal) | 4.95 |
| Dimmed tracker card (whole card at opacity .55): ink 100% / 58% / 38% text | **4.42** / **2.16** / **1.62** |
| Dimmed board card title / meta | 4.52 / 1.62 |
| on-ink 34% on ink (e.g. "Next", "Complete", placeholders) | 2.85 |

- Red is used as **text** in two places: the 9.5px "Urgent" label (`TaskCard.tsx:183`) and "+Nd over" (`TeamView.tsx:485`). Both sit on glass at 3.24, which fails 4.5:1.
- Red graphics mostly sit on glass or white at 3.2–3.4, which passes 3:1 narrowly. The "below 3:1 for graphics" claim holds only for red directly on paper.

**22.**
- **Intro:** `aria-modal` and initial focus are set, but there is no Tab trap (`Intro.tsx:56-67`, `Intro.tsx:84-90`).
- **View tabs:** `role="tab"` without roving tabindex, arrow keys, `aria-controls` or a tabpanel (`blocks.tsx:152`, `blocks.tsx:164-199`).
- **Team segments:** a `motion.div` with only `onPointerDown`, no tabIndex and no role (`TeamView.tsx:433-446`). They cannot even be selected for Point & Ask by keyboard.
- **Moodboard tiles:** pointer-only and not focusable (`Moodboard.tsx:370-397`).
- **Board:** has no drag, so 2.5.7 applies to the Team, Moodboard and Progress slider (the slider has keyboard support).
- **Priority dots:** each is a 13×18px button with no gap (`parts.tsx:184`). Centres 13px apart means 24px circles overlap, so they **fail 2.5.8**.
- **Not listed in v0 or v1 §2:**
  - The command sheet is `role="dialog"` without focus management (`CommandSheet.tsx:27-29`).
  - The caption timer does not pause on hover or focus (`Caption.tsx:30-35`).
  - Global `:focus{outline:none}` (`globals.css:276-278`) relies on each component adding `.focus-ring`.

**23.**
- Six faces are committed to git (`src/fonts/*.woff2`): Aeonik Pro and Aeonik Mono Pro, weights 300/400/500 each.
- `README.md:65` says they were "converted from the licensed Pro files".
- There is no licence file in the repo, and the remote is `github.com/nicolaromei98/form`.
- Format conversion, web/app embedding and redistribution through a repository are each governed by the EULA. None of this can be verified from code.
- Weight 300 (both families) and Mono 500 are never used.
- `display: "block"` with `adjustFontFallback: false` (`layout.tsx:6-30`) is also relevant to v1 §12.7.

### Where the v0 context document is inaccurate or incomplete

1. **Honesty claim "capacities are never invented" is false.**
   - `addPerson` defaults to 10 days (`ops.ts:203`). The Team "Add person" button creates "Person N" with that default (`TeamView.tsx:161`, `TeamView.tsx:569`). The parser says so ("10d by default", `demo.ts:702`).
   - `capacity` is required (`schema.ts:38`), so "unknown" cannot even be represented.
   - "+ Duration" likewise sets the estimate to 1d (`parts.tsx:301`).
2. **"Pure reducer"** has no side effects but is not deterministic. `uid()` uses `Math.random` (`seed.ts:31-33`) inside `createProject` (`seed.ts:60`), `addTask` (`ops.ts:83`), `acceptProposal` (`ops.ts:132`), `addPerson` (`ops.ts:203`), `addBriefLine` (`ops.ts:270`) and `addMoodItems` (`mood.ts:50`). The same op list produces different ids, which conflicts with v1 §10.2 (the server re-applies the same reducer).
3. **"Status and progress stay coherent"** is incomplete. See point 11: five measured incoherences, including slider-through-100 demoting In review.
4. **"The UI always shows which engine is active"**: the palette footer always says "Demo parser · deterministic" (`CommandSheet.tsx:91`).
5. **"Any error falls back to the demo parser"**: a classifier refusal returns an "unsupported" caption with no fallback (`claude.server.ts:155-157`). v0 also omits:
   - the `server-side-fallback-2026-07-01` beta (`claude.server.ts:143-145`) and `max_tokens: 8000`;
   - that the route is unauthenticated and not rate-limited (`route.ts`).
6. **"The sanitizer drops unknown ids"** only partially. `setView.focusId` and brief line ids and keys are not checked (`claude.server.ts:101-133`; harmless, because the reducer no-ops). The caption is never adjusted after sanitizing.
7. **Persistence "revalidated on load"**: a failed parse silently discards the whole workspace and log (`store.ts:344-348`).
8. **Images "downscaled to WebP"**: WebP only where the browser can encode it, otherwise JPEG, otherwise the original file (`assets.ts:90-93`). Stored images are never deleted.
9. **"{n} changes · saved locally"**: the log is capped at 40 (`store.ts:214`), so the counter stops at 40.
10. **Caption duration**: the 14 s duration also applies to "unsupported" captions (`Caption.tsx:32`).
11. **280-character caption cap**: the " · Claude unavailable…" suffix is appended after the cut (`views.ts:87` vs `store.ts:188`), so a caption can exceed 280.
12. **Red "for brief lines to review"**: the brief shows only a red dot, and the text is `text-3` (`BriefView.tsx:345-352`). Red text appears only on "Urgent" and "+Nd over".
13. **Urgent highlight "dims the others to 55%"**: emphasised and selected tasks are exempt (`TaskCard.tsx:32`). Team segments dim to 50% (`TeamView.tsx:443`).
14. **Focus "+5 for each successor"**: it is 5 × every later To-do task by position (`focus.ts:60-61`). "Days behind" is weighted 40 × the fraction behind (`focus.ts:53-55`).
15. **Focus volumes "the other tasks"**: done tasks are included as ✓ volumes (`FocusView.tsx:27`, `FocusView.tsx:333`).
16. **Breakdown "sized to the task's duration"**: half-day rounding can exceed the parent, and the caption claims it fits (point 19).
17. **Tasks without a duration**: v0 never says they take zero time in the schedule, which pulls later tasks earlier (point 6).
18. **"32 colour names"**: 32 entries, but only 30 colours, since "off white"/"off-white" and "grey"/"gray" are aliases (`demo.ts:447-478`).
19. **"Any subject gives this template"**: only for phrases the parser recognises as creation (point 1).
20. **Accessibility gaps** are under-reported:
    - Team segments and moodboard tiles are not keyboard-reachable at all.
    - Priority dots are 13×18px.
    - The palette dialog has no focus handling.
    - The caption timer does not pause.
21. **No-op commands still create an undo step and a log entry** (`store.ts:204`, `ops.ts:69`). Not mentioned.
22. **Stack details missing**:
    - exact versions Next 16.4.0 and React 19.3.0 (v1 §3.1 says React 19.2);
    - `cacheComponents: true` and `partialPrefetching: true` in `next.config.ts`;
    - six font faces with `display: "block"`;
    - a stale comment at `layout.tsx:17` that calls Mono the "Body + metadata role".
23. **Point & Ask "Team row"** is selectable by pointer only (point 22).

### Not measurable from this environment

| Item | How to measure |
|---|---|
| Whether `/api/interpret` currently returns 400 for schema complexity | One request in a keyed preview, logging the upstream error |
| Agent frame time, goo filter cost, `backdrop-filter` cost at 60 cards | Chrome and Safari Performance panels plus a mid-range phone, 60-task doc via `window.__form` |
| Screen-reader behaviour of the remounting `role="status"` caption (`Caption.tsx:55-58`) | VoiceOver on macOS and iOS |
| Whether the GitHub repo is public, and the font EULA terms | Owner |

---

## 9. Domain model and reducer (v1 §5, §16)

Scope: `src/lib/schema.ts`, `ops.ts`, `seed.ts`, `mood.ts`, `views.ts`, `store.ts`, `assets.ts`, plus every caller that builds operations. Code read at HEAD `177e822`. Behaviour was checked by running the real modules with jiti from scratch scripts outside the repo (`verify.mjs`, `verify2.mjs`, `verify3.mjs`, `verify4.mjs`, kept in `docs/audit/harness/domain/`). No repo file was changed.

#### At a glance

- The vocabulary is exactly 35 operations, as v0 says. One of them (`moveTask`) has no producer except Claude.
- **The reducer is not pure.** Six call sites mint ids with `Math.random` inside `applyOperation`. Applying the same op to the same doc twice gives different documents. Server replay as designed in v1 §10.2 cannot work on this reducer. It does not mutate its inputs and reads no clock.
- **Status/progress coherence is weaker than v0 says.** Reachable UI and parser paths produce `done@40`, `todo@30`, `active@100`, `review@100`, `todo@100`.
- **Silent loss of the whole workspace.** Direct-manipulation commits skip Zod validation. Four reachable edits produce a document that `DocSchema` rejects. On the next load the store drops the document without a message, and the first `set()` overwrites localStorage. Verified end to end.
- No tests, no test runner, no test dependency.

#### 1. Operations in `schema.ts` vs v0 doc vs v1 §16

`OperationSchema` (schema.ts:202-259) is a discriminated union of 35 ops. `OperationListSchema` caps a batch at 12 (schema.ts:261). This matches the v0 doc's "35 operazioni".

The v0 doc lists only a subset ("tra cui") and never names `renameTool` or `moveTask`. That is consistent with v0 §14 ("niente riordino manuale dei task da UI"): `moveTask` is in the schema and the reducer (ops.ts:113-119), but no UI or parser path emits it. Only Claude can, and the sanitizer passes it when the id exists (claude.server.ts:105-108).

Who emits each op: P = demo parser (`interpret/demo.ts`), U = direct UI (`components/**`, plus `store.ts` resolveProposal/resolvePlan), C = Claude (any op in the schema).

| # | Op | Payload (Zod) | By | v1 §16 fate |
|---|---|---|---|---|
| 1 | createProject | title 1-80, template "website", representation? cards/board/timeline | P C | **Modified**: v1 creates from a draft. The v0 form (template only, replaces the whole doc) moves to `/demo` only |
| 2 | renameTool | title 1-80 | U C | **Deprecated** → `updateProject{title}` |
| 3 | setRepresentation | representation (6) | P U C | Kept |
| 4 | removeView | representation | P C | Kept |
| 5 | setView | patch: density, layout, columns 1-4/null, sort, hideDone, highlightUrgent, focusId?, briefAudience?, briefShort? | P U C | **Modified** (filters, zoom); the `focusId` part → `setFocus` |
| 6 | setFields | patch: priority/estimate/progress booleans | P C | Not in §16 → fold into `setView` (to confirm) |
| 7 | updateTask | id, patch: title ≤140, status, priority, progress 0-100, estimate 0.5-90/null, cost ≥0/null, emphasis | P U C | **Modified** → `updateTask(field)`; on a step → `updateStep` |
| 8 | addTask | title 1-140, parentId/null, estimate, priority? | P U C | **Modified**: `parentId≠null` → `addStep` |
| 9 | removeTask | id | P U C | **Modified**: adds dependency bridging; on a step → `removeStep` |
| 10 | moveTask | id, toIndex int ≥0 | C | **Modified**: fractional key + lane |
| 11 | proposeSubtasks | parentId, items 1-8 {id,title,estimate} | P C | Kept |
| 12 | acceptProposal | (none) | P U C | **Modified**: partial accept; must name the proposal |
| 13 | discardProposal | (none) | P U C | Kept |
| 14 | addBlock | block | P C | Kept |
| 15 | removeBlock | block | P C | Kept |
| 16 | setStartDate | date YYYY-MM-DD | U C | Not in §16 → `updateProject{startDate}` |
| 17 | addMoodItems | items 1-24 MoodInput | P U C | Kept ("come v0"); `asset` → `assetId` |
| 18 | updateMoodItem | id, patch x/y/w/h/r/hex/text, raise? | U C | Kept |
| 19 | removeMoodItem | id | U C | Kept |
| 20 | arrangeMood | layout | P U C | Kept |
| 21 | clearMood | (none) | P C | Kept |
| 22 | addPerson | name 1-40, role?, capacity? 0.5-90 | P U C | **Modified**: workspace scope, `capacityDaysPerWeek` |
| 23 | updatePerson | id, patch name/role/capacity | P U C | **Modified**: workspace scope |
| 24 | removePerson | id | P C | **Deprecated** → `archivePerson` (§16 has no delete op; §5.7 mentions deleting a person) |
| 25 | assignTask | taskId, personId/null | P U C | **Modified**: null → `unassignTask` |
| 26 | addSampleTeam | (none) | P U C | **Deprecated** → `/demo` only (§0.7) |
| 27 | proposeReassign | moves 1-8 {taskId,to} | P C | Kept, as one kind of proposal |
| 28 | acceptReassign | (none) | P U C | **Deprecated** → `acceptProposal` |
| 29 | discardReassign | (none) | P U C | **Deprecated** → `discardProposal` |
| 30 | editBriefLine | key, text ≤600, basis | U C | Kept |
| 31 | resetBriefLine | key | U C | Kept |
| 32 | addBriefLine | audience, section, text 1-600 | P U C | Kept |
| 33 | updateBriefLine | id, text ≤600 | U C | Kept |
| 34 | removeBriefLine | id | U C | Kept |
| 35 | resetBrief | audience | P U C | Kept |

v1 §16 adds 31 ops with no v0 counterpart:
- **Workspace:** `archivePerson`, `linkPersonToMe`, `addTimeOff`, `removeTimeOff`, `setWorkspaceCalendar`, `saveTemplate`, `deleteTemplate`
- **Project:** `updateProject`, `archiveProject`, `restoreProject`, `duplicateProject`, `deleteProject`, `addMember`, `removeMember`
- **Task:** `addDependency`, `removeDependency`, `pinStart`, `unpinStart`, `addLink`, `removeLink`
- **Steps:** `addStep`, `updateStep`, `removeStep`, `reorderStep`
- **Proposals:** `proposePlan`, `proposeEstimates`, `proposeLeveling`
- **Views:** `setFocus`
- **Team:** `unassignTask`
- **Brief:** `markBriefSent`, `setBriefSharing`

Gaps in §16 itself, to settle before Phase 1:
- No op updates the workspace `name`, `timezone`, `defaultCurrency`, `holidayPreset` or `improveFormOptIn`; only the calendar has an op.
- No op edits an existing template.
- §5.7 mentions deleting a person, but §16 only has `archivePerson`.
- `createProject`, `duplicateProject`, `deleteProject` and `archiveProject` act on the project index (the `docs` table), not inside one project document. A §10.2 commit carries one `docId` and one `baseVersion`, so these need their own endpoint or a workspace-level commit.

#### 2. Reducer purity

Scope: `applyOperation` (ops.ts:29-293) and `applyOperations` (ops.ts:298-300).

What holds (verified):
- **No input mutation.** All 35 ops were run on deep-frozen inputs and again on unfrozen clones. Neither the doc nor the op changed (verify.mjs §3, verify3.mjs). `arrangeMood` copies its items.
- **No clock, no environment, no browser globals.** The reducer modules (`ops.ts`, `seed.ts`, `mood.ts`, `schema.ts`) have no `"use client"` and can be imported on the server.
  - `Date` and `performance.now()` appear only outside the reducer: `store.ts:143,156,214`, and the `today = new Date()` defaults in selectors (`focus.ts:34,66,87`, `brief.ts:223`).
- **Collage layout is deterministic.** It uses an FNV-style hash of the item id (mood.ts:77-81) and only `+ - * /`, `Math.sqrt/min/max/round/ceil/floor` and `Math.imul`.

What breaks purity: ids are minted inside the reducer with `uid()`, which is `` `${prefix}-${Math.random().toString(36).slice(2, 8)}` `` (seed.ts:31-33).

| Call site | Op | Id minted |
|---|---|---|
| ops.ts:32 → seed.ts:60 | createProject | `tool.id` (`tool-xxxxxx`) |
| ops.ts:83 | addTask | task id (`t-xxxxxx`) |
| ops.ts:132 | acceptProposal | step id, only when a proposal item id collides with an existing task (`s-xxxxxx`) |
| ops.ts:203 | addPerson | person id (`p-xxxxxx`) |
| ops.ts:270 | addBriefLine | line id (`b-xxxxxx`) |
| ops.ts:176 → mood.ts:50 | addMoodItems | one id per item (`m-xxxxxx`) |

The probe confirms it: each of these, applied twice to the same doc, gives different JSON (`det.* => false`). `updateTask` and `arrangeMood` give equal JSON.

Consequences:
- **v1 §10.2 replay cannot work as written.** The client applies `addTask` optimistically, then sends `updateTask{id: t-abc}`. On the server, `addTask` mints `t-xyz`, so the follow-up op targets a missing id and is silently dropped (see point 4 of the fix below). Rebasing after a 409 has the same problem.
- **The store already applies ops twice.** `submit` computes `nextDoc = applyOperations(...)` for the caption and selection (store.ts:179). `commit` then applies the same ops again (store.ts:184 → 203). The two results carry different new ids (probe: `t-738n9p` vs `t-kbh4zc`). Nothing reads new ids from `nextDoc` today, so the problem is latent.
- **Id collisions overwrite silently.** With `Math.random` forced, `uid()` returned `t-ui`. `addTask` then replaced the template task "UI Design", and `t-ui` appeared twice in `order`.
  - Short ids are also possible: `uid()` returns `t-i` when `Math.random()` returns 0.5.
  - The probability is low, but nothing guards against it.
- **Proposal ids share the person prefix.** Proposal items get `p-` ids (library.ts:60, claude.server.ts:112), the prefix used for people. `acceptProposal` reuses the item id as the step's task id (ops.ts:131-132).
  - The probe made a step and a person share `p-marta`.
  - Harmless today because tasks and people live in separate maps, but it defeats prefix typing (v1 §5.1).

Fix for Phase 1:
1. **Ids are minted before the op and carried in it.** This covers `addTask.id`, `addStep.id`, `addPerson.id`, `addBriefLine.id`, `addMoodItems.items[].id`, and `createProject.projectId` plus the template's task ids.
   - The interpreter does the minting: the parser, or the server sanitizer for Claude. Direct-UI action creators do the same. Use the v1 prefix + nanoid.
   - Proposal item ids already work this way.
2. **The reducer rejects collisions instead of re-minting.** An op whose id already exists is rejected with a reason. This replaces the `uid("s")` branch at ops.ts:132.
3. **Timestamps come from the commit.** `createdAt`, `updatedAt`, `completedAt` and `archivedAt` are taken from `commit.createdAt`, passed as reducer context `(doc, op, ctx: {now, actorId})`. The reducer never calls `Date.now()`.
4. **The reducer returns a result, not a doc:** `{doc, patches, inverse, rejected?: reason}`. Today an invalid target returns the input doc unchanged (e.g. `updateTask` on an unknown id returns the same reference; verified). v1 §10.2 needs the reason to write "Couldn't apply …".
5. **No op may depend on whatever is current.** These v0 ops do, so replaying them on a rebased doc changes what they do:
   - `acceptProposal`, `discardProposal`, `acceptReassign`, `discardReassign` have no payload and act on whichever proposal is pending (ops.ts:125-151, 243-249, 290-291). They must name a proposal id.
   - `moveTask.toIndex` is positional (ops.ts:113-119).
   - `clearMood` and `arrangeMood` act on all items, including ones added concurrently.
   - `updateMoodItem.raise` depends on array position.
   - `addPerson` silently does nothing on a case-insensitive name clash (ops.ts:202).
   - `removeView` falls back to "the tab on its left" (ops.ts:162).
6. **Op payloads are stored by reference.** `proposeSubtasks` stores `op.items` itself (ops.ts:123; probe `alias.proposal.items===op.items => true`). With Immer's auto-freeze this freezes the caller's op object. That is harmless if ops are treated as immutable; document it.
7. **No-op ops should return the same reference.** Today `setView` (same value), `setRepresentation` (same view), `updateTask` (same title) and `renameTool` (same title) return a new object (all `false` in the probe). `commit` skips history only on an identical reference (store.ts:204), so each of these creates an undo and log entry for nothing. Immer's `produce` returns the same reference when nothing changes.

#### 3. Invariants vs v1 §5.7

Current coherence rules (ops.ts:66-79). Each applies only when the patch leaves the other field out:
- `status:"done"` → progress 100 (l.71)
- `status:"todo"` from Done → progress 0 (l.72)
- progress ≥100 → Done (l.74)
- progress <100 on a Done task → In progress (l.75)
- progress >0 on a To do task → In progress (l.76)

Reachable states that break the v1 rules, and also the v0 doc's claim "stato e progresso restano coerenti":

| Path | Result | Evidence |
|---|---|---|
| Parser "mark UI Design done at 40%" (status and progress in one patch, demo.ts:186-231) | `done@40` | verify4.mjs |
| Status menu (parts.tsx:145) or board "←" lane button (BoardView.tsx:126) on an active 30% task → To do | `todo@30` | probe |
| Board "←" lane button, Done → In review | `review@100` | probe |
| Status menu, Done → In progress | `active@100` | probe |
| Patch `{status:"todo", progress:100}` (parser or Claude) | `todo@100` | probe |

v1 §2 B.11 ("100% becomes Done") is true only for progress-only patches. The reverse rules are not enforced at all.

| v1 §5.7 rule | What v0 does | Gap / implication |
|---|---|---|
| Done ⇒ 100; 100 ⇒ Done, or In review with `requireReview`; Done lowered below 100 ⇒ In progress; >0 on To do ⇒ In progress | Partial (see above) | Normalise after every patch, whichever fields it sets. `requireReview` doesn't exist; there are no project-level settings at all. Migration must normalise existing docs. |
| `completedAt` only when Done | `Doc` has no timestamps. The only times are `log[].at` (epoch ms, not per entity, store.ts:214) | New field. v0 Done tasks have no completion date: decide null or import time. |
| `dependsOn`: existing ids only, no self-reference, no cycles; a rejected cycle gets a caption | No dependencies. Sequence = `order` (selectors.ts:109-129) | New. Migration builds the chain from `order` (§5.8). |
| Deleting a task bridges its dependents | `removeTask` deletes the task and its direct children (ops.ts:104-111). It leaves `view.focusId` pointing at the deleted task (probe: still `t-ui` after removal) and keeps the task's `brief.edits` keys | Bridging is new. `focusId` must be cleared. Edit keys of removed tasks stay dormant forever (brief.ts:231-244): decide what to do with them. |
| Steps are one level deep | Enforced only in the parser (demo.ts:162, 254). The reducer (ops.ts:82, 121-123) and the Claude sanitizer (claude.server.ts:109-112) accept a step as parent. Probe: a grandchild was created, and removing the top task orphaned it (`parentId` → missing task). **`DocSchema` still accepts that doc.** | Moot once v2 nests `Step[]`, but migration must flatten or drop grandchildren and orphans. |
| `ownerId` exists among workspace people. Deleting or archiving a person unassigns their **open** tasks, with a caption | `assignTask` checks the person exists (ops.ts:224). `removePerson` unassigns **every** task, Done ones included (ops.ts:216), and no caption gives a count. There is no archive. | v1 keeps closed tasks assigned. **This invariant spans two documents** (task in the project, person in the workspace). A single-doc commit (§10.2) can neither check it nor fan out the unassignment. |
| Manual cost is never overwritten; derived cost is recalculated when estimate, owner or dayRate change | `cost` is a bare EUR float `≥0 \| null` with no source (schema.ts:19). There is no dayRate. | Also spans two documents (dayRate lives in the workspace). Recommendation: store only manual cost and compute derived cost in a selector, so a dayRate change never rewrites project docs. |
| Ids are prefix + nanoid | `t-`, `s-`, `p-`, `m-`, `b-`, `img-`, `tool-` + 6 base-36 chars from `Math.random`; the template has fixed ids | See §2 |
| `null` = unknown, never a placeholder | `addPerson` without a capacity stores **10** (ops.ts:203). The TeamView "Add person" button always does this (TeamView.tsx:161). The parser says "10d by default" in its caption (demo.ts:702); the button shows no caption. | Contradicts the honesty principle. v1's default (5/week) is explicit in the schema; v0's 10 days per project is invented. |

Other schema facts that affect v2:
- `TaskSchema.title` has no `min(1)`, so the `updateTask` patch accepts `""` (schema.ts:12, 190-198). The inline editor refuses empty text, but Claude can send it.
- Claude can set `estimate` to any float in 0.5-90, e.g. 2.7 (schema.ts:17). v1 requires steps of 0.5.
- The parser turns weeks into calendar days at ×7 (demo.ts:222).

#### 4. Store: commit, history, persistence, single-doc assumptions

Commit and history (store.ts):
- **Only the agent path is validated.** `submit` checks ops against `OperationListSchema` (l.169). `commit` (l.201-216), `live` (l.222-224) and `updateTask` (l.226-230) apply ops with **no Zod check**, and every direct UI edit goes through them.
- **History is in-memory snapshots.** It stores whole `Doc` snapshots in `past`/`future`, at most `HISTORY_LIMIT = 60` (l.52, 211, 286), never persisted. Undo and redo swap snapshots (l.279-303).
- **A drag is one undo step.** Progress drags call `checkpoint()` on pointer-down (parts.tsx:260 → store.ts:218-220), then `live()` on each move without history. A click that changes nothing still pushes a checkpoint.
- **View changes are undo entries.** A tab click commits `setRepresentation` (l.232-236; probe: one more `past` entry). So ⌘Z first undoes tab switches, sort and density.
  - v1 §4 moves the active view and selection into the URL with `replaceState`.
  - Decide whether view state stays in the synced doc and in the commit/undo stream.
- **The log stores raw commands.** Each entry is `{at: Date.now(), label, source}`, 40 entries max (l.214). For agent commands, `label` is the raw command text (l.184), and the log is persisted. Relevant to privacy (v1 §11).
- **`reset()` keeps the old doc only in memory.** It replaces the doc with `emptyDoc()`, and the old one survives only in `past` until reload (l.305-317).
- **`createProject` replaces the whole doc.** It does the same as `reset()` and also discards mood, people and brief (ops.ts:31-45). Confirms v1 §2 A.2.

Persistence (store.ts:339-349, zustand 5.0.15):
- **Storage layout.** Key `form.workspace.v1`, envelope `{"state":{"doc":…,"log":[…]},"version":1}`; `partialize` keeps `doc` and `log`. The intro flag is a separate key, `form.intro.seen.v1` (Intro.tsx:11).
- **Invalid docs are discarded silently.** `merge` runs `DocSchema.safeParse`. On failure it falls back to `current.doc`, which on a fresh load is `emptyDoc()` (l.346-347). No backup, no caption, no error.
- **Every `set` rewrites storage.** zustand's persist wraps every `set` with a `setItem` of the partialized state, whatever changed (middleware.mjs:358-376).
  - `FormApp` calls `setReducedMotion` on mount (FormApp.tsx:20), so the empty doc **overwrites** the stored one on the first render. Verified with a localStorage shim (`persist.afterFirstSet.storedTool => null`).
  - Transient `phase`, `caption` and `composerOpen` changes and every `live()` pointer move also rewrite the whole doc. The cost wasn't measured here; measure it with a Performance trace of a progress drag on a 60-task doc.
- **"Migration" is minimal.** It is just `migrateViews` (views.ts:91-95: a doc without `tool.views` keeps only the view on screen) plus Zod defaults: `views`, `mood`, `people`, `plan`, `brief`, `owner` (schema.ts:101-106, 178-183, 26).
  - `brief` has a `.catch` (l.183), so a broken brief costs only the brief.
- **A version bump without `migrate` loses the doc.** zustand logs "couldn't be migrated since no migrate function was provided" and hydrates nothing (middleware.mjs:393-405). Verified: version 2 in storage gives `tool: null`, which is then overwritten as version 1.
  - **v2 must not reuse this key and envelope without a `migrate`.**
  - **The importer must read the raw key before the v0 store hydrates.**

What stops the store from holding more than one project or document:
- **One doc.** The store holds a single `doc: Doc` (l.56). `tool: Tool | null` doubles as "no project", and `createProject` replaces everything (ops.ts:31-45).
- **Fixed template ids:**
  - tasks `t-research`, `t-visual`, `t-ui`, `t-dev` and people `p-marta`, `p-sara`, `p-luca` (seed.ts:53-56, 81-83)
  - `SAMPLE_OWNERS`, keyed by those task ids (seed.ts:88, used by ops.ts:229-236)
  - `SAMPLE_IDS`, used to detect the sample team (TeamView.tsx:23)

  Every project made from the template has the same task ids. That's harmless within one doc, but they collide in any cross-project index: v1 `/app/focus`, workspace load, commits, `assets.doc_id`.
- **Brief edit keys embed entity ids.** Keys are `"<audience>:<sentence id>"`, with sentence ids like `risks:t-ui` and `risks:load:p-marta` (schema.ts:164, brief.ts:138-185). If ids are re-minted, these keys must be rewritten or the edits go dormant.
- **People live in the project doc.** People and their capacity sit inside the project doc (schema.ts:33-39, 179), and capacity is "Working days available for this project" (l.37). Confirms v1 §2 A.4 and B.7.
- **Moodboard blobs are global and never deleted.** They sit in one per-origin IndexedDB (`form-assets`/`images`, keyed by asset id; assets.ts:12-13, 22-23), with no link to a project.
  - assets.ts has no delete function.
  - `removeMoodItem`, `clearMood`, `createProject` and `reset` all leave orphan blobs behind.
- **Claude receives the whole doc.** `/api/interpret` takes the full doc in the request body and validates it with `DocSchema` (route.ts:8-10). A doc over any limit (§5) gets HTTP 400 on every Claude call, and the client silently falls back to the parser with "Claude unavailable".

What the v1→v2 importer (v1 §5.8) must handle:

1. **Read before the v0 store hydrates.** Read raw `localStorage["form.workspace.v1"]` first.
   - Accept the legacy shapes: no `tool.views`; no `mood`, `people`, `plan` or `brief`; tasks without `owner`.
   - Accept over-limit docs through a lenient salvage parse: truncate the title to 80, cap people at 20 and mood at 200, clamp the mood geometry.
   - Otherwise the current `merge` destroys these docs before the importer sees them.
2. **Same origin only.** localStorage and IndexedDB are per-origin. The import works only if `/app` is served from the origin where the v0 demo ran; otherwise v0 needs an export file. Docs with `tool: null` have nothing to import.
3. **Project fields:**
   - `tool.title` → `title` (both max 80)
   - `template:"website"` → `kind` ("website" or "other"?)
   - `startDate` → `startDate`
   - `startConfirmed = !startDateIsSample`. Caveat: the ±1-week buttons (TimelineView.tsx:262-267) set `startDateIsSample:false` (ops.ts:173) without the user ever typing a date.
   - `tool.views`, `tool.blocks` and `view` → `views`, `blocks`, `activeView`, `viewConfig` (`focusId`, `briefAudience`, `briefShort`)
4. **Tasks:**
   - `order` → fractional `order` keys, plus a finish-to-start `dependsOn` chain.
   - `estimate` → `estimateDays`, rounded to a 0.5 step (any float is possible today). Calendar days are reinterpreted as working days, so "2 weeks" = 14 becomes 14 working days.
   - `cost` (EUR float) → `{amount: cents, source: "manual"}`.
   - `owner` → `ownerId`; `emphasis` is kept; `origin` has no v2 field.
   - Normalise status and progress (§3).
   - Titles over 120 characters (v0 allows 140) must be truncated, unless v2 raises its limit.
5. **Steps.** Tasks with a `parentId` become `Step{id, title, done, ownerId: null}`.
   - This loses status other than Done, priority, progress, cost, emphasis, and the **estimate**. The estimate matters: the timeline uses it for sub-slots (selectors.ts:119-125) and the rule "step estimates sum to the parent" relies on it.
   - Flatten grandchildren; drop or re-parent orphans.
6. **People** become workspace persons.
   - `capacity` (days per project, 0.5-90) has no conversion to `capacityDaysPerWeek`.
   - The sample team (`p-marta`, `p-sara`, `p-luca`) is the fake data that v1 §0.7 bans outside `/demo`.
   - Deduplicate by name across imported projects.
7. **Pending proposals.** v0 can hold `proposal` and `plan` at the same time (schema.ts:176, 181); v2 holds a single proposal, so the importer must pick one.
8. **Brief.** Copy `edits` and `lines`, and rewrite the edit keys if ids change. Expect `next:end` and the risk lines to show as stale once dates move to working days.
9. **Moodboard images:**
   - Upload only the asset ids that `doc.mood` references (`kind: "image"`), not the orphans in IndexedDB.
   - Handle references whose blob is missing in this browser (`useAssetUrl` reports `missing`, assets.ts:61-72).
   - Stored blobs are WebP, JPEG as a fallback, or **the original file when the canvas can't decode it, e.g. SVG** (assets.ts:91-95). Sanitise or rasterise SVG before uploading to Blob (v1 §11.3).
   - v0 stores no pixel size, only `h/w` on the item. Read width and height at upload time for the `assets` row.
   - Rewrite `item.asset` to the new `ast_` id.
   - Blob count and total size per real user can't be measured from here. Measure them in a browser on the v0 origin: open `form-assets` and sum `blob.size` over `images`.
10. **The `log`** (up to 40 raw commands, not linked to any entity): drop it, or use it to seed Activity.

#### 5. Data-loss risks: limits enforced only by `DocSchema`

Every row comes from the real reducer, checked with `DocSchema.safeParse`. In each case the reachable path goes through `commit()` with no Zod check. The bad doc is then dropped on the next load and overwritten by the first `set` (§4).

| Limit (schema.ts) | Reachable path | Probe |
|---|---|---|
| `tool.title ≤80` (l.90) | The header's inline editor slices to **140** (parts.tsx:391) → `renameTool` via `commit` (blocks.tsx:76). The op schema would reject it (`renameTool140.opSchema => false`), but `commit` never runs it | `tool.title: Too big … <=80`. Verified end to end through the real store: the commit accepted 140 chars and the stored doc was invalid |
| `people ≤20` (l.179) | "Add person" has no cap (TeamView.tsx:161; ops.ts:200-205) | 21 people → `people: Too big … <=20` |
| `mood ≤200` (l.178) | Drops and pastes of up to 24 images (Moodboard.tsx:49) pile up uncapped (mood.ts:39-63) | 9 drops = 216 → `mood: Too big … <=200` |
| `MoodItem.y ≤20` (l.122) | "Arrange → Masonry" (Moodboard.tsx:139) never clamps `y` (mood.ts:129-134) | Tall images break it below the 200 cap: aspect 2.16 (phone screenshots) from **165** items, aspect 3 from 121, aspect 4 (the ingest max, assets.ts:99) from **93** |
| `MoodItem.h ≤3`, `w ≥0.04` (l.123-124) | A note can be resized freely down to w 0.06 and up to h 3 (Moodboard.tsx:350-352), then arranged. Masonry and collage don't clamp `h` (mood.ts:131, 149); grid doesn't clamp `w` (mood.ts:114) | A single 0.06-wide note breaks masonry at h 0.40, collage at h 0.51, grid at h 0.57 |

Safe today:
- Task and step titles: the inline editor's 140 equals the schema's 140.
- Person name: sliced to 40 (TeamView.tsx:337).
- Notes: sliced to 400.
- Brief text and line count: clamped in the reducer (ops.ts:269, 296). This is the only place where the reducer mirrors a schema limit, and the pattern to generalise.

Phase 1 fix:
- Validate every commit against the op schema, whatever its source.
- Make each reducer keep the document limits it can break, by capping, clamping or rejecting with a reason.
- Treat "`DocSchema.parse(apply(doc, op))` always succeeds" as a property test.
- Replace the silent `merge` fallback with a salvage parse that keeps the raw doc.

#### 6. Tests

None exist: no `*.test.*` or `*.spec.*` files, no `test` script (package.json has only dev, build, start and lint), and no vitest, jest, fast-check or Playwright dependency. The probes in this audit are throwaway jiti scripts.

What the v1 §15 property suite needs:
- **Prerequisites:**
  - a deterministic reducer with ids and `now` injected (§2)
  - a reducer result that can carry `rejected`
  - Immer `produceWithPatches`, for the inverse-patch property
  - `vitest` and `fast-check` as devDependencies, and a `test` script
- **Generator:** model-based (`fc.commands`, or a state-aware arbitrary), run for 10,000 sequences. It picks existing ids most of the time and missing ids sometimes, and it emits:
  - every registry op, step ops included
  - attempts to nest steps under steps
  - combined status + progress patches
  - mood geometry at the extremes: w 0.06, h 3, aspect 4, more than 200 items
  - more than 20 people
- **Properties checked after every step:**
  1. `DocSchema` parses the result. This alone catches every row of §5.
  2. The §5.7 invariants hold (§3 table).
  3. No dangling references:
     - `order ⊆ tasks`, and order keys are unique
     - every step's parent exists
     - every owner is in people
     - `focusId` is a task
     - proposal and plan targets exist
     - every image item has an asset
  4. No dependency cycles.
  5. Inverse patches restore the doc: `apply(apply(d, op).inverse) ≡ d`.
  6. Determinism: applying twice gives deep-equal results.
  7. Inputs are not mutated (deep-freeze them).
  8. A no-op returns the same reference.
- **Migration fixtures:**
  - the template doc as created
  - a legacy doc with no `views`, `people`, `mood` or `brief`
  - one doc per over-limit case in §5
  - one doc per invariant-violating state in §3
  - a grandchild step and an orphan step
  - `proposal` and `plan` both pending
  - steps with estimates
  - a dangling `focusId`
  - brief edits keyed by template ids
  - an IndexedDB fixture with a referenced blob, a missing blob and an orphan blob
  - the expected calendar from v1 §5.8, skipping weekends

---

## 10. Interpretation pipeline (v1 §9)

Scope: `src/lib/interpret/{demo,library,index,claude.server}.ts`, `src/app/api/interpret/route.ts`, the routing in `src/lib/store.ts` and the UI call sites. Measurements were run offline with jiti against HEAD 177e822 (Node 22.13, `@anthropic-ai/sdk` 0.133.0, `zod` 4.6.5). The scripts are kept in `docs/audit/harness/agent/`: `schema.mjs`, `recount.mjs`, `probe.mjs` and `mock-sdk.mjs`, which runs a copy of the Claude module with `server-only` removed and the SDK client mocked. The mock runs the SDK's real `parseBetaMessage` and Zod helper. **No request reached the Anthropic API.**

#### A. Demo parser (`demo.ts`): what it really is

**Output shape.** `Interpretation = { ops ≤ 12, message ≤ 280, tone: done|proposal|unsupported|clarify, control?: undo|redo|reset, target? }` (`schema.ts:263-271`). It has **no confidence and no coverage signal.** It also cannot tell "no match" apart from "known but unsupported" in a machine-readable way:
- Generic fall-through returns `tone:"unsupported"`, ops `[]`, with "Demo mode doesn't understand that yet…" (`demo.ts:431-437`). The variant "I understood you mean {task}, but not the change…" (`demo.ts:434`) also uses this tone.
- Refusals by family use the same tone and the same empty ops: comparisons (`:69-71`), budget (`:72-74`) and the moodboard capability text (`:539-544`).
- Only the message string differs. `clarify` is a third outcome with ops `[]`.

v1 §9.2 needs `{status, confidence, ops}`. None of the three fields exists today.

**Precedence (actual order in `interpretDemo`):**
1. Normalise: quotes, whitespace, trailing `.!?`, "mood board" → "moodboard" (`:41-49`). An empty command → clarify (`:52`).
2. Control: `undo` / `redo`, anchored full-sentence regexes (`:55-56`).
3. View removal, anchored (`removeViewIntent`, `:58`, `:866-874`).
4. Brief edits: "add to the brief: …", "reset the brief" (`:61`, `:567-605`). These run before the workspace reset, as v0 says.
5. Workspace reset (`:64-66`).
6. Unsupported families: comparison (`:69`) and budget (`:72`). Budget is skipped when a task is selected and the sentence has a digit.
7. Status brief (`:79`, `:607-654`).
8. Create / new project (`:83-112`). This step returns clarify for a project born as team/focus/brief (`:93-97`).
9. No project yet → clarify (`:114-116`).
10. Reassign-plan yes/no (`:119-127`).
11. Moodboard (`:130`, `:497-547`).
12. Team (`:134`, `:671-792`).
13. Subtask-proposal yes/no (`:138-145`).
14. Entity level. The target is the longest task title named, else the selected task unless the sentence is plural (`:151-154`).
    - Breakdown returns early (`:156-173`).
    - Otherwise these accumulate: rename, status, priority, emphasis, estimate, progress, cost (an early clarify if no amount), add step, remove (`:176-267`).
15. Workspace level:
    - Focus returns early (`:272-288`); exit focus returns early (`:289-292`).
    - These accumulate: representation (`:295-305`), density (`:308-316`), columns/grid (`:319-329`), sort (`:332-346`, clarify "Sort by what?" if there is no key and no other op), hide done (`:349-355`), urgent highlight (`:358-364`), field visibility (`:367-402`), metrics block (`:405-413`), add top-level task (`:416-421`), and a quiet-view fix-up (`:424-429`).
16. Nothing collected → unsupported. Otherwise the result is `done`, with the caption made from the parser's own `notes` joined by " · " (`:439`).

**Families:** control, view create/remove, layout and sort, filters, field visibility, blocks, task edits (status, priority, estimate, progress, cost, emphasis, rename, add/remove, steps), breakdown proposal (`library.ts`, website-specific step library scaled to the estimate), focus, team (add, capacity, remove, assign, balance, overload), brief (audience, length, add line, reset), moodboard (colours, notes, arrange, clear, hide), create project (always the website template).

**English only, with leakage.** The rules are English keyword regexes. "Fammi il brief per il cliente", "Chi è sovraccarico…", "Sposta lo sviluppo a lunedì" and "annulla" all give "Demo mode doesn't understand that yet". However, an Italian sentence that contains an English keyword matches: "Aggiungi una timeline" → `setRepresentation:timeline`, `done`. v0 §14 ("Solo inglese") is therefore true only in a loose sense.

**Palette coverage.** All 41 items in `CAPABILITIES` (`src/components/agent/suggestions.ts`) were run on the template doc.
- 37 resolve to their intended family.
- 3 return a state-dependent `clarify` when the moodboard has fewer than 2 items: "Tidy up…", "Arrange … grid", "Arrange … collage".
- 1 returns `done` with zero ops: "Hide the moodboard" → "The moodboard is already hidden".

**Speed.** 0.001–0.009 ms per parse on the template doc. The user still waits a fixed 340 ms "beat" (`store.ts:154-157`, `motion.ts:40`).

**False positives with `tone:"done"` (measured).** These matter most for the fast lane:

| Command (v1 §9.11 or similar) | Parser result |
|---|---|
| "Set the deadline to 30 November" | opens/creates **Timeline**. `deadlines?` is in the timeline regex (`demo.ts:802`) |
| "Level the schedule" | Timeline (`schedule`, `:802`) |
| "Zoom the timeline to weeks" | Timeline; the zoom is dropped silently |
| "Budget is 12k" with a task selected | **sets UI Design's cost to €12,000** (`:72`, `:238-245`) |
| "Start QA on the 10th" with a task selected | **UI Design → In progress** (`/^start\b/`, `:187-192`). QA does not exist |
| "Add a board and then email the client" | Board; the rest is dropped |
| "Mark Research done" (already done) | caption "Research → Done", plus an Undo button and a history entry for a deep-equal doc. `applyOperations` returns a new reference, so `commit` records it (`store.ts:202-215`) |

All the other v1 §9.11 examples fall through to "unsupported", which is the correct outcome for a parser that hands off.

#### B. Routing

- **Engine discovery.** On mount, `FormApp.tsx:28-33` calls `GET /api/interpret`. If the response is `{available:true}`, it calls `setEngine("claude")`. `available` is `claudeConfigured()`: `FORM_ENGINE !== "demo"` and `ANTHROPIC_API_KEY || ANTHROPIC_AUTH_TOKEN` is set (`claude.server.ts:10-13`).
- **v1 D.17 confirmed.** `store.ts:148` sends every `submit` to the selected engine unless `opts.engine` is passed. With a key present, all of these go to Claude, including a typed "undo"/"redo" (the model has a `control` field, system prompt `claude.server.ts:29`):
  - the composer (`Composer.tsx:85`);
  - palette items (`Composer.tsx:264` → `run`);
  - suggestion chips (`Composer.tsx:276`);
  - "Break this task into smaller steps" in Focus (`FocusView.tsx:171`);
  - "Balance the workload" in Team (`TeamView.tsx:170`).
- **Forced to the demo parser.** Only the suggestion nodes: `AgentLayer.tsx:173` → `submit(VIEW_OFFER[view], { engine: "demo" })`, where `VIEW_OFFER` is "Add the tracker", "Add a board", "Add a timeline", "Add the team view", "Add focus" and "Add a brief" (`suggestions.ts`).
- **Bypasses the interpreter.** ⌘Z/⇧⌘Z (`FormApp.tsx:41-45`), the Undo/Redo buttons (`Chrome.tsx:53-56`), the caption's Undo (`Caption.tsx:70`) and Accept/Discard of proposals and plans (`store.ts:238-264`).
- **Fallback.** It happens only when the call throws (`store.ts:149-152`): a network error, a non-2xx response (`index.ts:31`) or a client `InterpretationSchema.parse` failure (`index.ts:32`). The caption then gets " · Claude unavailable, demo parser used" (`store.ts:178`), but the top bar still says "Claude · server-side" (`Chrome.tsx:38`). A Claude answer of `unsupported` or `clarify` is final; the parser is never consulted.
- **No timeout anywhere.** The client `fetch` has no `AbortSignal` (`index.ts:26`). The server uses `new Anthropic()` with SDK defaults: a 10-minute timeout and 2 retries (`claude.server.ts:137`). While a request is pending, `phase:"processing"` blocks every new command (`store.ts:140`) and the composer (`store.ts:271`). v1 §9.5 asks for 10 s.

#### C. Claude route

**Request** (`claude.server.ts:136-153`):
- `client.beta.messages.parse`, model **hard-coded** `claude-opus-5-5` (`:8`), not set by an env variable.
- `max_tokens: 8000`, non-streaming.
- `output_config: { effort: "low", format: betaZodOutputFormat(InterpretationSchema) }`. This is a JSON output format, not tools.
- `betas: ["server-side-fallback-2026-07-01"]` with `fallbacks: "default"`. The SDK's `parse()` also adds `structured-outputs-2025-12-15` to `anthropic-beta` (`node_modules/@anthropic-ai/sdk/resources/beta/messages/messages.js:82`).
- No `thinking` parameter, so Opus 5.5 runs adaptive thinking; it cannot be disabled on this model. No sampling parameters.
- `system` is a plain string with **no `cache_control`**: no prompt caching.

**System prompt.** 5,078 characters, about 1,270 tokens (`:15-30`). It covers the vocabulary (views, team, moodboard) and these rules: ids must exist, never invent facts, one view per creation, `unsupported`/`clarify` with no ops, control only for undo/redo/reset, and the caption at most about 12 words. Compared with v1 §9.6, it is missing:
- that project content is data, not instructions;
- Italian;
- clarify chips;
- today's date and timezone.

**`workspaceContext`** (`:33-68`) sends:
- `selectedId`;
- `tool` (title, blocks, views, startDate, startDateIsSample);
- the full `view`;
- `proposal`, `people`, `plan`;
- `mood` (geometry rounded to 3 decimals, hex, text; no asset);
- `tasks` (top-level in workflow order, then steps; id, title, status, priority, progress, estimate, cost, parentId, emphasis, owner).

It does **not** send:
- the brief state. `editBriefLine`, `updateBriefLine`, `removeBriefLine` and `resetBriefLine` are in the schema, but the model can never know a valid id or key;
- computed schedule dates or loads;
- recent commands or captions;
- today's date.

Size, as JSON length / 4:

| Document | Characters | ~Tokens |
|---|---|---|
| Template doc (timeline, 4 tasks, 3 people, empty moodboard) | 1,278 | ~320 |
| Whole user message | 1,311 | ~328 |
| Synthetic doc: 150 tasks + 24 notes | 31,583 | ~7,900 |

The last row already reaches the v1 §9.3 cap of about 8k tokens, and there is no truncation in the code. The client POSTs the whole `doc` (`index.ts:29`). The route checks it with `DocSchema`, whose `tasks` record and `order` array have no size limit (`schema.ts:172-174`). The route has **no auth and no rate limit** (`route.ts:17-32`).

**Schema actually sent.** `z.toJSONSchema` is passed through the SDK's `transformJSONSchema` (`node_modules/@anthropic-ai/sdk/helpers/beta/zod.js:19`). Counts are made over properties, with `$ref`s expanded. Limits are from platform.claude.com/docs/en/build-with-claude/structured-outputs, fetched on 2026-10-14.

| Measure | Raw `z.toJSONSchema` | **Sent on the wire** | Documented limit |
|---|---|---|---|
| Size | — | 12,052 chars (~3,000 tokens) | — |
| Top-level union | `oneOf`, 35 op variants | `anyOf`, 35 variants (`$defs.__schema0`) | — |
| Optional properties | 43 | **43** | 24 (counts JSON output schemas too) |
| Union-typed params (`anyOf` / type arrays) | — | **17** (18 counting `ops`, an array of a 35-way union) | 16 |
| `minimum` / `maximum` | 14 / 13 | 0 (moved into `description` text) | not supported |
| `minLength` / `maxLength` / `pattern` | 6 / 14 / 2 | 0 (moved to descriptions) | not supported / partly supported |
| `enum` / `const` | 14 / 36 | **0 / 0 (moved to descriptions)** | both supported by the API |
| `maxItems` | 4 | 0 | only `minItems` 0/1 |
| Recursion | none | none (no `$ref` cycles) | not supported |

Two consequences:

1. **The schema exceeds the documented limits** on optional properties (43 vs 24) and union-typed parameters (17–18 vs 16). This is inferred, not observed. If the API enforces the limits as documented, every Claude request returns a 400, which `route.ts:29` turns into a 502. FORM would then *always* fall back to the parser after a round trip.
2. **SDK 0.133.0's helper also removes `enum` and `const`.** The 35 `op` discriminators, `tone`, `control` and every enum value become `{type:"string", description:"{const: …}"}`. The grammar therefore does not stop the model from emitting `op:"deleteEverything"` or `tone:"ok"`. Those are caught only afterwards by Zod in `format.parse`. Measured with the mock: an unknown op, a bad tone, or a message longer than 280 characters each throws `AnthropicError`, which is not an `APIError`, so the route answers 502 "Interpretation failed" (`route.ts:30`) and the client falls back. v1 D.18 does not mention this. It affects the v1 §9.4 "field (enum)" design whenever schemas are produced through this helper.

**Sanitizer** (`:100-134`, `settleViews` `:91-98`).

What it does, as v0 says:
- drops unknown task, person and mood ids;
- regenerates proposal item ids;
- strips images;
- applies birth-view folding and the `replacesProject` rule around `createProject`.

Gaps, measured:
- Three `setRepresentation` ops with a project open all pass, so board, team and brief are created in one command. The "one view per creation" rule is enforced only around `createProject`; v0 §12 overstates it.
- `setView.focusId` with an unknown task passes.
- `setStartDate` passes (an invented date).
- `addPerson.capacity` passes (an invented capacity).
- Brief line ids and keys are not checked.
- `addTask` under a step passes, and the reducer only checks that the parent exists (`ops.ts:82`), so steps can nest through Claude.
- Ops are not removed when `tone` is `clarify` or `unsupported`, and `store.ts:179-184` applies ops whatever the tone.
- When every op is dropped, the model's `tone:"done"` and message survive. Measured: "Marked done" with zero ops.

**Caption source (v1 D.19 confirmed).** The caption is the model's `message`, passed through as is (`:160`, `{...out}`). The store adds only the computed "\<View\> view added" and the fallback suffix (`store.ts:188`, `views.ts:74-88`). Measured: ops = Board with message "Timeline zoomed to weeks" goes through unchanged. The demo path has the same structural problem: its captions are `notes` written *before* the reducer runs (`demo.ts:439`), not composed from the operations that were applied.

**Error and stop handling.** `parseBetaMessage` parses the first text block *before* the code checks `stop_reason` (`claude.server.ts:155`). Measured with the mock:
- A refusal with no text block reaches the refusal branch.
- A refusal with partial text throws first, which gives a 502 and the parser fallback.
- `max_tokens` truncation throws the same way.

With `fallbacks:"default"`, a decline in the middle of the stream may leave a partial text block from the first model ahead of the fallback model's output. Whether that breaks parsing is untested. `target` is produced by both engines but never read by the client (no consumer in `src/`).

#### D. Was the Claude path ever exercised?

Not on this machine:
- no `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` in the environment (only the harness's `ANTHROPIC_BASE_URL` is set);
- `.env.example` has an empty key, and there is no `.env*.local`;
- the repo has no tests or evals;
- none of the six commits that touch `claude.server.ts` / `route.ts` mentions a live run.

The route type-checks (a `.next` build exists). Never observed:
- whether the API accepts the schema;
- latency at effort `low` with adaptive thinking on Opus 5.5;
- the real token usage (the system prompt plus whatever the 12 KB format schema adds);
- how often the model returns invalid enums or ops;
- the behaviour of `fallbacks:"default"` with `parse`;
- refusal and `max_tokens` shapes;
- caption quality and how often the model obeys "one view" and "no ops on clarify".

How to measure:
1. `curl https://<production>/api/interpret` tells whether production has a key (`{"available":…}`). Vercel function logs would show the 502 rate.
2. A single real request with a key, logging `usage`, `stop_reason` and latency, would confirm or refute the schema-limit rejection.
3. `POST /v1/messages/count_tokens` with the same `system`, `messages` and `output_config.format` gives exact input tokens.
4. The v1 §9.10 eval set gives validity, latency p50/p95 and the fallback rate.

#### E. What can be kept as the v1 fast lane, and what must change

**Keep (high-precision, anchored, state-aware):**
- control (`demo.ts:55-56`);
- view removal (`:866-874`);
- brief line add and reset (`:580-605`);
- brief follow-ups (`:626-630`, whole-sentence regexes);
- the `VIEW_OFFER` and palette phrases (all 41 recognised);
- sort/density/columns/fields/hideDone/highlight, once their triggers are anchored;
- team add/capacity/assign/balance/overload;
- the helpers `findNamedTask`, `personIn`, `parseAmount`, `coloursIn`, `replacesProject` (`views.ts:67-71`);
- the precedence order, which v1 §9.2 says to keep.

Parsing is effectively free (<0.01 ms).

**Must change:**
1. Return `{status:"matched"|"none", confidence, ops}`. Confidence has to come from **coverage**: matched spans versus leftover content words. Every case in the false-positive table matched one keyword and dropped the rest. Below the threshold the result is `none` and goes to Claude.
2. The generic fall-through and the comparison/budget refusals (`:69-74`) become `none`. In v1, budget is a feature (§8.9) and Italian goes to Claude.
3. Remove or narrow the over-broad triggers that collide with the v1 vocabulary:
   - `deadlines?|due dates?|schedule|calendar|roadmap|over time` → timeline (`:802`);
   - `budget` → task cost (`:238`);
   - `/^start\b/` on the selected task (`:192`).
4. Stop writing captions in the parser. Captions should be composed from the applied ops (the §16 registry), so that no-ops ("already done") and dropped ops are reported honestly.
5. Drop "Demo mode ships one template" and the website-only create path outside `/demo`.
6. Change "Demo parser" / " · Claude unavailable, demo parser used" to " · basic mode".
7. Emit the v1 operation vocabulary.
8. Run the parser **before** the network in `store.submit`. Today the engine choice is global (`store.ts:148`).

**On the model side:**
- Hand-build the per-family strict tool schemas instead of using `betaZodOutputFormat`/`transformJSONSchema` (it strips `enum`/`const`). Do not use `betaZodTool` either: it sends raw `minLength`/`maximum`, which strict tools reject.
- Assert the limits (24 / 16 / 20) in a unit test over the compiled payload.
- Add timeouts, auth, rate limiting, prompt caching on the static prefix, a model set by env, and the §9.3 context fields (brief lines, computed dates, last 3 commands, today/timezone), with the 8k cap enforced.

---

## 11. Performance, bundle and automated accessibility scan (v1 §12, §13)

#### Method and environment

- **Build.** A copy of HEAD `177e822` (clean tree) made with `cp -cR` into the scratch dir, then `next build` (Next 16.4.0, Turbopack, `cacheComponents` on) and `next start -p 3499`. I attributed modules with `next analyze --output` (Turbopack module graph). Nothing under `/Users/nicolaromei/code/form` was modified.
- **Browser.** Chrome 155.0.8059.40 in new headless mode, driven by puppeteer-core 25.13. **The GPU is real here:** ANGLE Metal on Apple M5, GPU compositing on, Skia Graphite. Viewport 1440×900 at DPR 1. I ran with CPU throttling at 1× and 4× through CDP. 4× slows only the renderer main thread: GPU, raster and compositor threads still run at M5 speed. **These numbers come from a very fast desktop. They are not a mid-range phone.**
- **Instrumentation.**
  - A wrapper around `requestAnimationFrame`, injected before any app code, that adds up the time of the app's rAF callbacks per frame (Motion's frameloop, GSAP's ticker and `useAnimationFrame` all go through it).
  - Deltas from CDP `Performance.getMetrics`.
  - Chrome traces, read as busy time per thread from `toplevel` task intervals.
  - `PerformanceObserver` entries for longtask, LCP, layout-shift and Event Timing.
  - A computed-style census of every element whose `backdrop-filter` is not `none`.
- **Stress fixture.** Generated with jiti through the app's own reducer (`src/lib/ops.ts:298` `applyOperations`): `createProject` (4 template tasks), 56 `addTask`, then `updateTask` / `assignTask` to spread status, progress and owners, then `setRepresentation` for all six views, ending on `cards`.
  - Result: 60 top-level tasks, `DocSchema.safeParse` PASS, 13.6 KB, persisted as `{state:{doc,log:[]},version:1}` under `form.workspace.v1`, with `form.intro.seen.v1 = "1"`.
  - A 150-task variant from the same generator also passes `DocSchema`.
  - The axe fixture is the v0 demo project (website template, 4 tasks, sample team) with all six views.
- **Scripts and raw JSON** are kept in `docs/audit/harness/perf/`: `tools/lib.mjs`, `tools/runtime.mjs`, `tools/axe.mjs`, `tools/lcp.mjs`, `tools/fonts.mjs`, `scripts/gen-doc.mjs`, `scripts/gen-demo.mjs`, `scripts/derived-bench-n.mjs`, `scripts/analyze2.js`, `fixtures/`, `results/`. The Chrome traces (214 MB) were not kept.
- All servers and browsers I started have been stopped. Port 3417 (the user's dev server) was not touched.

#### Verdict against the v1 §12 targets

| Target (v1 §12) | Measured here | Status |
|---|---|---|
| Initial JS for the project route ≤ 180 KB gzip | **307.8 KB gzip** on the wire (300.6 KiB); 263.7 KB with brotli-11 | **Fail, +71%** |
| LCP < 2.5 s (p75, field) | Lab with mobile-like throttling (150 ms RTT, 1.6 Mbps, 4× CPU, median of 3): **3.96–5.02 s** | Likely fail. Field data needed. |
| INP < 200 ms | Lab, click to next paint on view tabs with 60 tasks. 1×: 40–264 ms. 4×: board **424–432**, tracker **296–352**, timeline **256–352** ms | Fails at 4× |
| CLS < 0.1 | 0 in every lab load | Pass (lab) |
| Agent ≤ 4 ms per frame on a mid-range phone | Agent JS is 0.10 ms/frame on M5. The rendering it triggers costs ≈1.4 ms/frame of main thread on M5 with 60 cards (A/B below), plus GPU work. | **Not measurable here.** Extrapolated, it is at risk. |
| Morph at 60 fps with 40 cards | Not measured at 40 cards. With 60 cards, tracker→board at 4×: 6–7 frames > 33 ms, worst gap 367–400 ms | Fails at 60 cards and 4× |

#### 1. Bundle

**First-load chunks for `/`.** These are the scripts referenced in `.next/server/app/index.html`. The `nomodule` polyfill `0cz1d0mv5g_q7.js` (39.6 KB gzip) is excluded because modern browsers don't load it. The gzip column is what `next start` actually served, which equals zlib level 6.

| Chunk | Content | Raw | Gzip (served) | Brotli-11 |
|---|---|---:|---:|---:|
| `3mf7y9s8li5bz.js` | All app code + motion, zod, gsap, zustand | 544,949 | **172,343** | 148,218 |
| `17_wby7e6lv7c.js` | Framework (Next runtime, React DOM) | 229,850 | 71,995 | 61,452 |
| `15q7nfrr5otxl.js` | Framework (Next router/runtime, React) | 182,602 | 48,950 | 41,140 |
| `3333gs1h_w689.js` | Framework (Next) | 20,744 | 6,975 | 6,119 |
| `turbopack-3-ry682tkyiqk.js` | Turbopack runtime | 10,030 | 3,940 | 3,512 |
| `2-rfe7f68bjl5.js` | Next client components (layout router…) | 14,090 | 3,602 | 3,221 |
| **Total JS** | | **1,002,265** | **307,805** | **263,662** |
| `2iir3edjo2f44.css` | Tailwind + globals | 52,966 | 9,864 | 8,383 |

- **The framework alone is about 135 KB gzip.** By minified size: React DOM 207.4 KB, Next runtime 201.8 KB, React 32.1 KB, Turbopack runtime 10.1 KB, scheduler 3.5 KB. That leaves **about 45 KB gzip** of the 180 KB budget for all app code on first load, if the target includes the framework (see Questions).
- **What is inside the app chunk.** Minified bytes are exact, from the Turbopack analyzer. Gzip is estimated by scaling the analyzer's per-module compressed sizes to the chunk's real gzip (factor 0.791).

  | Group | Minified | ≈ Gzip |
  |---|---:|---:|
  | motion (motion-dom 99.3K + framer-motion 38.3K + motion-utils 1.8K) | 139,356 | 52.4 KiB |
  | App: shell, agent, tracker, store, schema, ops | 103,378 | 31.3 KiB |
  | zod (Zod 4 classic, incl. `to-json-schema` 8.7K + `json-schema-processors` 8.6K) | 106,964 | 26.1 KiB |
  | gsap (core 51.6K, CSSPlugin 18.8K, SplitText 7.1K) | 77,479 | 23.8 KiB |
  | App: Board/Timeline/Team/Focus/Brief/Moodboard/ColorPicker + `brief`/`mood`/`team`/`focus` libs | 82,046 | 23.6 KiB |
  | App: demo parser (`src/lib/interpret/*`) | 29,750 | 8.6 KiB |
  | zustand | 4,232 | 1.6 KiB |

- **The Anthropic SDK is server-only.** Verified:
  - No module path matching `anthropic`, `server-only`, `claude.server` or `api/interpret` appears in any client chunk.
  - The string `anthropic` appears 0 times in `.next/static/chunks/*`.
  - The analyzer reports 0 bytes of client code for `/api/interpret`.
  - `src/lib/interpret/claude.server.ts:1` imports `server-only`.
  - The other libraries the task asked about are all shipped to the client and loaded eagerly: zod is needed at startup by `store.ts:346` (`DocSchema.safeParse` on hydrate) and `store.ts:169`; motion, gsap and zustand are also eager.
- **There is no code splitting.**
  - `src/` contains no `next/dynamic` and no `import(` (grep).
  - `src/components/workspace/registry.ts:4-13` statically imports every view and the moodboard.
  - GSAP and SplitText are imported and registered at module top in `src/components/text/TextMotion.tsx:3-9`, with further eager imports in `FocusView.tsx:5` and `blocks.tsx:5`.
  - Motion is used as `motion.*` everywhere; there is no `LazyMotion` or `m` (grep).
  - In the browser, opening every view, the intro and the composer fetched **zero** additional JS chunks.
  - So v1 §12.4 is not implemented at all.
- **Fonts.**
  - `src/app/layout.tsx:5-27` declares 6 faces with `display: "block"` and `adjustFontFallback: false`. All 6 are preloaded through RSC `HL` hints.
  - **322.8 KB of fonts are transferred on first load, more than the JS.**
  - After the intro, all six views and the composer, only 3 faces are actually used: `aeonik 400`, `aeonik 500`, `aeonikMono 400` (`document.fonts` status `loaded`).
  - **AeonikPro-Light, AeonikMonoPro-Light and AeonikMonoPro-Medium (158 KB) are never used** (0 `font-light` usages; `font-medium` is never applied to mono text).
  - This diverges from v1 §12.7: preload only Regular and Mono Regular, with a size-adjusted fallback.
- **The server HTML is empty.** The prerendered body is only `<div class="ground">`, because `ClientRoot` (`src/components/FormApp.tsx:94-101`) renders nothing until mount. First contentful paint therefore waits for the full 308 KB of JS plus hydration.
  - Every load also sends `GET /api/interpret` for engine discovery (`FormApp.tsx:28-33`).
  - Lab FCP under the throttling above: 3.60–3.90 s.
  - Lab LCP: first visit 4.16 s, return visit with empty workspace 5.02 s, return visit with the 60-task tracker 3.96 s. The LCP element is a `RevealText` word span. In the empty workspace it appears only after the idle-caption choreography delay.
- **Other v1 §12 items.**
  - `next.config.ts` has no `reactCompiler` (§12.8).
  - Ten components subscribe to the whole document with `useForm((s) => s.doc)` (§12.9): `FocusView.tsx:25`, `CardsView.tsx:14`, `BoardView.tsx:16`, `TeamView.tsx:53`, `blocks.tsx:47`, `blocks.tsx:305`, `blocks.tsx:375`, `TimelineView.tsx:26`, `Composer.tsx:24`, `BriefView.tsx:23`.

#### 2. Runtime

##### 2a. Idle agent: the rAF loop never stops

| State | fps | App rAF JS ms/frame (mean / p95) | Main thread ms/s (ms/frame) | Style + layout | GPU process `CrGpuMain` ms/s |
|---|---:|---|---|---|---:|
| Empty workspace, idle ring, 1× | 60 | 0.10 / 0.2 | 33.0 (0.55) | 1 + 1 every frame | 68.5 |
| Same, `prefers-reduced-motion: reduce`, 1× | 60 | 0.11 / 0.2 | 38.6 (0.64) | 1 + 1 every frame | — |
| Demo project open, agent docked, 1× | 60 | 0.07 / 0.2 | 33.8 (0.56) | 1 + 1 every frame | — |
| Empty workspace, 4× CPU | 60 | 0.13 / 0.6 | 58.9 (0.98) | 1 + 1 every frame | 22.6 |
| Demo project, 4× CPU | 60 | 0.11 / 0.5 | 69.2 (1.15) | 1 + 1 every frame | — |

- **The loop never stops.** I counted with a MutationObserver on the agent SVG.
  - After 20 s at rest: **3,000 attribute mutations per second** (10 ellipses × 5 attributes × 60 fps) and 60 app rAF callbacks per second.
  - The count is identical with reduced motion and with a project open.
  - Cause: `useAnimationFrame` in `src/components/agent/Fluid.tsx:202` has no settle or stop condition. With reduced motion, `Fluid.tsx:246-250` snaps the volumes to their home but `Fluid.tsx:287-291` still calls `setAttribute` five times per ellipse every frame.
  - The loop stops only when the tab is hidden (`document.hidden` → 0 mutations/s). That is the browser suspending rAF, not the app: there is no `visibilitychange` handling anywhere in `src`.
  - v1 §12.2 ("stop when the material has settled") is not implemented. v0 §13's "Il fluido è fermo" (the fluid is still) is true only visually.
- **The goo filter region is not limited to the agent.**
  - `AgentLayer.tsx:87-94` draws a fixed SVG over the full viewport (`fixed inset-0`, `width={vw} height={vh}`).
  - `#form-goo` uses the default `objectBoundingBox` region of −50% / 200% of the group's bounding box. That box grows to the whole screen while spawn blobs are in flight.
  - So §12.2's "goo region limited to the agent's box" is not met.
- **The cost is rendering, not JavaScript.** A/B test on the 60-card tracker at rest (1×, 4 s windows; CSS injected at runtime, app code unchanged):

  | Variant | Renderer main ms/s | Layouts / 4 s | `CrGpuMain` ms/s | `VizCompositorThread` ms/s |
  |---|---:|---:|---:|---:|
  | Baseline | 107.9 | 241 | 160.7 | 67.2 |
  | No `backdrop-filter` on task cards | 104.0 | 240 | **51.5** | 26.3 |
  | Agent SVG `display:none` (loop still runs) | **22.2** | **0** | < 0.5 | 2.8 |
  | Both | 14.0 | 0 | < 0.5 | 4.1 |

  - The trace of the tracker at rest shows **one full-document `Paint` per frame**: clip 1440×4821, the entire page height, 60 times per second. Alongside it, `RunPaintLifecyclePhase` takes 65 ms/s and `Layerize` 51 ms/s.
  - The agent SVG is not isolated on its own layer, so each idle frame repaints and re-layerizes the whole page. **The idle cost grows with content:** 33 ms/s on the empty workspace, 92–116 ms/s with 60 cards, 160–193 ms/s on board or timeline at rest (1×).
  - Removing the card blur cuts GPU-process time by about 68%, which supports v1 §12.1.
  - Attributable agent cost on M5 at 1× with 60 cards: (107.9 − 22.2) / 60 ≈ **1.4 ms/frame** of main thread, plus essentially all GPU work at rest.
  - Scaling that by 4–6× for a mid-range phone is an **inference, not a measurement**, but it puts the agent at roughly 4–9 ms/frame against the 4 ms budget.

##### 2b. Stress test: 60 top-level tasks

**Load:**

| | 1× (2 runs) | 4× (2 runs) |
|---|---|---|
| 60 `[data-task-id]` in the DOM after navigation start | 162–173 ms | 604–647 ms |
| Long tasks in the first 6 s | 1 (81–85 ms) | 3 (max 339–357 ms) |
| TBT, first 6 s | 31–35 ms | 336–363 ms |
| CLS | 0 | 0 |

**View switches by clicking tabs.** "Click → next paint" is the Event Timing `click` duration, a proxy for INP. Long tasks and frame gaps are measured over 3 s including the click.

| Switch | Click → next paint, 1× (run 1 / run 2) | Click → next paint, 4× (run 1 / run 2) | 4× run 2: long tasks (max) | 4× run 2: worst frame gap |
|---|---|---|---|---|
| Tracker → board | 264 / 128 ms | **424 / 432 ms** | 6 (359 ms) | 400 ms |
| → timeline | 72 / 72 | **352 / 256** | 2 (186) | 217 |
| → team | 64 / 40 | 120 / 120 | 1 (85) | 83 |
| → focus | 48 / 40 | 120 / 120 | 1 (94) | 83 |
| → brief | 48 / 48 | 184 / 184 | 1 (159) | 150 |
| → tracker | 72 / 72 | **296 / 352** | 3 (291) | 317 |

**At rest after each switch** (1×, run 2; the 4× figure is main-thread ms/frame):

| View | Main ms/frame (1×) | Main ms/frame (4×) | App rAF JS ms/frame | Attached DOM nodes | `backdrop-filter` elements |
|---|---:|---:|---:|---:|---:|
| Tracker | 1.94 | 2.31 | 0.11 | 2,891 | 67 |
| Board | 2.67 | 3.74 | 0.09 | 2,855 | 11 |
| Timeline | 3.20 | 4.49 | 0.12 | 1,704 | 8 |
| Team | 1.59 | 1.55 | 0.12 | 434 | 8 |
| Focus | 3.15 | 4.29 | **1.01** | 355 | 6 |
| Brief | 1.87 | 1.81 | 0.14 | 690 | 6 |

- **Focus renders one volume per task: 60 out of 60, with no cap** (`FocusView.tsx:27`). v1 §12.3 asks for at most 7 plus "+N".
  - Every volume has an infinite x/y float (`FocusView.tsx:190-192`, `304`); the number labels float the same way, and the five lobes animate forever (`273-275`).
  - All of it sits under `filter: url(#form-goo)` on a div inset by −300px (`FocusView.tsx:255`).
  - This is the most expensive steady state measured: style recalc 48–55 ms/s, GPU process 187–254 ms/s at 1×.
- **Timeline:** all 60 rows are in the DOM and no virtualizer exists. The v1 threshold is "over 60 rows", so this fixture sits exactly at it.
- **Birth choreography:** the code **already caps flying volumes at 6** (`Workspace.tsx:23` `.slice(0, 6)`, `CardsView.tsx:35` `spawnIndex={i < 6 ? i : null}`). **This diverges from v1 diagnosis #20** ("one ink volume per card at birth"). v1 §12.3 asks for 12.
- **Derived computations grow super-linearly.** Measured in Node 22 (V8) on the same M5, ms per call:

  | Function | 60 tasks | 150 tasks |
  |---|---:|---:|
  | `DocSchema.safeParse` (hydrate) | 0.05–0.24 | 0.36 |
  | `schedule` | 0.03–0.06 | 1.46 |
  | `focusPick` | 1.19–1.29 | **149.8** |
  | `composeBrief` (full; client or team) | 2.45–2.50 | **303–308** |
  | `loadsOf` / `balancePlan` | 0.01 / 0.03–0.05 | 0.03 / 0.16 |

  - Cause: `schedule` is O(n²), because `subtasksOf` scans `Object.values(doc.tasks)` for every top-level task (`selectors.ts:7-9`, `119`). `reasonsFor` calls `schedule(doc)` once per task (`focus.ts:44`), so `focusPick` is about O(n³). `composeBrief` calls both (`brief.ts:87-89`).
  - These results are recomputed on every document change (`FocusView.tsx:26`, `BriefView.tsx:27`, memoized on `[doc]`), and also from the parser (`demo.ts:277`).
  - At 150 tasks, the upper end of v1's 30–150 range, opening Focus or Brief would block the main thread for 150–300 ms per change on M5, and several times longer on a phone.
  - v1 §12.6 (memoize; move to a worker above 8 ms) is relevant, but the algorithm needs fixing first.

#### 3. `backdrop-filter` census

Elements whose computed `backdrop-filter` is not `none`, with the 60-task fixture:

| View | Total | In viewport | Breakdown | Summed area |
|---|---:|---:|---|---:|
| Tracker | **67** | 15 | 60 task cards (`TaskCard.tsx:123` `backdrop-blur-[22px]`), 6 `.glass` (top bar, metrics), 1 tab bar | 4.62 Mpx |
| Board | 11 | 11 | 4 lanes (`BoardView.tsx:45`) + 6 `.glass` + tab bar. **Board cards are not blurred.** | 2.70 Mpx |
| Timeline | 8 | 8 | Glass panel (`TimelineView.tsx:64`), one very large surface, + chrome | 4.55 Mpx |
| Team | 8 | 8 | Panel (`TeamView.tsx:134`) + chrome | 0.51 Mpx |
| Focus | 6 | 6 | Chrome only | 0.03 Mpx |
| Brief | 6 | 6 | Chrome only | 0.03 Mpx |

- Not counted, because these states are not in the fixture: the Intro animates `backdropFilter` (`Intro.tsx:78-80`), composer suggestion chips use `backdrop-blur-md` (`Composer.tsx:280`), and every moodboard item is `.glass` / `.glass-hi` (`Moodboard.tsx:206`, `487`).
- **Correction to v0 and v1 wording.** Task cards do not use `.glass`. They use a Tailwind `backdrop-blur-[22px]` with an inline glass fill. The v1 §12.1 change must target `TaskCard.tsx:123`.
- **Correction to v1 diagnosis #20.** "Grids of cards, each with `backdrop-filter`" is true for the tracker only. On the board the lanes are blurred; the cards are not.
- **Surfaces that are blurred but not floating** under v1 §12.1: task cards, board lanes, the timeline and team panels, the metrics strip (`blocks.tsx:313`, `380`) and moodboard items.
- **Headless limits.** Here the GPU is a real M5 through Metal, which is far faster than a phone GPU. Blur cost on Safari/WebKit and mobile GPUs is not represented. Use the relative A/B (−68% GPU time) as the signal, not the absolute numbers.

#### 4. axe-core scan

axe-core 4.14, tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, `best-practice`. Each state was scanned after its entrance animation had settled (3.5–4.5 s). Demo project, 4 tasks.

| State | Violated rules | Nodes | Contrast not decidable by axe |
|---|---:|---:|---:|
| Intro open (first visit) | 2 | 8 | 29 |
| Empty workspace | 2 | 6 | 15 |
| Empty workspace, composer open | 1 | 4 | 12 |
| Tracker | 4 | 25 | 59 |
| Board | 4 | 25 | 55 |
| Timeline | 3 | 9 | 81 |
| Team | 3 | 8 | 62 |
| Focus | 3 | 8 | 26 |
| Brief | 3 | 18 | 28 |

**Violations by rule:**

- **`aria-prohibited-attr`** (serious, 4.1.2): 8 of 9 states, 2–4 nodes each.
  - Cause: `RevealText` / `DecodeText` put `aria-label` on a generic `span` or `p` with no role (`TextMotion.tsx:71`, `118`), while the visible copy is `aria-hidden`. Example: `<span aria-label="Project · Tracker"><span aria-hidden="true">…`.
  - An `aria-label` on a generic element is not reliably announced, so these texts can be silent to screen readers.
  - This undermines v0 §13's "animated texts with a screen-reader copy".
- **`target-size`** (serious, 2.5.8): 16 nodes in the tracker and board.
  - The priority dots measure 13×18 px (`parts.tsx:178`, `184`), against a 24×24 minimum. Confirms v1 #22.
- **`label-content-name-mismatch`** (serious, 2.5.3): 4 nodes in the tracker, board and timeline.
  - The number badge shows "01", but its accessible name is "Select {task} to ask FORM about it" (`parts.tsx:422`).
- **`color-contrast`** (serious, 1.4.3), confirmed only where axe could compute a background:
  - Team: 3 nodes (`text-text-3` 2.53:1; `opacity-70` 1.86:1).
  - Focus: 2 nodes (`text-on-ink-3` "Next" / "Complete", 2.86:1).
  - Brief: 13 nodes (mono eyebrow 2.55:1).
- **`region`** (moderate, best-practice): 3–4 nodes in every state. Corner metadata, the idle caption, the composer input and the ViewNodes group all sit outside a landmark, because `AgentLayer` and `Chrome` render outside `<main>` (`FormApp.tsx:75-89`).

**Contrast cannot be gated with axe alone.**
- Between 12 and 81 nodes per state come back as `incomplete`, for these reasons (counts in parentheses):
  - `bgGradient` (8–69 per state): the fixed `.ground` radial gradient (`globals.css:192-199`) sits behind all text.
  - `imgNode` and `shortTextContent`: about 1–12 per state.
  - `bgOverlap` and partially-obscured nodes: a handful.
- As a result, "axe without violations" (v1 §14.4) would **pass silently on contrast**.
- Token math, computed against `globals.css:21-44`:
  - `--text-2` (58%): 4.59:1 on paper, but **4.44:1 on `--paper-lo`**, which the ground gradient reaches at the edges.
  - **`--text-3` (38%): 2.50:1.** The token in the code is 38%, not 40%; v1 #21 quotes 40% ≈ 2.6:1, which is slightly optimistic.
  - `--text-4` (20%): 1.56:1.
  - `--on-ink-3` (34%) on ink: 2.87:1.
  - `#ff3b2f`: 2.92:1 on paper, 3.22:1 on glass. The proposed `#c0221a`: 4.95:1.
  - Dimmed cards: `TaskCard.tsx:104` sets `opacity: 0.55` on the whole surface, text included. Primary text drops to about 3.9:1 and `text-2` to about 2.0:1. Confirms v1 #21.
- **Gaps axe does not cover**, which need keyboard and screen-reader tests in Playwright plus VoiceOver:
  - The intro is declared `role="dialog" aria-modal="true"` (`Intro.tsx:86-87`), but axe does not test for a focus trap.
  - Tabs have no roving tabindex or arrow-key handling (`blocks.tsx:166-176`).
  - Dragging alternatives (2.5.7).
  - The caption timer.

#### 5. Safari and real devices

Safari cannot be automated in this environment. `safaridriver` needs "Allow Remote Automation", a system setting that is out of bounds for this audit. Headless Chrome on M5 also cannot stand in for WebKit's `backdrop-filter` and SVG-filter costs or for a phone GPU. Manual protocol:

1. **Setup.** Use the production build: Vercel preview, or `next build && next start`. Safari 26 on macOS with Develop → Web Inspector. A mid-range iPhone (Nicola to choose; for example iPhone 12/13 or SE 3rd gen) on USB with Web Inspector enabled. Use the same session for every run.
2. **Fixtures.** Paste in the console:
   - `localStorage.setItem('form.intro.seen.v1','1')`
   - `localStorage.setItem('form.workspace.v1', <contents of doc60.json>)`
   - Then reload.
   - For the empty workspace: `localStorage.removeItem('form.workspace.v1')`.
3. **Timelines.** Enable Timelines → *Rendering Frames*, *CPU*, *JavaScript & Events*, *Layout & Rendering*. Record 10 s at rest in each of: empty workspace, 60-card tracker, focus, board, timeline. Then record each tab switch (start recording, click, stop after 3 s).
4. **Report per state.** Median of 3 runs:
   - Frame duration p50 and p95.
   - Share of frames over 16.7 ms.
   - Main-thread CPU %.
   - Longest frame during each switch.
   - On the phone, add Xcode Instruments → *Animation Hitches* for GPU and compositor cost, which Web Inspector does not show.
5. **Attribution A/B.** Repeat step 3 with:
   - `document.head.insertAdjacentHTML('beforeend','<style>svg.fixed.inset-0{display:none!important}</style>')` to remove the agent's paint.
   - `[data-task-id]{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}` to remove card blur.
   - Agent cost per frame = (baseline − agent hidden) / frames. This is the quantity to compare against the "≤ 4 ms per frame on a mid-range phone" target.
6. **Also run** with iOS Low Power Mode on and with Reduce Motion on.
7. **Android equivalent.** Chrome remote DevTools Performance panel on a mid-tier Android device, or the WebPageTest Moto G profile, using the same fixtures. Field numbers come only from Speed Insights (p75) once deployed.

---

## 12. Accessibility and contrast, static review against WCAG 2.2 AA (v1 §13)

**Scope and method.** This is a static reading of `src/` at HEAD `177e822`. Contrast was computed numerically with alpha compositing in sRGB and the WCAG 2.x relative-luminance formula. Font files were inspected by decoding their WOFF2 `name` and `OS/2` tables. Nothing was rendered in a browser or tested with assistive technology. Every point that depends on rendering or AT is marked, together with how to measure it. The scripts and raw output are kept in `docs/audit/harness/a11y/` (`contrast.mjs`, `contrast.out`, `check2.mjs`, `check3.mjs`, `woff2name.mjs`).

**Verdict.** v0 does not meet WCAG 2.2 AA. Four problem areas block it:

1. **Tertiary text contrast.** The tertiary text token is 2.4–2.6:1 everywhere. It is used 68 times as `text-text-3` and 11 times as `--c-fg-3`.
2. **The caption.** The caption is the agent's only verbal channel. It reaches assistive technology through an ARIA pattern the spec prohibits, inside a live region that is re-mounted for every caption.
3. **Keyboard.** Popover menus, the moodboard and Team segments cannot be operated from the keyboard.
4. **Target size.** The priority dots fail 2.5.8.

Diagnosis items 21–22 are confirmed, and in several places the real problem is wider than they describe (details below).

#### 1. Contrast

**Effective surfaces** (composited over the ground):

| Surface | Source | Effective colour |
|---|---|---|
| paper | `--paper` globals.css:11 | `#e9e9e6` |
| paper-lo (ground falloff toward edges) | `.ground` radial globals.css:195-197 | `#dcdcd8` |
| glass (white 52%) | globals.css:37 over paper | `#f4f4f3` |
| glass-hi (rgba(250,250,248,.92)) | globals.css:38 over paper | `#f9f9f7` |
| brief sheet | BriefView.tsx:55 | `#fbfbf9` |
| board card (white 72% on lane glass) | BoardView.tsx:94 | `#fcfcfc` |
| ink / ink card | `--ink`, TaskCard.tsx:12 | `#0a0a0a` / `#0c0c0c` |
| ink-material, lightest point (#161616 plus 7.5% radial white) | globals.css:216-218 | `#272727` |

**The ground is not flat `#e9e9e6`.** It is a radial gradient from `#f2f2ef` at the centre to `#dcdcd8` at the edges. Text near the viewport edges sits on the darker end, for example the corner metadata in Chrome.tsx:76-85. Backdrop blur and the 7.5% dot grid were ignored here. They should be confirmed by pixel sampling (see 13.5).

**Text tokens on light surfaces.** Nearly all UI text is 9.5–17px at weight 400, so the 4.5:1 threshold applies. Only `t-display-m` (26px) and larger count as large text.

| Token | Value | Uses | paper | paper-lo | glass | glass-hi | sheet | board card |
|---|---|---|---|---|---|---|---|---|
| text | `#0a0a0a` | – | 16.27 | 14.40 | 18.05 | 18.72 | 19.11 | 19.30 |
| text-2 | ink 58% | 34 + 5 (`--c-fg-2`) | 4.61 | **4.43 FAIL** | 4.76 | 4.81 | 4.84 | 4.85 |
| text-3 | ink 38% | 68 + 11 (`--c-fg-3`) | **2.49** | **2.44** | **2.53** | **2.54** | **2.54** | **2.55** |
| text-4 | ink 20% | 6 | 1.56 | 1.55 | 1.57 | 1.57 | 1.57 | 1.57 |
| signal as text | `#ff3b2f` | TaskCard.tsx:183, TeamView.tsx:485 | 2.92 | 2.58 | 3.24 | 3.36 | 3.42 | 3.46 |

text-3 fails even the 3:1 large-text threshold on every surface. text-4 and red text fail 4.5:1 on every surface.

**On ink.**

| Token | ink `#0a0a0a` | ink card `#0c0c0c` | ink-material lightest | Result |
|---|---|---|---|---|
| on-ink | 17.98 | 17.76 | 13.48 | pass |
| on-ink-2 (60%) | 6.72 | 6.71 | 5.82 | pass |
| on-ink-3 (34%) | **2.85** | **2.87** | **2.87** | FAIL |
| `on-ink/50` (PlanCard eyebrow, TeamView.tsx:506) | 4.94 | – | – | pass |
| signal `#ff3b2f` | 5.58 | 5.51 | – | pass |

**Where the failures land:**

- **text-3** covers:
  - every eyebrow (`t-meta`/`t-micro`)
  - the footers in Timeline, Team and Brief
  - the 21px Focus lead sentence (FocusView.tsx:155)
  - the Commands sheet description (CommandSheet.tsx:40)
  - the corner metadata (Chrome.tsx:76-85)
  - the contenteditable placeholder (globals.css:290-293)
- **text-4 is used for information**, not only for disabled controls. Each of these is about 1.56:1:
  - the Commands sheet hint "Create a project first" (CommandSheet.tsx:61)
  - weekend day numbers in the timeline (TimelineView.tsx:126)
  - the note placeholder (Moodboard.tsx:505)
  - the brief editor placeholder (BriefView.tsx:449)

  Disabled command rows and the disabled Arrange buttons (CommandSheet.tsx:70, Moodboard.tsx:162) are exempt as inactive components.
- **on-ink-3** covers:
  - the composer placeholder (globals.css:295-297): 2.84–2.87
  - "Clear" (Composer.tsx:204)
  - the Focus "Next" eyebrow and duration (FocusView.tsx:162,164)
  - the nucleus "%" and "Complete" (FocusView.tsx:395,397)
- **Colour-name placeholder** (ColorPicker.tsx:197): 2.50.

**Dimmed tasks.** Group opacity was computed as: the layer is rendered, opacity is applied, then the result is composited over the backdrop.

| Case | Evidence | Ratio |
|---|---|---|
| tracker card at 55%, primary ink title | TaskCard.tsx:32,104 | **4.42 FAIL** |
| tracker card at 55%, text-2 | same | 2.16 |
| tracker card at 55%, text-3 | same | 1.62 |
| board card at 55%, primary ink | BoardView.tsx:94 | **4.46 FAIL** |
| team segment at 50% | TeamView.tsx:443 | 3.89 |
| team segment "leaving" at 40% | TeamView.tsx:443 | 2.83 |
| timeline bar at 50%, % label outside the fill (text-2) | TimelineView.tsx:408,437 | 1.90 |
| timeline bar at 50%, % inside the ink fill | TimelineView.tsx:433 | 3.64 |

Diagnosis 21 is confirmed, and the real problem is wider than it states:

- Even primary ink text falls below 4.5:1 on a dimmed card.
- Dimming is not limited to the tracker. It also happens in Team (50% and 40%) and Timeline (50%).

**Non-text contrast (1.4.11, 3:1):**

| Element | Evidence | Ratio |
|---|---|---|
| priority dot "off" ring (15% ink) on card | parts.tsx:193, globals.css:237 | **1.39** |
| priority dot "off" ring on ink card (white 22%) | globals.css:251 | **1.93** |
| urgent dot on card glass / board card / badge | TaskCard.tsx:149, BoardView.tsx:106, parts.tsx:432 | 3.24 / 3.46 / 3.28 (pass, marginal) |
| urgent dot on timeline bar track | TimelineView.tsx:443 | **2.76** |
| over-capacity avatar ring against its paper ring-offset | TeamView.tsx:462 | **2.92** |
| over-capacity hatch `rgba(214,69,69,.2)` on glass | TeamView.tsx:24 | 1.30 (supplemental: the "+Nd over" text carries the meaning, but that text is 3.24) |
| switch off track (black 9%) on paper / knob against track | blocks.tsx:287-289 | **1.22 / 1.48** |
| dashed "unsized/leaving" segment border (text-3) | TeamView.tsx:439 | **2.55** |
| `.focus-ring` (ink) / `.focus-ring-ink` (white 70%) | globals.css:280,283 | 16.27 / 9.71 (pass) |
| contenteditable focus: 1px ring at 14% ink / fill change | globals.css:270-273 | **1.36 / 1.09** |
| colour-picker input focus (black 5% → 8%) | ColorPicker.tsx:130,197 | **1.07** |

**A second red exists.** The over-capacity hatch uses `rgba(214,69,69,…)` (TeamView.tsx:24) rather than `--signal`. This departs from v0's "only one functional colour".

**Checking the numbers in v1 diagnosis 21:**

- **"Ink at 40% ≈ 2.6:1; about 60% is needed."** Correct: 40% gives 2.64:1. The real token is 38%, which gives 2.49:1. The minimum alpha for 4.5:1 is 0.565 on glass, 0.575 on paper and 0.585 on paper-lo. **Use 0.60 as the floor.**
- **"`#ff3b2f` as text ≈ 2.9:1 on paper."** Confirmed at 2.92. As a graphic it passes 3:1, narrowly, on glass, glass-hi, the sheet and cards (3.06–3.46). It fails on paper (2.92), paper-lo (2.58) and the timeline bar track (2.76).
- **"`#c0221a` ≈ 5:1 on paper."** It is 4.95 on paper, but **4.38 on paper-lo** and **3.29 on ink**. A single value cannot work for every surface; the text token has to change per tone (light or dark).

**Proposed tokens (verified numerically):**

| Token | Now | Proposed | Verified range (light surfaces incl. dimmed card unless noted) |
|---|---|---|---|
| `--text-2` | ink .58 | `rgba(10,10,10,.72)` | 7.00–8.14 |
| `--text-3` | ink .38 | `rgba(10,10,10,.60)`, or `.62` for margin | 4.72–5.19 (.62: 5.04–5.58) |
| `--text-4` | ink .20 | keep, but **only** for disabled controls and decorative hairlines; never for information or placeholders | – |
| new `--line-strong` | – | `rgba(10,10,10,.46)` | 3.07–3.24 (use for priority off rings, switch off track (3.15; knob 3.83), meaningful dashed borders, editable focus ring (3.26)) |
| `--on-ink-2` | .60 | keep | 5.82–6.72 |
| `--on-ink-3` | .34 | `rgba(244,244,242,.56)` | 5.27–5.96 |
| `.tone-dark --c-dot-off` | white .22 | `rgba(255,255,255,.40)` | 3.79 |
| `--signal` (fills, strokes, dots) | `#ff3b2f` | keep, but only on glass, glass-hi, sheet, cards and ink | 3.06–5.58 |
| new `--signal-graphic` | – | `#e8261b`, wherever red sits on paper or the bar track | 3.23–4.33 light; 3.46 bar track; 4.45 ink |
| new `--signal-text` in `.tone-light` | – | `#b81f17` | 4.70–6.31 (v1's `#c0221a` fails paper-lo at 4.38) |
| `--signal-text` in `.tone-dark` | – | `#ff3b2f` | 5.51–5.58 |
| Dimming | group opacity .55 / .5 / .4 | dim the **surface** only (card background alpha .52 → .29, plus frame and shadow); never dim the text | text-3 at .60 on dimmed surface 5.03; text-2 at .72: 7.70 |

Raising the hatch to 3:1 would need stripes around 70% alpha (0.6 gives only 2.53), which would change the look. Keep the hatch as decoration and move "+Nd over" to `--signal-text`.

**Effect on the look.** These values compress the grey ramp from 100/58/38/20 to 100/72/60/(20 disabled). The step between secondary and tertiary text becomes small. Tertiary hierarchy would then have to come from type role (mono, uppercase, size) rather than lightness. This needs a design decision (see the questions).

#### 2. Keyboard, focus, ARIA

| # | SC | Evidence | Problem | Fix |
|---|---|---|---|---|
| K1 | 2.1.1, 2.4.3, 4.1.2 | parts.tsx:36-103; used at parts.tsx:136-158 (status), blocks.tsx:247-265 (sort), Moodboard.tsx:192-199 (colour) | **Popovers cannot be reached by keyboard.** They are portalled to the end of `document.body` (:85), so they come last in tab order. Focus is never moved into them. There is no arrow-key handling for `role="menu"` / `menuitemradio`. They close on **any** scroll in capture phase (:74), and tabbing toward them scrolls the page. | On open, focus the checked item. Use roving tabindex with ↑/↓/Home/End. Esc and Tab close and return focus to the anchor. Reposition on scroll instead of closing. Treat the colour picker as a dialog with a focus trap. |
| K2 | 4.1.3, 4.1.2 | Caption.tsx:55-65; TextMotion.tsx:71-79, 115-120 | **The caption is probably not announced.** The visible text sits in `aria-label` on a span with no role, and every word is `aria-hidden`. ARIA 1.2 does not allow naming the generic role, and axe flags it (`aria-prohibited-attr`). The `role="status"` node is also re-mounted with its content for every caption (`key={caption.id}`), and live regions inserted together with their content are announced unreliably. `DecodeText` has the same pattern in 9 places: eyebrows, the Focus eyebrow, the Moodboard title, the Intro. This contradicts v0 §13 ("animated texts with a screen-reader copy"). | Keep one visually-hidden `role="status"` node mounted permanently in FormApp and set its text to `caption.text`. Give `RevealText`/`DecodeText` the same pattern `ShuffleText` already uses: `sr-only` text plus `aria-hidden` visuals (ShuffleText.tsx:91-92). BriefView.tsx:64-66 already does this correctly. **Verify with VoiceOver (macOS, iOS) and NVDA.** |
| K3 | 2.2.1, 2.4.3 | Caption.tsx:30-35 | **Captions disappear on a fixed timer** (6.5s, or 14s for proposal/clarify) with no pause on hover or focus. If Undo inside the caption has focus when it unmounts, focus falls to `<body>`. Undo itself is not time-limited: ⌘Z (FormApp.tsx:41-46) and the top-bar Undo (Chrome.tsx:53) remain. | Follow v1 §13: pause on `pointerenter`/`focusin` and resume on leave. Do not auto-dismiss proposal or clarify captions. When a caption is dismissed while focus is inside it, move focus to the compact pill. |
| K4 | 2.1.1, 2.5.7, 2.4.7, 4.1.2 | Moodboard.tsx:370-398 (tile is a `motion.div`, no tabindex or role); select via `onPointerDown` only (387-391); note edit via `onDoubleClick` only (392); resize handle with no key handler and no focus ring (422-427); Delete works only after pointer selection (101-110) | **The moodboard is pointer-only.** Selecting, moving, resizing, removing and editing notes all need a pointer. The parser covers only add and arrange (demo.ts:522-531), so there is no command alternative per item. Tile images have `alt=""` (Moodboard.tsx:439). | Follow v1 §13: tiles become focusable (with a name taken from the note text, colour name, or "Image n"). Enter edits a note. Arrows move 1%, Shift+arrows 10%. Alt+arrows resize. Delete removes, with undo. Give the resize handle a 24px hit area. |
| K5 | 2.1.1, 2.5.7 | TeamView.tsx:79-126 (drag), 433-453 (`Segment` is a div without tabindex) | **Reassigning in Team is drag-only.** The only alternative is typing "Assign X to Y" (demo.ts:772); the palette offers just the fixed example "Assign Development to Sara" (suggestions.ts:90). Point & Ask selection in Team is also impossible by keyboard. Under 2.5.7 this is borderline; treat it as a fail for v1 §8.6. | Make segments buttons with `aria-pressed`. Add a "Move to…" menu sorted by free capacity. Use dnd-kit's keyboard sensor with live announcements. |
| K6 | 2.4.3 | Intro.tsx:56-67, 72-140; trigger Chrome.tsx:40 | **Intro has no focus trap** (confirms diagnosis 22). The background is not `inert`. Focus is not restored to "About" on close. Enter on `window` closes the dialog and calls `preventDefault`, so Enter on a background control after tabbing out does nothing except close the intro. | Trap Tab inside the dialog. Set `inert` on header, main and the agent layer. Restore focus to the trigger. Scope Enter to the "Enter FORM" button. |
| K7 | 4.1.2, 2.1.1 | blocks.tsx:152-199; panel blocks.tsx:442-456; BriefView.tsx:506-519 | **The tabs pattern is incomplete.** Every tab is in the tab order, there are no arrow keys (confirms diagnosis 22), there is no `aria-controls`, and the view has no `role="tabpanel"`. The Brief "Audience" control uses `tablist` for a two-state toggle with no panel. | Use the APG Tabs pattern: roving tabindex, ←/→/Home/End, and **manual** activation, because each switch commits an undo step (store.ts `setRepresentation`). Give CollectionBlock `role="tabpanel"` with `aria-labelledby`. Make Audience a radiogroup or `aria-pressed` buttons. |
| K8 | 2.4.3, 4.1.2 | AgentLayer.tsx:160 (pill unmounts while the composer is open); Composer.tsx:183 (`disabled={busy}`); store.ts:186 (closes on success); FormApp.tsx:57-58 vs Composer.tsx:91-94; CommandSheet.tsx:27-30 | **Composer focus is lost.** Focus drops to `<body>` while a command is processing and after the composer closes. Esc pressed on a sheet item closes the whole composer, not just the sheet. The sheet is `role="dialog"` with no focus management. | Use `readOnly` plus `aria-busy` instead of `disabled`. On close, return focus to the pill or to the selected task's badge. Turn the input and sheet into a combobox/listbox (`aria-activedescendant`, ↑/↓ while the sheet is open), or a plain region. |
| K9 | 2.4.7, 1.4.11 | globals.css:276-284; FocusView.tsx:284-307; Moodboard.tsx:422-427; globals.css:270-273; ColorPicker.tsx:130,197 | **Focus visibility.** A global `:focus{outline:none}` plus rings made only of box-shadow means **no indicator in forced-colors mode**. Focus volumes and the resize handle have no ring at all. The editable and input focus cues are 1.07–1.36:1. | Add `outline:2px solid transparent; outline-offset:2px` to `.focus-ring`. Add `focus-ring` to the elements listed. Use `--line-strong` for the editable ring. Add `@media (forced-colors: active)` rules for ink-filled active states. |
| K10 | 2.4.11 | Chrome.tsx:24-25 (fixed header and 72px veil); AgentLayer.tsx:64 (dock); Caption up to 600px wide; no `scroll-padding` anywhere | **Focus may be obscured.** The fixed header and bottom dock can fully cover small focused targets, such as 30px badges under the caption. | `html{scroll-padding-top:88px;scroll-padding-bottom:160px}`. Measure: in Playwright, tab through each view at 375×812 and 1440×900 and assert `elementFromPoint(centre)` is inside the focused element. |
| K11 | 2.5.8 | listed below | Target sizes. | See the per-element list and the priority-dot note below. |
| K12 | 1.1.1, 2.5.3, 1.3.1, 4.1.2 | listed below | Names and roles. | See the per-element list below. |
| K13 | 2.3.3 (AAA, info), 2.2.2 | listed below | Reduced-motion coverage and continuous motion. | See the coverage notes below. |

**K11, target sizes:**

- **Fail:**
  - **Priority dots** are 13×18px buttons at a 13px pitch (parts.tsx:184). 24px circles centred on adjacent dots overlap.
  - **Moodboard resize handle** is 18×18px and overlaps the tile, which is itself a target (Moodboard.tsx:426).
  - **Borderline:** Brief "Add a line" is 22px tall directly under a clickable line (BriefView.tsx:214).
- **Pass by spacing:**
  - estimate ± buttons 20×20 (parts.tsx:333; centres 48px apart)
  - step toggle 22×22 (parts.tsx:475)
  - timeline step toggle 20×20 (TimelineView.tsx:351)
  - brief line tools 22×22 at a 28px pitch (BriefView.tsx:313)
  - progress slider 20–22px tall (parts.tsx:266)
  - hue slider 14px tall (ColorPicker.tsx:119; the hex field is also an equivalent)
- **Pass by size:** number badge 30×30 (parts.tsx:427), status chip 30/44/26, colour presets 24, caption dismiss 28, timeline shift 26, moodboard remove 26 (Moodboard.tsx:416), lane buttons 24 tall.
- **Measure at runtime:** Team segments are `estimate × dayW − 4` wide and can drop below 24px on narrow screens with large capacities.
- **Hidden on touch:** the estimate ± buttons and the board's lane-move buttons (its non-drag alternative) are `opacity-0` until hover or focus (parts.tsx:333, BoardView.tsx:148). They are effectively invisible on touch devices.

**Priority dots: v1 cannot be followed as written.** v1 §13 asks for "area via padding, without changing the drawing". With four independent targets at the current 7px dot and 13px pitch, that is impossible: 24px targets force a 24px pitch. The options are:

- **(a)** One 24px-tall target whose face is the four dots. It opens a radiogroup, or acts as a roving radiogroup with arrow keys. This keeps the drawing.
- **(b)** A 24px pitch. This changes the spacing.

**K12, names and roles:**

- **`aria-label` on generic spans** for the urgent dots (TaskCard.tsx:149, BoardView.tsx:106, TimelineView.tsx:332). Use `role="img"` or sr-only text.
- **2.5.3 Label in Name fails:**
  - The number badge shows "01", but its name is "Select {title} to ask FORM about it" (parts.tsx:422,431).
  - Focus volumes show numbers (FocusView.tsx:329-334), but their name is "Focus on {title}" (FocusView.tsx:290).

  Start each name with the number.
- **No heading for the project or view.** The only headings are the sr-only h1 (FormApp.tsx:78) and the h2s for Intro, Commands, Moodboard and Brief. The project title is a span (blocks.tsx:75-77).
- **ProgressBlock reads every label twice.** The inverted copy needs `aria-hidden` (blocks.tsx:391,399).
- **Missing details:**
  - The progress slider has no `aria-valuetext` (parts.tsx:247-253).
  - Timeline bar names omit the dates (TimelineView.tsx:400).
  - Brief palette swatches have only a `title` (BriefView.tsx:124).
- **Status messages are not announced:** processing, "Copied" (BriefView.tsx:79), "Adding N images…" (Moodboard.tsx:148-150), and direct-manipulation results.

**K13, reduced motion.** `MotionConfig reducedMotion="user"` (FormApp.tsx:67) applies to Motion 14.1. In that version, reduced motion makes only **positional keys and layout** instant:

- width, height, top, left, right, bottom
- x, y, scale, rotate
- layout animations

Evidence: `node_modules/motion-dom/dist/es/animation/interfaces/visual-element-target.mjs:83-86`, `render/utils/keys-position.mjs`, `projection/node/create-projection-node.mjs:338-342`.

Covered:

- GSAP text reveals (TextMotion.tsx:60, blocks.tsx:95, FocusView.tsx:121,377)
- decode (TextMotion.tsx:90-94)
- shuffle (ShuffleText.tsx:37)
- fluid snapping (Fluid.tsx:236-240)
- creation choreography and processing beat (store.ts:155,185,192)
- tab growth (blocks.tsx:185-193)

This matches v0 §13.

**Not covered:**

- `clipPath` wipes (TimelineView.tsx:176-178, 403-415; TeamView.tsx:351-353)
- the ring `strokeDashoffset` (blocks.tsx:362-364)
- `scrollTo({behavior:"smooth"})` (blocks.tsx:147). The CSS rule at globals.css:307-313 does not override an explicit behaviour.
- Tailwind hover scales (for example Intro.tsx:131)
- `animate-pulse` (Moodboard.tsx:437)
- the rAF loop keeps running when reduced (Fluid.tsx:202)

**2.2.2 risk.** Endless ambient motion runs with no pause control for users who have not set reduced motion:

- Focus floats and lobes (FocusView.tsx:188-193, 271-276, 303-304, 330-331)
- agent "breathing" (Fluid.tsx:242)

Stop it after settling, as v1 §12.2 already requires for the agent, and cap the Focus floats.

**Works today:** `lang="en"`; header and main landmarks; switches use `role="switch"` with `aria-checked`; the progress slider supports arrows/Home/End (parts.tsx:232-241); the colour fields support keyboard nudges (ColorPicker.tsx:79-86); click-to-set on sliders (a single-pointer alternative to dragging); board lane buttons as a non-drag alternative (BoardView.tsx:126-127); timeline bars are buttons with `aria-pressed`; Escape deselects; Undo is available from ⌘Z and the top bar.

#### 3. Font licence (facts only)

- **`src/fonts/`** contains only six `.woff2` files: Aeonik Pro and Aeonik Mono Pro, each in Light, Regular and Medium. There is **no licence, EULA or receipt file** in the repo, and the WOFF2 files have no metadata block.
- **What the font files say:**
  - All six: `name` ID 0 is "© CoType Foundry. All Rights Reserved.", and ID 14 points to `cotypefoundry.com/eula`.
  - Aeonik Mono Pro: copyright 2024, `name` ID 13 is "Retail", OS/2 `fsType` 0x0000.
  - Aeonik Pro: copyright 2020, no ID 13, `fsType` 0x0004 (Preview & Print).
  - The different years and fields show the two families come from different source builds.
- **What the repo says:**
  - README.md:65: "converted from the licensed Pro files".
  - layout.tsx:5: the comment says "licensed Pro files".
  - layout.tsx:17: the comment calls Mono the "Body + metadata role". This contradicts README, `globals.css` (`--font-meta` only) and v0 ("Mono only for eyebrows").
- **Loading:** `display:"block"` and `adjustFontFallback:false` (layout.tsx:8-9, 20-21). Text stays invisible during the block period. This conflicts with v1 §12.7, which asks for a fallback with `size-adjust`.
- **Cannot be determined here:** whether the licence held covers web or app embedding, self-conversion to WOFF2, public self-hosting under `/_next/static/media`, traffic tiers, or Vercel preview domains. Diagnosis 23 remains open until the CoType licence document is provided.

#### 4. Divergences from v0 §13 and the v1 diagnosis

- **v0 lists three known gaps** (intro trap, tab arrows, Team and Moodboard drag). The code has more:
  - popovers unreachable by keyboard (K1)
  - moodboard tiles not focusable at all, not just undraggable (K4)
  - Team segments not focusable (K5)
  - focus lost after closing the composer or intro (K6, K8)
  - caption timer (K3)
  - caption and eyebrow text exposed only through a prohibited `aria-label` (K2)
- **"Focus rings visible"** (v0) is only partly true (K9).
- **Diagnosis 21:**
  - The real tertiary token is 38%, not 40%.
  - Dimming also affects Team and Timeline, and also primary ink.
  - `#c0221a` fails on paper-lo and on ink.
- **Diagnosis 22:** the priority-dot failure is confirmed (13×18px at a 13px pitch). v1's "without changing the drawing" needs option (a).

#### 5. What cannot be measured here, and how to measure it

| What | How to measure |
|---|---|
| Real AT output: caption, RevealText/DecodeText, live regions | VoiceOver on macOS Safari and iOS, NVDA with Firefox and Chrome |
| Contrast over real backdrop blur, the dot grid and image-backed areas | Playwright screenshots with pixel sampling at text bounding boxes. axe `color-contrast` reports alpha and backdrop stacks as "needs review" |
| Focus Not Obscured (2.4.11) and runtime target sizes | Playwright: tab walk plus `getBoundingClientRect` on all interactive elements smaller than 24px |
| Reflow (1.4.10) and text spacing (1.4.12) | 320px viewport, 200% zoom, and the text-spacing CSS injection. Expect clipping risk from fixed heights with `truncate`, such as `h-[30px]`/`h-[46px]` and `SEG_H` |
| Forced colors | Playwright `forcedColors:'active'` |
| Reduced motion | `reducedMotion:'reduce'` plus `document.getAnimations()` |
| Automated baseline | axe in Playwright on every view, as v1 §13 requires. It will flag `aria-prohibited-attr`, `color-contrast` (text-3/4) and `target-size` |

---

## 13. Harnesses and raw results

`docs/audit/harness/` holds the scripts, fixtures (60- and 150-task documents) and JSON results behind every number above. See its README; Phase 1 moves the useful ones into `scripts/` and `e2e/`.
