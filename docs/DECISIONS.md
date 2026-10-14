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
