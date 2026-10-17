# The /demo store

Plan §1.1, §5.7, §5.8, §7.3 and §8.1. The store runs `/demo` on the v2 documents: the registry's ops through the command runner, the planning engine behind every derived value, undo and redo by commit, gestures from their base, and the `form.demo.v2` save.

Components read through `hooks.ts` and change data through `useActions()`. They never import `form.ts`, the reducer, the runner, the migration or `lib/demo` (lint-enforced).

## Files

| File | What |
|---|---|
| `engine.ts` | Framework-free. `run` (the runner with `CAPTION_PLANNING`, the one real planning engine for captions), `parserContext` (what `fastParse` reads), history entries, `undo` and `redo` per commit, `landing` (the project and tab after undo or redo), gestures (`beginGesture`, `coalesce`, `liveGesture`, `endGesture`) and `pathsTouched` |
| `form.ts` | The Zustand store (vanilla `createStore`): `createFormStore(deps)`, `getFormStore()` (the app's, created on first use) and `exposeFormHandle()` (`window.__form`, outside production or with `NEXT_PUBLIC_FORM_E2E=1`) |
| `hooks.ts` | The components' data API, `FormStoreProvider` (another store, for tests), `useActions()` and `useFormRuntime()` |
| `actions.ts` | `makeActions(store)`: the store's actions and the creators that mint ids (`addTaskAtEnd`, `addStep`, `addImages`, `addColour`, `addNote`, `addPerson`, `addSampleTeam`, `addBriefLine`, `shiftStart`, `createDemoProject`); types only for components |
| `selectors.ts` | Memoised selectors over the documents, the open project, the local state and today |
| `suggestions.ts` | `suggestionsFor` (ported from v0): the agent's chips and nodes |
| `fx.ts` | The motion signal (`fxFor`, ported from v0): create, shift, reflow, edit, restore |
| `persist.ts` | The 250 ms debounced save, skipped while a gesture is open |
| `view-url.ts` | `?view=` read at hydration, written with `history.replaceState` |
| `today.ts` | Today in the workspace zone, and the midnight ticker |

`lib/demo/storage.ts` loads and saves the envelope (first-load migration, `.backup` for an unreadable save, compaction). `lib/assets.ts` resolves `ast_` ids, with the migration's aliases to the v0 `img-` keys.

## Rules

- **Every change is a command.** `commit(ops, { label })` for direct edits (quiet: no caption unless refused or resolving a proposal), `submit(text)` for typed commands (the parser, the 340 ms beat, the caption), the gesture API for drags and sliders. One command is one history entry, or none when nothing changed.
- **Local intents are not history (Q6).** `showView` and `select` change only the local state. Undo returns to the tab a command left only when that command changed the tab.
- **Ids are minted by producers.** Components call the creators in `actions.ts`; the reducer never mints one.
- **Gestures.** `live(ops)` recomputes the documents from the gesture's base each frame (touched validation); `endGesture()` seals one full-validation command of the coalesced ops; `cancelGesture()` restores the base. The next action, or 400 ms without a frame, seals an open gesture. A drag that ends where it began leaves no entry.
- **Undo hands back the exact documents** each command started from (by reference), so memoised plans still hit; the patches serve documents that moved on (Phase 2).
- **Saving** writes only `form.demo.v2` (and `.backup` copies). The v0 keys are only read.

## Tests

`__tests__/` (happy-dom): `engine`, `form` (submit, Q6, undo and redo, gestures, reset, creators), `persist` (first load from every v0 fixture with a storage spy, debounce, gestures, compaction, reloads), `hooks` (render counts, derived data, the runtime), `suggestions`, `modules`. `test/property/store.property.test.ts` plays generated runs through the store, gestures included; `test/perf/store.perf.test.ts` holds the frame and commit budgets.
