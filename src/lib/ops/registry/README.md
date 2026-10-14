# The operation registry

Plan §4 and §5. Every change to a document is one of 66 registry ops. Each op is one file that default-exports one `defineOp({…})`:

- workspace ops live in `workspace/<op>.ts` (20 files);
- project ops live in `project/<op>.ts` (46 files).

The reducer (`ops/reduce.ts`), the command runner (`ops/command.ts`), the captions, the palette, the transport list and the completeness test only read the contract in `_contract.ts`. Adding or filling an op never touches them.

## Files

| File | What | Who edits it |
|---|---|---|
| `_contract.ts` | `OpDef`, `defineOp`, `ReduceCtx`, `Rejection` and `reject`, `CaptionPart` and `CaptionEnv`, fixtures, palette and transport types, `V0_OP_NAMES` | step 9 only |
| `_helpers.ts` | `setIfChanged`, `mustTask`, `mustStep`, `mustActivePerson`, `ensureFreshId`, `keyForPlace`, `idIndex`, `baseOf`, `captionKey`, wording helpers | step 9 only |
| `_stub.ts` | `stubOp`, used by the files not filled yet; delete it once nothing imports it | nobody |
| `index.ts` | `REGISTRY`, `OP_NAMES`, `OpSchema`, `Op`, `OpName`, `OpOf`; explicit imports of all 66 files | step 9 only |
| `workspace/*.ts`, `project/*.ts` | one op each | the op's family |
| `__tests__/support.ts` | shared test helpers (`apply`, `run`, `expectApplied`, `expectNoop`, `expectRejection`, `expectInverse`) | step 9 only |
| `__tests__/completeness.test.ts` | plan §4.3 | step 9 only |
| `__tests__/core.test.ts` | the step 9 ops: addTask, updateTask, removeTask, addDependency, setView | step 9 only |
| `__tests__/<family>.test.ts` | one spec file per step 10 family | that family |

## Step 10: the five families

Step 9 shipped every op as a file. 61 of them are stubs: `{ op }` alone parses, and the recipe refuses with `unknown_op`. Each stub already carries what plan §4.4 fixes: the scope, the activity, the v0 names it folds in (`deprecates`) and the §9.4 transport tool. Its doc comment repeats the payload and the caption from the table.

Each family works in its own sub-worktree. **A family edits only:**

1. its own op files, replacing each stub file whole with a real `defineOp`;
2. its own `__tests__/<family>.test.ts`;
3. its own `test/property/gen/<op>.ts` files;
4. optionally, one new helper module that only its ops import, under the name given below. Ops never import each other.

Nothing else changes: not `index.ts`, `_contract.ts`, `_helpers.ts`, `reduce.ts`, `command.ts`, `caption*.ts`, `palette.ts`, `build.ts`, `test/property/gen/index.ts`, `gen/_pick.ts`, `arbitraries.ts`, `materialise.ts`, `test/fixtures/**`, the completeness test or `core.test.ts`. If a family needs something there, it reports it instead of editing it.

| Family | Ops | Test file | Helper module |
|---|---|---|---|
| **10a** tasks, steps, dependencies, pins, assignment, links, members, project fields, order | moveTask, removeDependency, pinStart, unpinStart, assignTask, unassignTask, addStep, updateStep, removeStep, reorderStep, addLink, removeLink, addMember, removeMember, updateProject, rebalanceOrder | `tasks.test.ts` | `_tasks.ts` |
| **10b** views, blocks, focus, brief | addView, removeView, setFocus, addBlock, removeBlock, editBriefLine, resetBriefLine, addBriefLine, updateBriefLine, removeBriefLine, resetBrief, markBriefSent, setBriefSharing | `views.test.ts` | `_views.ts` |
| **10c** moodboard (with `domain/mood-geometry`) | addMoodItems, updateMoodItem, removeMoodItem, arrangeMood, clearMood | `moodboard.test.ts` | `_mood.ts` |
| **10d** workspace and the project index | updateWorkspace, setWorkspaceCalendar, addClosure, removeClosure, addPerson, updatePerson, archivePerson, restorePerson, deletePerson, linkPersonToMe, addTimeOff, removeTimeOff, saveTemplate, updateTemplate, deleteTemplate, createProject, duplicateProject, archiveProject, restoreProject, deleteProject | `workspace.test.ts` | `_workspace.ts` |
| **10e** proposals, with partial accept | proposeSubtasks, proposeReassign, proposeLeveling, proposeEstimates, proposePlan, acceptProposal, discardProposal | `proposals.test.ts` | `_proposals.ts` |

### Filling a stub

Start from `project/updateTask.ts` or another step 9 op. Then:

