# FORM — The Living Interface

An adaptive workspace prototype. You describe what you're trying to do; the interface changes shape. The agent is the visual identity, and the tools it creates are made of the same material.

```bash
npm install
npm run dev -- --port 3417
```

## Demo script (≈ 90 s)

0. **Intro.** A first visit opens a short note over the blurred workspace: a personal project, in development, with what works today. The **ⓘ** button in the top bar reopens it.
1. **Empty workspace.** The organic agent floats in the centre. Hover it and its volumes draw in around a `• →` nucleus.
2. Click it (or press `/`). It stretches into the command capsule and one volume detaches to become the close button.
3. `Create a project tracker for my new website` → volumes leave the agent, fly to four slots, swell into ink silhouettes and cool into glass task cards.
4. Edit a task directly: click a title, change a status chip, drag a progress bar, tap priority dots.
5. `Make the cards more compact and sort them by priority` → cards morph into capsule rows and reorder. The workflow numbers stay with their tasks.
6. `Show this project as a timeline` → the same entities become a staircase of bars. Renamed titles carry over.
7. Click the **UI Design** bar (or its number badge) → the composer shows it as context → `Break this task into smaller steps` → accept the proposal.
8. `Change back to the original project tracker` → compact layout, sort, edits and accepted steps are all still there. Refresh the page: they persist.
9. `What should I work on now?` → **Focus**. The task that matters most grows into an ink card with the reasons it was chosen (priority, lag against the sample schedule, what waits on it) and its next concrete step. Everything else melts back into the agent's material as fused volumes; click one to bring it into focus.
10. `Show the team workload` → **Team**. Each person is a row whose track is their capacity in days, with their open tasks laid along it by estimate; work past the capacity line is hatched red. The sample team starts with Marta 3 days over. `Balance the workload` → FORM proposes a handover (previewed on the rows: dashed where work leaves and lands, loads recalculated) → **Accept**. Drag any task onto someone else's row to hand it over yourself; `Who's overloaded?`, `Assign Development to Sara`, `Add Giulia to the team with 5 days`, `Set Marta's capacity to 10 days` also work.
11. `Write a status update for the client` → **Brief**. The cards hand over to a single paper sheet: the project as a written update, composed only from the document (headline, done, in progress, next, risks, open questions). Gaps are stated as questions, never filled in. `Now make it for the team` rewrites only the sentences that change (owners, overload, costs); `Make it shorter` keeps what's moving, next and at risk; editing a task (`Mark UI Design in review`) rewrites its sentence in place. Task names are selectable for Point & Ask, and **Copy** puts it on the clipboard as Markdown.
12. `Show me everything again`, then `Add a moodboard for the project` → a free canvas of references opens below the tasks. Drop images from the desktop (or paste them, or **Add images**), drag them anywhere, resize from the corner, `Backspace` removes the selected one. `Add the colours #0C0C0C, off-white and terracotta` and `Add a note: warm, tactile, editorial` pin swatches and notes; `Tidy up the moodboard`, `Arrange the moodboard in a grid` or `… as a collage` re-lay it out, with colours gathered into a palette strip.

`⌘Z` / `⇧⌘Z` undo/redo · `Esc` closes the composer, then clears the selection · **Reset demo** (top right) is undoable.

## How it works

```
command ─► Interpreter (demo parser | Claude) ─► Zod-validated Operation[] ─► reducer ─► shared Doc ─► view adapters ─► Motion
```

- **`src/lib/schema.ts`**: semantic entities (tasks, `parentId` relationships), representation and layout config, tool blocks, proposals, and the closed **operation vocabulary** (`createProject`, `setRepresentation`, `setView`, `updateTask`, `addTask`, `proposeSubtasks`, `addBlock`, …).
- **`src/lib/ops.ts`**: pure reducer. Operations are the only way the intelligence layer can change the UI. No code is ever generated at runtime.
- **`src/lib/store.ts`**: Zustand store. The document is persisted to `localStorage`, history is session-only, and selection and agent phase are transient.
- **`src/lib/interpret/demo.ts`**: deterministic, rule-based parser for the flagship commands and sensible variations. It is not a language model. Anything it doesn't recognise is reported as unsupported.
- **`src/lib/interpret/claude.server.ts`** + **`src/app/api/interpret/route.ts`**: optional server-side interpreter. It sends the workspace and the command to Claude (`claude-opus-5-5`, low effort, structured output against the same Zod schema, server-side refusal fallback enabled), then drops unknown ids before anything reaches the client.
- **`src/components/workspace/registry.ts`**: component registry (blocks, representations, field components).
- **`src/components/workspace/BriefView.tsx`** + **`src/lib/brief.ts`**: the brief representation. A pure composer turns metrics, schedule, focus reasons and team load into sentences of text and entity mentions; the view keys each sentence by its text, so only changed sentences re-animate.
- **`src/components/workspace/TeamView.tsx`** + **`src/lib/team.ts`**: the team representation. People and task owners live in the document; load is open top-level work by estimate against each person's capacity, and the balance planner proposes handovers that fit the receiver (least-started tasks first) as a plan the user accepts.
- **`src/components/workspace/Moodboard.tsx`** + **`src/lib/mood.ts`** + **`src/lib/assets.ts`**: the moodboard block. Items live in the document in board-width units (so the arrangement scales with the viewport and undo/redo/persistence work as everywhere else); image files are downscaled and kept in this browser's IndexedDB, and the document only holds their ids.
- **`src/components/agent/`**: the agent. Circles and capsules are fused by one SVG goo filter, and every state (idle, hover, input, processing, emit, compact) is just a different geometry for the same volumes.

## Honesty rules built in

- Timeline dates are **derived** from a start date plus estimates in workflow order, and labelled as a sample until you set the start date. Tasks without an estimate stay unscheduled and say so.
- Costs are never invented: "add an estimated cost" asks for an amount.
- Proposed sub-steps are scaled to the parent's estimate and need explicit acceptance.
- Moodboard images only enter through the user's own files; neither parser invents them, and the board says they're stored in this browser.
- The top-right status shows which interpreter is active.

## Using Claude instead of the demo parser

```bash
cp .env.example .env.local   # then add ANTHROPIC_API_KEY
```

When the key is present the client switches to Claude automatically, and falls back to the demo parser on any error. Set `FORM_ENGINE=demo` to force the parser.

## Type

Display: **Aeonik Pro** (300/400/500) · Body + metadata: **Aeonik Mono Pro** (300/400/500). Self-hosted as woff2 in `src/fonts/`, converted from the licensed Pro files.
