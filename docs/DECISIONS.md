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