- keep `name`, `scope`, `deprecates`, `transport` and `activity` from the stub, unless plan §4.4 says otherwise;
- write the strict `schema` (field ops are a discriminated union on `field`, as in updateTask);
- write the recipe:
  - it is total and never throws;
  - it refuses with `reject(code, message)`, in English, at most 140 characters, ready to follow "Couldn't apply that: ";
  - it never mints an id: `ensureFreshId` refuses a taken one with `duplicate_id`;
  - it never reads a clock (`ctx.now` only) and never iterates a record in key order (`sortedByOrder`, or sorted keys);
  - it writes through `setIfChanged` and the `transitions.ts` functions, so a same-value write produces no patch;
- write `caption` (null for none), `noopCaption` (null when the op can't be a no-op), `undoable: true` and `idempotent`;
- fill `parser`, `palette` and `transport`, or give an `Exempt` with a reason of 10+ characters and, if it ends, an `until` phase above 1;
- write `sample(fx, mint)`, a payload that applies on `sampleOn` (default "demo"). It is typed loosely and the completeness test parses it with the schema;
- delete the `stub` mark by replacing the whole file. The completeness test then checks the op fully.

### Caption keys (`captionKey` in `_helpers.ts`)

A later part with the same key replaces the earlier one in place:

- `taskState(id)` is shared by status and progress.
- `show(view)` is the local show caption. setView's brief options use it too, so "Now make it for the team" reads as the brief's own caption.
- `viewAdded(view)` is addView's part. Its text must be `"{VIEW_LABEL} view added"`, so `announceView` folds it into the show caption ("Team view added · Marta over capacity").

### Palette phrases still to place

The palette totals 42 entries. Step 9 placed 15 of them: updateTask 3, setView 8 and local show 4. The other 27, with their group and rank (v0 order × 10), are:

- **10a:** assignTask: Team "Assign Development to Sara" (40).
- **10b:**
  - setFocus: Decide "What should I work on now?" (10) and "Focus on Development" (20);
  - addView: Add a view "Add a timeline" (10), "Add a board" (20), "Add the tracker" (30), "Add the team view" (40), "Add focus" (50) and "Add a brief" (60);
  - addBlock: Layout "Add a progress indicator" (60) and Moodboard "Add a moodboard for the project" (10);
  - removeBlock: Moodboard "Hide the moodboard" (70);
  - addBriefLine: Brief "Add to the brief: homepage preview on Friday" (50);
  - resetBrief: Brief "Reset the brief" (60).
- **10c:**
  - addMoodItems: Moodboard "Add the colours #0C0C0C, off-white and terracotta" (20) and "Add a note: warm, tactile, editorial" (30);
  - arrangeMood: Moodboard "Tidy up the moodboard" (40), "Arrange the moodboard in a grid" (50) and "Arrange the moodboard as a collage" (60).
- **10d:**
  - createProject: Create "Create a timeline for my project" (10), "Create a project tracker for my new website" (20) and "Create a board for my new website" (30);
  - addPerson: Team "Add Giulia and Paolo to the team" (50) and "Add a sample team" (70);
  - updatePerson: Team "Set Marta's capacity to 4 days a week" (60).
- **10e:** proposeSubtasks: Selected task "Break this task into smaller steps" (10); proposeReassign: Team "Balance the workload" (30).

### Tests a family must add

In `__tests__/<family>.test.ts`, using `support.ts`, for every op:

- the happy path with its exact caption (`captionOf`);
- the no-op, by reference (`expectNoop`) plus `noopCaption`;
- every rejection it can produce, asserted only through `expectRejection(result, "code")`. The completeness test reads those calls;
- undo by patches (`expectInverse`).

Some reject codes have a single producer, and the completeness test requires them as soon as that op is filled:

- `last_view` from removeView and `protected_block` from removeBlock (10b);
- `owns_tasks` from deletePerson (10d);
- `stale_proposal` from acceptProposal (10e).

`command.test.ts` holds a rebalance test that is skipped while rebalanceOrder is a stub. Once 10a fills the op, the test runs: the runner sends `{ op: "rebalanceOrder", keys: Record<TaskId, OrderKey> }` with `nKeys(n)` in workflow order.

### Property generators

`test/property/gen/<op>.ts` default-exports an `OpGen`: `(step, state, mint) => rawOp | null`, built with the helpers in `gen/_pick.ts`.

- `picks[i] % 10 === 0` names a missing id.
- About 5% of payloads are corrupted by `materialise.ts` itself.
- Returning null skips the step.

`reducer.property.test.ts` draws every op that isn't a stub, so a filled op joins properties 1–9 automatically. Its generator should reach "applied", "rejected" and, for idempotent ops, "noop": at 200 runs or more, the suite asserts each of them.

## Commands across documents

Plan §5.7. `runCommand` runs the workspace commit first, then the project commit, then the local intents (show, select and zoom; never ops), then one caption.

- No op mutates two documents.
- `createProject` and `duplicateProject` return the new project from `spawn`.
- Plan, lanes and focus reach captions through `CaptionPlanning` (`caption-env.ts`), which answers "unknown" until the store passes the planning engine (steps 11–12).
