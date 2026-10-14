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
