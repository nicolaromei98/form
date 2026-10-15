# FORM — The Living Interface

An adaptive workspace prototype. You describe what you're trying to do; the interface changes shape. The agent is the visual identity, and the tools it creates are made of the same material.

```bash
npm install
npm run dev -- --port 3417   # then open http://localhost:3417/demo
```

The app lives at **`/demo`**; `/` redirects there (a temporary 307) until the public intro and sign-in arrive in Phase 2. Commands run on a deterministic, rule-based parser in the browser: there is no AI model behind `/demo`, and the top bar says so (**Demo parser · no AI model**). Claude comes back in Phase 5, built on the operation registry.

## Demo script (≈ 90 s)

0. **Intro.** A first visit opens a short note over the blurred workspace: a personal project, in development, with what works today. The **ⓘ** button in the top bar reopens it.
1. **Empty workspace.** The organic agent floats in the centre. Hover it and its volumes draw in around a `• →` nucleus.
2. Click it (or press `/`). It stretches into the command capsule and one volume detaches to become the close button.
3. `Create a project tracker for my new website` → volumes leave the agent, fly to four slots, swell into ink silhouettes and cool into glass task cards. Only what you asked for exists: the view switch holds a single **Tracker** tab. Once the agent docks, three ink nodes bud off it (**+ Timeline**, **+ Board**, **+ Team**): the views most related to what you just made. Hover one and the pill shows the command it sends (`Add a timeline`); click it, or type it, and that view is created. (`Create a timeline for my project` or `Create a board for my new website` start the project as that view instead. A project starts as a tracker, board or timeline; the other views are added from there.)
4. Edit a task directly: click a title, change a status chip, drag a progress bar, tap priority dots.
5. `Make the cards more compact and sort them by priority` → cards morph into capsule rows and reorder. The workflow numbers stay with their tasks.
6. `Show this project as a timeline` (or the **+ Timeline** node) → a Timeline tab grows into the switch, the ink slides onto it, and the same entities become a staircase of bars. Renamed titles carry over. Every view is created the first time you ask for it, and the caption says so (`Timeline view added`); Undo removes it again.
7. Click the **UI Design** bar (or its number badge) → the composer shows it as context → `Break this task into smaller steps` → accept the proposal.
8. Click the **Tracker** tab (or `Change back to the original project tracker`) → compact layout, sort, edits and accepted steps are all still there. Refresh the page: they persist.
9. `What should I work on now?` → **Focus** (`Focus view added`). The task that matters most grows into an ink card with the reasons it was chosen (priority, the critical path, what waits on it; nothing is late against a sample schedule) and its next concrete step. Everything else melts back into the agent's material as fused volumes; click one to bring it into focus.
10. `Show the team workload` → **Team** (`Team view added`). Each person is a row whose track is their capacity over the weeks their work spans (capacity is days per week), with their open tasks laid along it by estimate; work past the capacity line is hatched red. The sample team (Marta 2, Sara 4 and Luca 5 days a week) starts with Marta 4 days over. `Balance the workload` → FORM proposes a handover (previewed on the rows: dashed where work leaves and lands, loads recalculated) → **Accept**. Drag any task onto someone else's row to hand it over yourself; `Who's overloaded?`, `Assign Development to Sara`, `Add Giulia to the team with 5 days a week`, `Set Marta's capacity to 4 days a week` also work. A person added by command has no capacity until you give one: FORM asks instead of inventing it.
11. `Write a status update for the client` → **Brief** (`Brief view added`). The cards hand over to a single paper sheet: the project as a written update, composed only from the document (headline, done, in progress, next, risks, open questions). Gaps are stated as questions, never filled in. `Now make it for the team` rewrites only the sentences that change (owners, overload, costs); `Make it shorter` keeps what's moving, next and at risk; editing a task (`Mark UI Design in review`) rewrites its sentence in place. Task names are selectable for Point & Ask, and **Copy** puts it on the clipboard (rich text, with a plain-text fallback). The brief is yours to rewrite: click any sentence to edit it in place (`Enter` saves, `Esc` cancels; `Enter` on an emptied sentence hides it, and **Show hidden** brings it back), **+ Add a line** under any section, or **+ Add a note for the client** above everything. Your wording sticks while the project changes; if FORM would now say something different, the line is marked *FORM's version changed* with **Use FORM's** / **Keep mine**. Client and team versions keep separate edits. `Add to the brief: homepage preview on Friday` and `Add to the brief under risks: fonts still unlicensed` or `Add to the team brief: standup moved to 10` work from the composer, and **Reset to FORM's version** (or `Reset the brief`) drops your changes for that version.
12. `Show me everything again`, then `Add a moodboard for the project` → a free canvas of references opens below the tasks. Drop images from the desktop (or paste them, or **Add images**), drag them anywhere, resize from the corner, `Backspace` removes the selected one. `Add the colours #0C0C0C, off-white and terracotta` and `Add a note: warm, tactile, editorial` pin swatches and notes; `Tidy up the moodboard`, `Arrange the moodboard in a grid` or `… as a collage` re-lay it out, with colours gathered into a palette strip.

