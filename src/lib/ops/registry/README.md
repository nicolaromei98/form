# The operation registry

Plan §4 and §5. Every change to a document is one of 66 registry ops. Each op is one file that default-exports one `defineOp({…})`:

- workspace ops live in `workspace/<op>.ts` (20 files);
- project ops live in `project/<op>.ts` (46 files).

The reducer (`ops/reduce.ts`), the command runner (`ops/command.ts`), the captions, the palette, the transport list and the completeness test only read the contract in `_contract.ts`. Adding or changing an op never touches them.

All 66 ops are implemented. Step 9 shipped them as stubs, the five step 10 families filled them, and step 16 removed the last stub marks; the completeness test now fails on any op that carries one.

## Files

| File | What |
|---|---|
| `_contract.ts` | `OpDef`, `defineOp`, `ReduceCtx`, `Rejection` and `reject`, `CaptionPart` and `CaptionEnv`, fixture names, palette and transport types, `V0_OP_NAMES` |
| `_helpers.ts` | `setIfChanged`, `mustTask`, `mustStep`, `mustActivePerson`, `ensureFreshId`, `keyForPlace`, `idIndex`, `baseOf`, `captionKey`, wording helpers |
| `_tasks.ts`, `_views.ts`, `_mood.ts`, `_workspace.ts`, `_proposals.ts` | helpers of one family each; ops never import each other |
| `index.ts` | `REGISTRY`, `OP_NAMES`, `OpSchema`, `Op`, `OpName`, `OpOf`, `SYSTEM_OPS`; explicit imports of all 66 files |
| `workspace/*.ts`, `project/*.ts` | one op each |
| `__tests__/support.ts` | shared test helpers (`apply`, `run`, `expectApplied`, `expectNoop`, `expectRejection`, `expectInverse`) |
| `__tests__/completeness.test.ts` | plan §4.3, strict: no stub, every sample applies, 42 palette phrases, both spawners, every reject code |
| `__tests__/core.test.ts` | addTask, updateTask, removeTask, addDependency, setView |
| `__tests__/{tasks,views,moodboard,workspace,proposals}.test.ts` | one spec file per step 10 family |

| Family | Ops | Test file |
|---|---|---|
| tasks, steps, dependencies, pins, assignment, links, members, project fields, order | moveTask, removeDependency, pinStart, unpinStart, assignTask, unassignTask, addStep, updateStep, removeStep, reorderStep, addLink, removeLink, addMember, removeMember, updateProject, rebalanceOrder | `tasks.test.ts` |
| views, blocks, focus, brief | addView, removeView, setFocus, addBlock, removeBlock, editBriefLine, resetBriefLine, addBriefLine, updateBriefLine, removeBriefLine, resetBrief, markBriefSent, setBriefSharing | `views.test.ts` |
| moodboard (with `domain/mood-geometry`) | addMoodItems, updateMoodItem, removeMoodItem, arrangeMood, clearMood | `moodboard.test.ts` |
| workspace and the project index | updateWorkspace, setWorkspaceCalendar, addClosure, removeClosure, addPerson, updatePerson, archivePerson, restorePerson, deletePerson, linkPersonToMe, addTimeOff, removeTimeOff, saveTemplate, updateTemplate, deleteTemplate, createProject, duplicateProject, archiveProject, restoreProject, deleteProject | `workspace.test.ts` |
| proposals, with partial accept | proposeSubtasks, proposeReassign, proposeLeveling, proposeEstimates, proposePlan, acceptProposal, discardProposal | `proposals.test.ts` |

## Writing or changing an op

Start from `project/updateTask.ts` or another op of the same family. Then:

- `name` equals the file name and `scope` the folder; `deprecates`, `transport` and `activity` follow plan §4.4;
- write the strict `schema` (field ops are a discriminated union on `field`, as in updateTask);
- write the recipe:
  - it is total and never throws;
  - it refuses with `reject(code, message)`, in English, at most 140 characters, ready to follow "Couldn't apply that: ";
  - it never mints an id: `ensureFreshId` refuses a taken one with `duplicate_id`;
  - it never reads a clock (`ctx.now` only) and never iterates a record in key order (`sortedByOrder`, or sorted keys);
  - it writes through `setIfChanged` and the `transitions.ts` functions, so a same-value write produces no patch;
  - a person a project op names (owner, member) must be in the workspace (`invalid_reference`) and still in the team (`archived`): `mustActivePerson`;
- write `caption` (null for none), `noopCaption` (null when the op can't be a no-op), `undoable: true` and `idempotent`;
- fill `parser`, `palette` and `transport`, or give an `Exempt` with a reason of 10+ characters and, if it ends, an `until` phase above 1;
- write `sample(fx, mint)`, a payload that applies on `sampleOn` (default "demo"). It is typed loosely and the completeness test parses it with the schema. The named fixtures are in `test/fixtures/v2/named.ts`; `demoExtras` holds one of every optional entity (brief lines and edits, a closure, time off, a user template, mood items, an archived person and project, a person outside the project).

### Caption keys (`captionKey` in `_helpers.ts`)

A later part with the same key replaces the earlier one in place:

- `taskState(id)` is shared by status and progress.
- `show(view)` is the local show caption. setView's brief options use it too, so "Now make it for the team" reads as the brief's own caption.
- `viewAdded(view)` is addView's part. Its text must be `"{VIEW_LABEL} view added"`, so `announceView` folds it into the show caption ("Team view added · Marta over capacity").

### Unit tests

In the family's `__tests__/<family>.test.ts`, using `support.ts`, for every op:

- the happy path with its exact caption (`captionOf`);
- the no-op, by reference (`expectNoop`) plus `noopCaption`;
- every rejection it can produce, asserted only through `expectRejection(result, "code")`. The completeness test reads those calls and requires every `RejectCode`;
- undo by patches (`expectInverse`).

### Property generators

`test/property/gen/<op>.ts` default-exports an `OpGen`: `(step, state, mint) => rawOp | null`, built with the helpers in `gen/_pick.ts`.

- `picks[i] % 10 === 0` names a missing id.
- About 5% of payloads are corrupted by `materialise.ts` itself (an extra key, a wrong type, a missing field, 2.7, 2026-02-30, a retired v0 op name).
- Returning null skips the step.

The property suite (`test/property`, plan §10.3) draws all 66 ops through `runner.ts`:

- `reducer.property.test.ts`: properties 1–9 after every op, spawned projects included, and undo and redo of whole runs;
- `planning.property.test.ts`: property 10, `planProject` total on every reached state;
- `coverage.property.test.ts`: over 2,000 runs every op applies 20+ times, every idempotent op shows a no-op, and every reject code but `invalid_result` occurs.

A generator should reach "applied", "rejected" and, for idempotent ops, "noop" from the property start states (`materialise.ts`).

## Commands across documents

Plan §5.7. `runCommand` runs the workspace commit first, then the project commit, then the local intents (show, select and zoom; never ops), then one caption.

- No op mutates two documents.
- `createProject` and `duplicateProject` return the new project from `spawn`; undo drops it, redo brings it back (plan §5.8).
- The runner appends `rebalanceOrder`, a system op with no caption, when an order key passes 48 characters.
- Plan, lanes and focus reach captions through `CaptionPlanning` (`caption-env.ts`), which answers "unknown" until the store passes the planning engine; the property suite passes the real one.