`Remove the board` (also `hide` / `delete` / `get rid of` a view) closes a view's tab without touching any data; the last view stays.

`⌘Z` / `⇧⌘Z` undo/redo · `Esc` closes the composer, then clears the selection · **Reset demo** (top right) is undoable.

## How it works

```
command ─► fast parser ─► registry ops ─► command runner + reducer ─► v2 documents ─► planning engine ─► hooks ─► components ─► Motion
```

Phase 1 rebuilt `/demo` on the v1 domain (`docs/PHASE-1-PLAN.md`); the look and motion are v0's.

- **`src/lib/domain/`**: schema v2 (a workspace document with people, the calendar and the project index; one document per project), ids, dates on `IsoDate`, money in cents, limits, labels and the invariants. Pure.
- **`src/lib/ops/`**: the operation registry (66 ops, each with its schema, recipe and caption), the deterministic Immer reducer (`reduce.ts`) and the command runner (`command.ts`). Operations are the only way anything changes a document; no code is generated at runtime.
- **`src/lib/planning/`**: the working-day calendar, the schedule (estimates and dependencies, unknowns propagated), risks, metrics, weekly load and the Team lanes, balance, leveling and focus. Pure, memoised by document.
- **`src/lib/compose/`**: the brief composer and its text exports (plain text and rich text for Copy).
- **`src/lib/interpret/fast/`**: the deterministic, rule-based parser for the flagship commands and sensible variations. It emits registry ops and is not a language model; anything it doesn't recognise is reported as unsupported.
- **`src/lib/migrate/`**: the v0 → v2 migration. A v0 save in this browser is migrated on first load, and the v0 keys are never written.
- **`src/lib/store/`**: the Zustand store (undo and redo by commit, gestures), the hooks that are the components' only data API, the action creators that mint ids, and the save to `localStorage` (`form.demo.v2`). See its `README.md`.
- **`src/lib/demo/`**: the sample team and template, the breakdown library and the demo's storage envelope.
- **`src/components/workspace/registry.ts`**: component registry (blocks, views, field components).
- **`src/components/workspace/BriefView.tsx`**: the brief. The composer turns metrics, schedule, focus reasons and team load into sentences of text and entity mentions; every sentence has a stable id, so the user's rewrites (keyed by audience and sentence, with the wording they replaced) and added lines survive data changes and are flagged when FORM's own wording moves on; the view keys each sentence by its text, so only changed sentences re-animate.
- **`src/components/workspace/TeamView.tsx`**: the team. People live in the workspace and task owners in the project; a lane is open work by estimate against the person's weekly capacity over their work window, and balance proposes handovers that fit the receiver as a plan the user accepts.
- **`src/components/workspace/Moodboard.tsx`** + **`src/lib/assets.ts`**: the moodboard block. Items live in the project in board-width units (so the arrangement scales with the viewport and undo/redo/persistence work as everywhere else); image files are downscaled and kept in this browser's IndexedDB, and the document only holds their ids.
- **`src/components/agent/`**: the agent. Circles and capsules are fused by one SVG goo filter, and every state (idle, hover, input, processing, emit, compact) is just a different geometry for the same volumes.

## Honesty rules built in

- Timeline dates are **derived** from a start date, estimates and dependencies on working days, and labelled as a sample until you set the start date. A task without an estimate stays unscheduled and says so, and so do the tasks that wait on it.
- Costs are never invented: "add an estimated cost" asks for an amount. Capacities aren't either: a person added by command has none until you give one.
- Proposed sub-steps are scaled to the parent's estimate and need explicit acceptance.
- Moodboard images only enter through the user's own files; the parser never invents them, and the board says they're stored in this browser.
- The top-right label says what interprets commands: **Demo parser · no AI model**.

## Configuration

`/demo` needs none: it runs entirely in the browser. `.env.example` lists the one build flag the e2e harness uses. The Claude path (`/api/interpret`) was removed in Phase 1 and returns in Phase 5.

## Type

**Satoshi** (Indian Type Foundry, ITF Free Font License) for everything · **Geist Mono** (SIL OFL, via `next/font/google`) only for eyebrows (small uppercase labels). Satoshi is the official variable woff2, self-hosted unmodified in `src/fonts/satoshi/` with its licence; the licence forbids modifying the file and redistributing it through a public repository, so this repository must stay private (or the font must move out of git) before it is ever made public.
