# FORM · Phase 1 build plan: Domain

- **Branch:** `phase-1-domain`, cut from `main` at `b201af8`. `main` already runs Satoshi with Geist Mono and carries the v0 safety patch.
- **Inputs:** `docs/FORM-v1.md` (§4, §5, §7, §9.2, §9.4, §10, §15–§18), `docs/AUDIT.md` (§1, §5, §8–§12), `docs/DECISIONS.md` (Q1–Q31 with their refinements) and `docs/FORM-v0.md`.
- **Phase 1 delivers:**
  - schema v2;
  - a 66-op registry;
  - a deterministic Immer reducer;
  - the planning engine;
  - the invariants;
  - the v0 → v2 migration;
  - a fast parser that emits registry ops;
  - `/demo` rebuilt on the new engine, with the v0 look and motion;
  - the agent loop fix and the Q14 contrast tokens;
  - the test infrastructure (unit, property, golden, perf and visual tests).
- **Phase 1 does not deliver:**
  - a database, auth or a sync API;
  - `/app`, `/login` or `/b`, a project index UI or a task detail panel;
  - drag-and-drop;
  - the Timeline v2 visuals, the Team weekly grid, or agent v2 and Claude.

  The domain built now already supports all of these. Later phases only add UI and backend.

---

## 1. Decisions

### 1.1 Integration strategy and routes
- **Port, not adapter.** `/demo` runs on v2 documents from the reducer to the pixels.
  - Components stop reading a v0 `Doc`. They read v2 data through about 30 thin, memoised hooks (`src/lib/store/hooks.ts`), the only data API components may import.
  - No runtime v0 view-model, op lowering or façade exists, so Phase 3 extends these same components instead of migrating them a second time.
  - The v0 lib is deleted. Frozen copies live in `test/legacy/v0/` and are used only by golden tests.
- **The store is multi-document from day one.** `DocsState = { workspace, projects: Record<ProjectId, ProjectDoc> }`, and the demo holds at most one live project.
  - `src/lib/store/engine.ts` is framework-free. It covers runCommand, commit groups, undo and redo by patches, and gestures recomputed from their base. The Phase 2 sync queue reuses it unchanged.
- **Routes in Phase 1:**
  - `src/app/demo/page.tsx` renders the existing client root.
  - `src/app/page.tsx` is deleted.
  - `next.config.ts` adds `redirects()` with `{ source: "/", destination: "/demo", permanent: false }`. `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/redirects.md` confirms that `permanent: false` answers 307 and that redirects run before the filesystem.
  - Phase 2 replaces the redirect with the public intro, once "Sign in" exists.
  - Nothing is built yet for `/app`, `/login` or `/b`: without auth and data they would be dead UI.
  - Same origin as today, so the v0 localStorage and IndexedDB data carry over (Q15).
- **The route move ships alone as the first code commit.** It is pixel-checked against `main@b201af8` before any other change.
- **The Claude path is removed until Phase 5.** This covers `src/app/api/interpret/route.ts`, `src/lib/interpret/{index,claude.server}.ts`, engine discovery in `FormApp`, and the `@anthropic-ai/sdk` and `server-only` dependencies.
  - The path is opt-in, has never run, and is already past the API schema limits (AUDIT §10.C).
  - The top-bar engine label becomes the constant "Demo parser · no AI model". The tooltip and the Intro text are unchanged.

### 1.2 Data model
- **Two documents.** The workspace document holds settings, the calendar, people, user templates and the project index. Each project has its own document. Both carry `schemaVersion: 2` and a `docType`.
- **View state (Q6):**
  - **Content (commits, undoable, shown in Activity):** created views and blocks.
  - **viewConfig (commits, undoable, hidden from Activity):** sort, density, layout, columns, fields, filters, focus pin, and brief audience and length.
  - **Local intents (never in a commit or the undo stack):** active view, selection and timeline zoom.
- **Q7:** cross-document facts are computed at read time and never stored. These are owner validity, archived owners shown as unassigned, and derived cost.
- **Q9:** index operations commit on the workspace document. `createProject` and `duplicateProject` spawn a new project document in the same command.
  - Archived and deleted state lives only in the index entry (`archivedAt`, `deletedAt`).
  - `ProjectStatus` has no "archived" value.
  - No operation mutates two documents.
- **Collections:**
  - **Records keyed by id**, for collections that grow and churn: tasks, mood items, people, templates, closures, time off and the project index. Patch paths stay `["tasks", id, …]`.
  - **Arrays**, for small ordered lists: steps, brief lines, links, tags, `views`, `blocks`, `dependsOn` and `memberIds`.
  - **Order never depends on record key order.** Postgres `jsonb` reorders keys. Tasks and people carry an `order` key, and mood items carry a `z` key.
- **Ids are a prefix plus 16 characters of `[0-9a-z]`**, minted by producers (action creators, the parser, the migration) and carried in the payload.
  - The reducer never mints an id. A colliding id is rejected (`duplicate_id`) and never re-minted.
  - `duplicateProject` derives its ids deterministically with `deriveId(kind, newProjectId, oldId)`.
- **No stored `updatedAt`.** The Phase 2 doc row and the commit log carry modification times.
  - `createdAt` and `completedAt` are stored, and both come from `ctx.now`.
  - Patches stay field-precise, so no-op detection is exact and Phase 2 revert-conflict checks never collide on timestamps.
- **Updates are field-shaped:** `updateTask{taskId, field, value}`, `updateProject{field, value}`, and the same for people, steps and workspace. This is §16 "(campo)", and it maps one-to-one onto the §9.4 `field` + `value` transport.
- **Ordering is anchor-based.** Ops carry a `place` (`"start"`, `"end"` or `{after: TaskId}`), and the reducer computes the fractional key from the current neighbours, so a replay keeps the intent.
  - The runner appends an explicit `rebalanceOrder` op to the same commit when any key passes 48 characters.
- **Milestones** have `estimateDays = 0`, no steps and allocation 1 (v1 §5.5). `null` always means "unknown".
- **Q3, capacity:**
  - `capacityDaysPerWeek` is nullable.
  - The Team "Add person" button creates a person with a visible, editable 5.
  - A command that names no capacity stores `null`, and FORM asks through a suggestion chip.
  - "+ Duration" opens the stepper empty ("—"); the first "+" sets 0.5.
- **Money is integer cents in one currency per project:** `project.currency` plus `project.budgetCents`. Only manual `costCents` is stored. Derived cost (estimate × day rate) is computed at read time.
- **Task title limit is 140 (Q11); step titles are also 140.** Project titles are 80, person names 40, and the workspace name 60.
- **Size caps:** at most 500 tasks, 40 steps per task, 100 people, 200 mood items and 80 brief lines; 1 MB per document.

### 1.3 Behaviour
- **Status and progress.** One table, in `transitions.ts`, is the only implementation of §5.7. Each op changes exactly one of the two fields, and status changes happen through that table.
  - Reopening a Done task leaves it at 95%.
  - Turning `requireReview` off turns tasks In review at 100% into Done.
- **"Blocked"** means a To-do task with an unfinished predecessor. A task already In progress or In review is never hidden from Focus.
- **Unknown estimates propagate** to every successor, with a root cause. Float is `null` whenever a task or any of its transitive successors is unknown.
- **Late needs a confirmed start**, so the sample schedule is never late.
- **Load.** A task's daily share is `estimateDays / duration`, so total load equals the estimate exactly.
- **The Phase 1 Team lane** is the person's work window in ISO weeks, with over and free summed week by week, so slack in one week never hides overload in another.
  - The sample capacities are Marta 2, Sara 4 and Luca 5 days a week.
  - Team rows are the project's members.
- **Captions** are composed only from:
  - the ops actually applied, through the registry;
  - local-intent templates;
  - typed query notes;
  - fixed notices.

  The parser never writes a change caption. Clarify and unsupported replies keep their v0 wording.
- **Commits.**
  - At most 12 non-system ops per command.
  - Each op is atomic and validated after it applies (schema, invariants and size).
  - A rejected op is reported, and later ops still run.
  - A no-op returns the same reference and creates no history entry, no log entry and no undo button.
- **Proposals.** A new proposal replaces the pending one; undo restores it. `acceptProposal` names the proposal id and supports partial acceptance (`only`).
- **`removeTask`** bridges dependencies. It clears the focus pin, prunes proposal references and deletes the brief edits keyed to the task; undo restores all of it.
- **The parser.**
  - Confidence tiers are computed now (Q17): 1.0 exact palette phrase, 0.9 anchored template, 0.5 keyword rule.
  - `/demo` applies every match (threshold 0) and keeps the 340 ms beat for every command. The Q19 refinement waits for Phase 5.
  - "N weeks" means N × 5 working days.
- **`/demo` dates** stay absolute sample dates with the v0 "sample" labels. Relative labels ("D1–D3", "Week 2") are computed but first shown in Phase 4.

### 1.4 Process
- **v0 evidence is frozen before any change.** This covers fixtures, the legacy modules and baseline A screenshots, frames and videos.
- **Changes to v0 code land on the branch in three commits, in order:**
  1. the route move;
  2. the Q14 tokens with the component dimming edits;
  3. the agent loop fix.

  The result is tagged `phase1-baseline-b`. The engine switchover is gated against B at 0 differing pixels outside an explicit, reasoned allowlist.
- **Commits and pushes.** Every verified step is committed and pushed to `phase-1-domain`; `main` is untouched. The report gives the GitHub compare URL, then work stops for Nicola's review. Pushing the branch after each verified step is how the standing "push every change" rule applies to a phase branch.

---

## 2. Module layout

Pure code lives in `src/lib/{domain,planning,ops,compose,migrate}`, in `src/lib/interpret/fast` and in `src/lib/demo/{sample,seed,library}`. ESLint enforces it (§10.1). Unit tests sit next to the code in `__tests__/`; the property, golden and perf suites live in `test/`.

```
src/app/
  layout.tsx                         unchanged (Satoshi variable via next/font/local, Geist Mono via next/font/google, display swap)
  demo/page.tsx                      NEW: renders <ClientRoot/> (the v0 client-only mount)
  page.tsx                           DELETED: "/" → 307 → /demo in next.config.ts
  api/interpret/route.ts             DELETED until Phase 5
  globals.css                        Q14 tokens (own commit)
next.config.ts                       + redirects()

src/lib/phase.ts                     FORM_PHASE = 1 (exemptions with `until` ≤ FORM_PHASE fail the completeness test)

src/lib/domain/
  ids.ts                             ID_PREFIX, branded id schemas, Minter, nanoMinter, seededMinter, deriveId
  dates.ts                           DayNum ↔ IsoDate (integer civil algorithm, no Date), isoWeekday, isoWeek, todayIn(tz, nowMs), isIanaZone
  money.ts                           formatMoney(cents, currency) via Intl.NumberFormat("en-US")
  limits.ts                          every numeric cap (§3.9)
  order.ts                           fractional-indexing wrappers: keyBetween, keyAfter, nKeys, sortedByOrder (order key, then id)
  labels.ts                          STATUS/PRIORITY/VIEW/SORT/SECTION labels and orders (moved from lib/schema.ts)
  views.ts                           TASK_VIEWS, RELATED, nextViews, homeView (moved from lib/views.ts)
  starters.ts                        built-in starter templates per kind (titles and deps, estimates null); code, never stored
  mood-geometry.ts                   placeNext, arrange(masonry|grid|collage), clamps (moved from lib/mood.ts, keyed by id, z-ordered)
  colours.ts                         NAMED_COLOURS, normaliseHex (moved from the parser)
  schema/{primitives,ids,workspace,project,proposal,template,local,commit,demo,index}.ts
  invariants/transitions.ts          applyStatus, applyProgress, applyRequireReview, repairTask (migration only)
  invariants/graph.ts                topoOrder (heap by order key), wouldCycle → path | null, bridgeOnRemove, descendantBits
  invariants/check.ts                checkProject, checkWorkspace → Violation[]; resolveOwner (Q7, read time)

src/lib/planning/
  calendar.ts                        makeCalendar(spec), effectiveSpec(ws, project), personCalendar(ws, person), calendarKey
  schedule.ts                        forward/backward pass, unknown propagation, floats, critical set, step slots, end
  relative.ts                        relativeRange, relativeWeek
  risk.ts                            late, due, dueSoon, deadline (with the §17 sentences)
  metrics.ts                         estimate-weighted complete %, counts, budget, derived cost
  load.ts                            weeklyLoad (cross-project), capacityInWeek, notOnCalendar
  lanes.ts                           laneLoads: the Phase 1 single-lane Team projection
  balance.ts                         balance v2 (owner moves, shift fallback)
  level.ts                           serial schedule generation (proposeLeveling)
  focus.weights.ts                   FOCUS_WEIGHTS (§7.6, the single config file)
  focus.ts                           scores, blocked set, pick, why, project and "me" scope
  format.ts                          fmtDay/fmtShort/fmtWeekday/fmtDays (IsoDate), calendarOffsets (v0 day grid), dateMode
  memo.ts                            memoByRef, stage memos (WeakMap by document identity)
  index.ts                           planProject(project, ws, today) → ProjectPlan; planWorkspace(...) → WorkspacePlan

src/lib/ops/
  registry/_contract.ts              OpDef, defineOp, Rejection/RejectCode, CaptionPart, CaptionEnv, PaletteEntry, ParserExample, TransportSpec, Exempt
  registry/_helpers.ts               setIfChanged, mustTask, mustStep, ensureFreshId, keyForPlace, idIndex
  registry/index.ts                  REGISTRY, OpSchema, WorkspaceOpSchema, ProjectOpSchema, Op, OpName (explicit imports)
  registry/workspace/<op>.ts         20 files, one default export each
  registry/project/<op>.ts           46 files
  reduce.ts                          applyOp, applyCommit, validateDoc, validateTouched
  command.ts                         runCommand (partition by scope, spawn, local effects, caption)
  caption.ts                         composeCaption, announceView (port), the 280-character cut
  caption-env.ts                     makeCaptionEnv(state, today): lazy plan/lanes/focus/names
  local-intents.ts                   show/select/zoom: schemas, captions, palette entries (never ops)
  queries.ts                         QueryNote union and renderers (informational answers)
  notices.ts                         fixed notices: weekendsNow, demoOneTemplate, demoReadFailed
  build.ts                           typed op and seed constructors (used by the parser, actions, migration, tests)
  palette.ts                         PALETTE_GROUPS, paletteGroups(surface) from registry and local intents
  transport.ts                       TRANSPORT_TOOLS (§9.4); Phase 5 adds the converters

src/lib/compose/
  brief.ts                           composeBrief(input) → Brief (same Brief type and sentence ids as v0; O(n))
  brief-export.ts                    plainText, lineText, briefPlainText, briefHtml (ported)

src/lib/migrate/
  index.ts                           CURRENT_SCHEMA = 2, MIGRATIONS chain, upgradeProjectDoc/upgradeWorkspaceDoc, detectV0
  v0/schema.ts                       lenient salvage schema (v0 shapes, legacy shapes, over-limit values)
  v0/read.ts                         readV0(storage): raw main key, then .backup; never writes
  v0/idmap.ts                        IdMap build/apply, brief key rewrite, asset aliases
  v0/to-v2.ts                        migrateV0(raw, options) → { people, project, idMap, report, local }

src/lib/interpret/
  fast/index.ts                      fastParse(text, ctx) → FastResult (v0 precedence; registry ops + local intents)
  fast/match.ts                      normalise, findNamedTask/findNamedStep, personIn, parseAmount, parseDays, coloursIn, replacesProject
  fast/{control,view,brief,create,mood,team,task,layout}.ts   one file per v0 family, same regexes
  fast/confidence.ts                 Q17 tiers
  DELETED: demo.ts, library.ts, index.ts, claude.server.ts

src/lib/store/
  engine.ts                          DocsState, runCommand wrapper, HistoryEntry, undo/redo by patches, gestures (framework-free)
  form.ts                            the Zustand store (only hooks.ts and actions.ts import it; lint-enforced)
  hooks.ts                           thin selector hooks: the only data API for components
  actions.ts                         id-minting action creators (addTaskAtEnd, addImages, addPerson, addSampleTeam, createDemoProject…)
  fx.ts                              fxFor(outcome) port (create, shift, reflow, edit, restore)
  persist.ts                         debounced save (250 ms) on document/local/notice change only, skipped during gestures
  view-url.ts                        ?view= read on mount, history.replaceState on change
  today.ts                           today in the workspace time zone, ticks at local midnight

src/lib/demo/                        demo-only (§0.7); imported only by the store and actions
  sample.ts                          SAMPLE_PEOPLE (fixed ids, 2/4/5 days a week), SAMPLE_START, SAMPLE_OWNER_BY_TITLE, isSamplePerson
  seed.ts                            demoWorkspace(now, tz), demoDraft(title, startAs), DEMO_TASKS (TaskSeed specs)
  library.ts                         breakdown library (Q20), largest-remainder half-day allocation
  storage.ts                         form.demo.v2 envelope read/write, .backup on unreadable data, first-load v0 migration
src/lib/assets.ts                    ingestImage(file, assetId) and useAssetUrl(assetId) with a legacy alias fallback
src/lib/{motion,useViewport,useWidth}.ts   unchanged
DELETED: src/lib/{schema,ops,seed,selectors,focus,team,views,brief,mood,store}.ts

src/components/**                    same tree; data only through lib/store/hooks; agent/loop.ts NEW (useSettlingLoop)

test/
  legacy/v0/**                       frozen copies of the v0 lib and suggestions.ts at b201af8 (test-only)
  legacy/lower.ts                    test-only v0 → v2 op lowering (the 35-op mapping, exhaustive)
  fixtures/v0/*.json                 audit fixtures (docDemo, doc60, doc150) + one per migration case
  fixtures/v2/build.ts               emptyWorkspace, demoState, generated(n, {stepsPerTask, predsMean, people}), multiProject
  property/{arbitraries,materialise,reducer,planning,store,migrate,coverage}.property.test.ts + gen/<op>.ts (66 files) + gen/index.ts
  golden/{corpus.ts,parser,palette,projection-free brief,captions}.golden.test.ts, expected-diffs.ts
  perf/{planning,reducer,compose,parser,migrate}.perf.test.ts
e2e/
  playwright.config.ts, states.ts, settle.ts, frames.ts, route.spec.ts, visual.spec.ts, motion.spec.ts,
  flow.spec.ts (videos), agent-idle.spec.ts, a11y.spec.ts, expected-diffs.md
scripts/audit/**                     audit harnesses moved from docs/audit/harness (relative paths)
scripts/e2e/compare.mjs              builds two commits in worktrees, serves them (3500, 3501), runs the specs
vitest.config.ts                     projects: unit, property, golden, perf
.github/workflows/ci.yml
```

**Import boundaries** (ESLint `no-restricted-imports`):
- `domain` imports nothing from the rest of `lib`.
- `planning` imports only `domain`.
- `ops` imports `domain` and `planning`.
- `compose` imports `domain` and `planning`.
- `migrate` imports `domain` and `ops/build`.
- `interpret/fast` imports `domain`, `ops/build` and `planning`.
- `store` imports everything above, plus `demo`.
- `components` may import `lib/store/hooks`, `lib/store/actions` (types only), `domain` labels and types, `planning/format`, `lib/motion`, `lib/assets` and the viewport hooks.
- `components` may never import `lib/store/form`, `lib/ops/{reduce,command}`, `migrate` or `demo/storage`.

---

## 3. Schema v2

Verified against the installed zod 4.6.5 in a scratch run:
- `.pick()` throws on objects that carry object-level refinements. Field-level refinements are fine.
- `multipleOf(0.5)` rejects 2.7 and accepts 2.5.
- `z.iso.date()` rejects 2026-02-30.
- `z.iso.datetime()` rejects offsets other than "Z".
- Branded ids work as `z.record` keys, and bad keys are rejected.
- Nested discriminated unions (`op`, then `field`) parse.
- `z.url({ protocol: /^https?$/ })` rejects `javascript:`.

**Rules:**
- Document schemas are `.strict()`.
- They use no `.default()`, `.catch()`, `.transform()` or object-level `.refine()`, so parse equals validate.
- Cross-field and size rules live in `invariants/check.ts`.
- Only the v0 salvage schema is lenient.

### 3.1 Ids (`domain/ids.ts`, `domain/schema/ids.ts`)
```ts
export const ID_PREFIX = {
  workspace: "wsp", project: "prj", task: "tsk", step: "stp", person: "per", asset: "ast", comment: "cmt",
  template: "tpl", proposal: "prp", moodItem: "mdi", briefLine: "brl", timeOff: "off", closure: "cls",
  link: "lnk", snapshot: "snp",
} as const;
export type IdKind = keyof typeof ID_PREFIX;
const BODY = "[0-9a-z]{8,32}";
const idSchema = <B extends string>(kind: IdKind) =>
  z.string().regex(new RegExp(`^${ID_PREFIX[kind]}_${BODY}$`), `Not a ${kind} id`).brand<B>();

export const WorkspaceId = idSchema<"WorkspaceId">("workspace");
export const ProjectId = idSchema<"ProjectId">("project");
export const TaskId = idSchema<"TaskId">("task");
export const StepId = idSchema<"StepId">("step");
export const PersonId = idSchema<"PersonId">("person");
export const AssetId = idSchema<"AssetId">("asset");
export const TemplateId = idSchema<"TemplateId">("template");
export const ProposalId = idSchema<"ProposalId">("proposal");
export const MoodItemId = idSchema<"MoodItemId">("moodItem");
export const BriefLineId = idSchema<"BriefLineId">("briefLine");
export const TimeOffId = idSchema<"TimeOffId">("timeOff");
export const ClosureId = idSchema<"ClosureId">("closure");
export const LinkId = idSchema<"LinkId">("link");
export const SnapshotId = idSchema<"SnapshotId">("snapshot");
export type TaskId = z.infer<typeof TaskId>; // …one exported type per schema

export interface Minter { <K extends IdKind>(kind: K): IdOf<K> }       // IdOf maps kind → branded type
export const nanoMinter: Minter;              // nanoid@5 customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 16)
export function seededMinter(seed: number): Minter;   // mulberry32; tests and fixtures only
export function deriveId<K extends IdKind>(kind: K, salt: string, key: string): IdOf<K>;
// FNV-1a 64-bit (BigInt) of `${salt}|${key}` → base36, left-padded to 16. Used by duplicateProject.
```
- Commit and group ids are `crypto.randomUUID()`, minted by the store and never inside `lib/ops`.
- The demo uses readable fixed ids:
  - `wsp_demoworkspace`;
  - `per_demomarta`, `per_demosara` and `per_demoluca`.

### 3.2 Primitives (`domain/schema/primitives.ts`)
```ts
export const IsoDate = z.iso.date().brand<"IsoDate">();          // "YYYY-MM-DD", read in the workspace time zone
export const Timestamp = z.iso.datetime().brand<"Timestamp">();   // UTC "…Z"; always ctx.now
export const Cents = z.int().min(0).max(100_000_000_000);
export const Currency = z.string().regex(/^[A-Z]{3}$/);           // ISO 4217
export const halfDays = (min: number, max: number) => z.number().min(min).max(max).multipleOf(0.5);
export const OrderKey = z.string().min(1).max(64).regex(/^[0-9A-Za-z]+$/);   // fractional-indexing base62
const trimmed = (s: string) => s === s.trim();
export const Line = (max: number) => z.string().min(1).max(max).refine((s) => trimmed(s) && !/[\r\n]/.test(s), "Use one trimmed line");
export const Text = (max: number) => z.string().min(1).max(max).refine(trimmed, "Trim the text");
export const Tag = Line(32).refine((s) => !s.includes(","), "Tags can't contain commas");
export const Url = z.url({ protocol: /^https?$/ }).max(2048);
export const Weekday = z.int().min(1).max(7);                     // 1 = Monday
export const WorkingDays = z.array(Weekday).min(1).max(7);        // sorted + unique: invariant
export const Timezone = z.string().min(1).max(64).refine(isIanaZone, "Unknown time zone");
export const Status = z.enum(["todo", "active", "review", "done"]);   // To do · In progress · In review · Done
export const Priority = z.enum(["low", "medium", "high", "urgent"]);
export const TaskKind = z.enum(["task", "milestone"]);
export const Allocation = z.union([z.literal(0.25), z.literal(0.5), z.literal(0.75), z.literal(1)]);
export const ViewKind = z.enum(["cards", "board", "timeline", "team", "focus", "brief"]);   // "cards" is labelled "Tracker"
export const BirthView = z.enum(["cards", "board", "timeline"]);
export const BlockKind = z.enum(["header", "metrics", "progress", "collection", "moodboard", "budget", "activity"]);
export const BLOCK_ORDER = BlockKind.options;                     // canonical render order
export const ProjectKind = z.enum(["website", "brand-identity", "campaign", "product", "other"]);
export const ProjectStatus = z.enum(["planning", "active", "on-hold", "done"]);
export const Audience = z.enum(["client", "team"]);
export const BriefSection = z.enum(["note", "done", "moving", "next", "risks", "questions"]);
export const SortKey = z.enum(["manual", "priority", "progress", "status", "title", "estimate", "due"]);
export const MoodKind = z.enum(["image", "color", "note"]);
export const MoodLayout = z.enum(["masonry", "grid", "collage"]);
export const LinkSchema = z.object({ id: LinkId, label: Line(60), url: Url }).strict();
export const Place = z.union([z.literal("start"), z.literal("end"), z.object({ after: TaskId }).strict()]);
```

### 3.3 Workspace document (`domain/schema/workspace.ts`)
```ts
export const TimeOffSchema = z.object({ id: TimeOffId, from: IsoDate, to: IsoDate, label: Line(60).nullable() }).strict();
export const ClosureSchema = z.object({ id: ClosureId, from: IsoDate, to: IsoDate, label: Line(60) }).strict();

export const PersonSchema = z.object({
  id: PersonId,
  name: Line(40),
  role: Line(40).nullable(),                         // free text; balance compares it (trimmed, case-insensitive)
  email: z.email().max(254).nullable(),
  userId: z.string().min(1).max(64).nullable(),      // set = "this is me" (Phase 2)
  capacityDaysPerWeek: halfDays(0, 7).nullable(),    // Q3: null = unknown, no over/under verdict
  dayRateCents: Cents.nullable(),                    // derived costs only; never shown to the client
  timeOff: z.record(TimeOffId, TimeOffSchema),
  order: OrderKey,                                   // Team row order (records have no order)
  archived: z.boolean(),
  createdAt: Timestamp,
}).strict();

export const TemplateTaskSchema = z.object({
  title: Line(140), kind: TaskKind, estimateDays: halfDays(0, 250).nullable(),
  dependsOn: z.array(z.int().min(0)).max(50),        // indices lower than the task's own index: invariant
  steps: z.array(Line(140)).max(40), roleHint: Line(40).nullable(),
}).strict();
export const TemplateSchema = z.object({
  id: TemplateId, name: Line(60), kind: ProjectKind,
  tasks: z.array(TemplateTaskSchema).min(1).max(150), createdAt: Timestamp,
}).strict();

export const ProjectIndexEntrySchema = z.object({
  id: ProjectId, createdAt: Timestamp, archivedAt: Timestamp.nullable(), deletedAt: Timestamp.nullable(),
}).strict();

export const WorkspaceDocSchema = z.object({
  schemaVersion: z.literal(2), docType: z.literal("workspace"), id: WorkspaceId,
  name: Line(60), timezone: Timezone, defaultCurrency: Currency,
  workingDays: WorkingDays,
  closures: z.record(ClosureId, ClosureSchema),
  holidayPreset: z.string().regex(/^[A-Z]{2}$/).nullable(),
  people: z.record(PersonId, PersonSchema),
  templates: z.record(TemplateId, TemplateSchema),   // user templates only; starters are code
  projects: z.record(ProjectId, ProjectIndexEntrySchema),   // the project index (Q9)
  improveFormOptIn: z.boolean(),
  createdAt: Timestamp,
}).strict();
```

### 3.4 Project document (`domain/schema/project.ts`, `proposal.ts`)
```ts
export const StepSchema = z.object({
  id: StepId, title: Line(140), done: z.boolean(), ownerId: PersonId.nullable(),
  estimateDays: halfDays(0.5, 250).nullable(),       // Q1: used only inside the parent's window
}).strict();

export const TaskSchema = z.object({
  id: TaskId, title: Line(140), kind: TaskKind,
  description: z.string().max(5000).nullable(),
  status: Status, priority: Priority, progress: z.int().min(0).max(100),
  estimateDays: halfDays(0, 250).nullable(),         // working days at 100%; task: null or ≥ 0.5; milestone: 0
  allocation: Allocation,                            // duration = ceil(estimate / allocation) working days
  pinnedStart: IsoDate.nullable(), dueDate: IsoDate.nullable(),
  dependsOn: z.array(TaskId).max(50),                // finish-to-start; existing, unique, no self, acyclic
  ownerId: PersonId.nullable(),                      // resolved against the workspace at read time (Q7)
  costCents: Cents.nullable(),                       // manual cost only, in project.currency
  tags: z.array(Tag).max(20), links: z.array(LinkSchema).max(20), emphasis: z.boolean(),
  steps: z.array(StepSchema).max(40),                // exactly one level, array order = step order
  order: OrderKey,                                   // workflow order; unique per project
  createdAt: Timestamp, completedAt: Timestamp.nullable(),
}).strict();

export const ViewConfigSchema = z.object({          // commits, undoable, hidden from Activity (Q6)
  density: z.enum(["comfortable", "compact"]),
  layout: z.enum(["grid", "list"]),
  columns: z.int().min(1).max(4).nullable(),         // null = automatic
  sort: SortKey,
  hideDone: z.boolean(), highlightUrgent: z.boolean(),
  fields: z.object({ priority: z.boolean(), estimate: z.boolean(), progress: z.boolean(),
    owner: z.boolean(), due: z.boolean(), cost: z.boolean() }).strict(),
  filters: z.object({
    ownerIds: z.array(z.union([PersonId, z.literal("none")])).max(20),
    statuses: z.array(Status).max(4), priorities: z.array(Priority).max(4), tags: z.array(Tag).max(20),
    due: z.enum(["any", "thisWeek", "late"]),
  }).strict(),
  focusPin: TaskId.nullable(),
  brief: z.object({ audience: Audience, short: z.boolean() }).strict(),
}).strict();

export const MoodItemSchema = z.object({
  id: MoodItemId, kind: MoodKind,
  x: z.number().min(0).max(1), y: z.number().min(0).max(20),
  w: z.number().min(0.04).max(1), h: z.number().min(0.03).max(3), r: z.number().min(-15).max(15),
  z: OrderKey,                                       // stacking; "bring to front" = a new top key
  assetId: AssetId.nullable(), hex: z.string().regex(/^#[0-9a-f]{6}$/).nullable(), text: z.string().max(400).nullable(),
}).strict();

export const BriefEditKey = z.string().max(160).regex(/^(client|team):[a-z]+(:[0-9a-z_]+)*$/);   // "<audience>:<sentence id>"
export const BriefStateSchema = z.object({
  edits: z.record(BriefEditKey, z.object({ text: z.string().max(600), basis: z.string().max(4000) }).strict()),   // text "" = hidden
  lines: z.array(z.object({ id: BriefLineId, audience: Audience, section: BriefSection, text: Text(600) }).strict()).max(80),
  sent: z.array(z.object({ snapshotId: SnapshotId, audience: Audience, sentAt: Timestamp }).strict()).max(200),   // bodies are server rows (Phase 4)
  sharing: z.object({ showBudgetToClient: z.boolean() }).strict(),   // share links are server rows (Phase 4)
}).strict();

// proposal.ts: at most one pending proposal per project
const P = { id: ProposalId, createdAt: Timestamp, source: z.enum(["parser", "agent", "direct"]) };
export const ProposalSchema = z.discriminatedUnion("kind", [
  z.object({ ...P, kind: z.literal("subtasks"), taskId: TaskId,
    items: z.array(z.object({ stepId: StepId, title: Line(140), estimateDays: halfDays(0.5, 250).nullable() }).strict()).min(1).max(12) }).strict(),
  z.object({ ...P, kind: z.literal("reassign"), moves: z.array(z.discriminatedUnion("type", [
    z.object({ type: z.literal("owner"), taskId: TaskId, from: PersonId.nullable(), to: PersonId, why: z.string().max(200) }).strict(),
    z.object({ type: z.literal("shift"), taskId: TaskId, pinnedStart: IsoDate, days: z.int().min(1).max(250), why: z.string().max(200) }).strict(),
  ])).min(1).max(12) }).strict(),
  z.object({ ...P, kind: z.literal("leveling"),
    moves: z.array(z.object({ taskId: TaskId, pinnedStart: IsoDate, days: z.int().min(1).max(250), why: z.string().max(200) }).strict()).min(1).max(150) }).strict(),
  z.object({ ...P, kind: z.literal("estimates"),
    items: z.array(z.object({ taskId: TaskId, estimateDays: halfDays(0.5, 250) }).strict()).min(1).max(150) }).strict(),   // "suggested"
  z.object({ ...P, kind: z.literal("plan"), tasks: z.array(TaskSeedSchema).min(1).max(12) }).strict(),
]);

export const ProjectDocSchema = z.object({
  schemaVersion: z.literal(2), docType: z.literal("project"), id: ProjectId, workspaceId: WorkspaceId,
  title: Line(80),
  client: z.object({ name: Line(80).nullable(), contactName: Line(80).nullable(), contactEmail: z.email().max(254).nullable() }).strict().nullable(),
  kind: ProjectKind, goal: Text(200).nullable(), status: ProjectStatus,
  startDate: IsoDate.nullable(), startConfirmed: z.boolean(),        // unconfirmed → relative dates in /app (§7.2)
  deadline: IsoDate.nullable(), deadlineKind: z.enum(["hard", "soft"]),
  currency: Currency, budgetCents: Cents.nullable(),
  leadId: PersonId.nullable(), memberIds: z.array(PersonId).max(100),
  requireReview: z.boolean(), autoChain: z.boolean(),               // autoChain: a quick "Add task" depends on the last task (§6.4)
  calendarOverride: z.object({ workingDays: WorkingDays.nullable(), closures: z.record(ClosureId, ClosureSchema).nullable() }).strict().nullable(),
  links: z.array(LinkSchema).max(20), tags: z.array(Tag).max(20),
  views: z.array(ViewKind).min(1).max(6),                           // tab order = creation order
  blocks: z.array(BlockKind).min(2).max(7),                         // canonical BLOCK_ORDER; header and collection always present
  viewConfig: ViewConfigSchema,
  tasks: z.record(TaskId, TaskSchema),
  moodboard: z.object({ items: z.record(MoodItemId, MoodItemSchema) }).strict(),
  brief: BriefStateSchema,
  proposal: ProposalSchema.nullable(),
  createdAt: Timestamp,
}).strict();
```

### 3.5 Templates, seeds and drafts (`domain/schema/template.ts`)
```ts
// Everything that creates tasks in bulk (demo seed, template, accepted plan) passes fully minted, coherent seeds
export const TaskSeedSchema = z.object({
  taskId: TaskId, title: Line(140), kind: TaskKind, estimateDays: halfDays(0, 250).nullable(),
  dependsOn: z.array(TaskId).max(50),               // ids of earlier seeds in the same list or existing tasks
  status: Status, priority: Priority, progress: z.int().min(0).max(100),
  ownerId: PersonId.nullable(), emphasis: z.boolean(),
  steps: z.array(z.object({ stepId: StepId, title: Line(140), estimateDays: halfDays(0.5, 250).nullable() }).strict()).max(40),
}).strict();

export const ProjectDraftSchema = ProjectDocSchema.pick({
  title: true, client: true, kind: true, goal: true, startDate: true, startConfirmed: true, deadline: true, deadlineKind: true,
  currency: true, budgetCents: true, leadId: true, memberIds: true, requireReview: true, autoChain: true,
  calendarOverride: true, links: true, tags: true,
}).extend({ startAs: BirthView }).strict();         // pick works: ProjectDocSchema has no object-level refinement
```

### 3.6 Local view state, commit and demo envelope
```ts
// local.ts: never in a document (Q6). URL in /app (Phase 3); URL plus envelope fallback in /demo
export const LocalViewStateSchema = z.object({
  activeView: ViewKind, selectedTaskId: TaskId.nullable(), timelineZoom: z.enum(["day", "week", "month"]),
}).strict();
export function parseViewQuery(search: string, project: ProjectDoc | null): Partial<LocalViewState>;   // unknown → dropped
export function serializeViewQuery(v: LocalViewState, project: ProjectDoc): string;                     // omits defaults

// commit.ts: the §10.2 wire shape, used by the store now and by the server in Phase 2
export const CommitSchema = z.object({
  id: z.uuid(), groupId: z.uuid(), docId: z.union([WorkspaceId, ProjectId]), baseVersion: z.int().min(0),
  ops: z.array(z.unknown()).min(1).max(13),          // each op parsed by its registry schema; registry ops only (never local intents)
  source: z.enum(["direct", "agent", "system"]), command: z.string().max(500).nullable(),
  createdAt: Timestamp, actorId: z.string().max(64).nullable(),
}).strict();

// demo.ts: localStorage["form.demo.v2"]
export const DemoEnvelopeSchema = z.object({
  schemaVersion: z.literal(2),
  workspace: WorkspaceDocSchema,
  projects: z.record(ProjectId, ProjectDocSchema),  // live projects only; deleted ones are compacted on save
  activeProjectId: ProjectId.nullable(),
  lastView: ViewKind.nullable(),                     // used when the URL has no ?view=
  changes: z.int().min(0),                           // "{n} changes · saved locally"
  notices: z.object({ weekendsPending: z.boolean() }).strict(),
  assetAliases: z.record(AssetId, z.string().min(1).max(64)),   // ast_… → legacy IndexedDB key "img-…"
  migratedFrom: z.enum(["v0-main", "v0-backup"]).nullable(),
}).strict();
```

### 3.7 What lives where
| Piece | Where | Undo | Activity |
|---|---|---|---|
| Workspace name, time zone, currency, working days, closures, holiday preset, opt-in | Workspace doc | yes | yes |
| People: capacity, day rate, time off, archived flag | Workspace doc | yes | yes |
| User templates | Workspace doc | yes | yes |
| Project index: created, archived and deleted (Q9) | Workspace doc | yes | yes |
| Project fields, tasks with steps, dependencies and order keys | Project doc | yes | yes |
| Created views and blocks | Project doc | yes | yes |
| viewConfig: sort, density, layout, columns, fields, filters, focus pin, brief audience and length | Project doc | yes | **no** (Q6) |
| The pending proposal | Project doc | yes | yes |
| Brief: edits, lines, sent references, sharing flag | Project doc | yes | yes |
| Moodboard (asset ids only) | Project doc | yes | yes |
| Active view, selection, timeline zoom | URL (`/demo?view=`) plus envelope fallback | no | – |
| Undo stack, caption, phase, composer | Session | – | – |
| Change counter, pending notices, asset aliases | Demo envelope | – | – |

**Never stored** (computed in `lib/planning`):
- schedule, floats, critical set, risks, load and lanes;
- focus, metrics and derived cost;
- owner validity.

**Server rows in Phase 2 and 4:** commits with patches, assets, `brief_snapshots`, `share_links`.

### 3.8 Invariants (`invariants/check.ts`)
`checkProject(doc)` and `checkWorkspace(doc)` return `Violation[]` as `{ code, path, message }`. They are used by the commit gate, the property suite, development asserts and the migration.

**Project:**
1. Record key equals the entity id, for tasks and mood items. At most 500 tasks and 200 mood items.
2. Order keys are unique among tasks; `z` keys are unique among mood items.
3. Ids are unique: step ids across all tasks, brief line ids, and the ids inside a proposal. The step and task ids in a subtasks or plan proposal must not already exist.
4. `dependsOn`: every id exists, no duplicates, no self-reference, and the graph is acyclic (Kahn).
5. Coherence:
   - Done ⇒ progress 100;
   - To do ⇒ progress 0;
   - progress 100 ⇒ Done, or In review when `requireReview`;
   - `completedAt` set ⇒ Done.
6. A milestone has `estimateDays === 0`, no steps, allocation 1 and status To do or Done. A task has `estimateDays` null or ≥ 0.5.
7. `views` are unique. `blocks` are unique, follow `BLOCK_ORDER`, and include header and collection.
8. `focusPin` names an existing task, or is null.
9. Proposal targets exist. A subtasks proposal targets a task of kind "task".
10. Mood items:
    - image ⇒ `assetId`;
    - colour ⇒ `hex`;
    - note ⇒ `text` not null;
    - `x + w ≤ 1 + 1e-9`.
11. `memberIds`, `tags` and `dependsOn` hold no duplicates.
12. `startDate ≤ deadline` when both are set. `calendarOverride.workingDays` is sorted and unique. Closures have `from ≤ to`.
13. The JSON byte length is at most 1,000,000.

**Workspace:**
1. Record keys equal ids. At most 100 people, 50 templates, 200 closures, 100 time-off entries per person and 500 index entries.
2. Names of non-archived people are unique, case-insensitive. At most one person per `userId`.
3. Person order keys are unique. `workingDays` is sorted and unique. Every range has `from ≤ to`.
4. In a template, each task's `dependsOn` indices are lower than its own index, and a milestone template task has estimate 0.

**Across documents (Q7, read time, never in a reducer):**
- `resolveOwner(ownerId, ws)` returns the person, `"archived"` or `"missing"`;
- lead and members resolve the same way;
- `derivedCost(task, ws)`.

### 3.9 Limits (`domain/limits.ts`) and defaults
| Limit | Value |
|---|---|
| `TASK_TITLE` | 140 |
| `PROJECT_TITLE` | 80 |
| `PERSON_NAME` | 40 |
| `WORKSPACE_NAME` | 60 |
| `TASKS_MAX` | 500 |
| `STEPS_MAX` | 40 |
| `DEPS_MAX` | 50 |
| `PEOPLE_MAX` | 100 |
| `MOOD_MAX` | 200 |
| `MOOD_ADD_MAX` | 24 |
| `BRIEF_LINES_MAX` | 80 |
| `BRIEF_TEXT_MAX` | 600 |
| `OPS_PER_COMMAND` | 12 (system ops excluded) |
| `DOC_BYTES_MAX` | 1,000,000 |
| `ORDER_KEY_REBALANCE` | 48 |
| `HISTORY_LIMIT` | 60 |

**Defaults for a new project:**
- `views [startAs]`;
- `blocks [header, metrics, collection]`;
- `viewConfig = DEFAULT_VIEW_CONFIG`:
  - comfortable, grid, automatic columns, manual sort, `hideDone` false, `highlightUrgent` false;
  - fields: priority, estimate and progress true; owner, due and cost false;
  - empty filters with due "any";
  - `focusPin` null; brief for the client, full length;
- `status: "planning"`, `autoChain: true`, `requireReview: false`;
- `currency = ws.defaultCurrency`.

---

## 4. Operation registry

### 4.1 Contract (`ops/registry/_contract.ts`)
```ts
export type Scope = "workspace" | "project";
export type DocOf<S extends Scope> = S extends "workspace" ? WorkspaceDoc : ProjectDoc;
export interface ReduceCtx {
  readonly now: Timestamp;                              // commit.createdAt: the only time source
  readonly actorId: string | null;
  readonly source: "direct" | "agent" | "system";
  readonly workspace: WorkspaceDoc;                     // project ops: reference checks only (owner exists, not archived)
  readonly readProject: (id: ProjectId) => ProjectDoc | null;    // duplicateProject
  readonly ownership: (id: PersonId) => number;         // tasks owned across projects (deletePerson, Q8)
}
export type RejectCode = "unknown_op" | "invalid_payload" | "wrong_scope" | "not_found" | "duplicate_id" | "cycle"
  | "self_dependency" | "invalid_reference" | "archived" | "limit" | "last_view" | "protected_block" | "stale_proposal"
  | "owns_tasks" | "invalid_state" | "no_project" | "invalid_result";
export interface Rejection { code: RejectCode; message: string /* English, ≤ 140, caption-ready */; meta?: Record<string, string> }
export interface CaptionPart { text: string /* ≤ 140 */; key?: string /* later part with the same key replaces it */; tone?: "done" | "proposal" }
export interface CaptionEnv {                             // always describes the AFTER state; lazy and memoised
  viewLabel(v: ViewKind): string; taskTitle(id: TaskId): string; personName(id: PersonId): string;
  plan(): ProjectPlan | null; lanes(): LaneLoad[]; focus(): FocusResult | null;
  overloads(): { personId: PersonId; name: string; over: number }[];
  openTasksOwnedBy(id: PersonId): number;               // across projects
}
export interface CaptionInput<S extends Scope, P> { op: P; before: DocOf<S>; after: DocOf<S>; env: CaptionEnv }
export type FixtureName = "empty" | "demo" | "demoSelected" | "demoProposal" | "demoPlan" | "demoMood3" | "demoMoodShown"
  | "demoNoTeam" | "demoUnestimated" | "generated60";
export interface ParserExample { say: string; fixture: FixtureName; selected?: string /* task title */ }
export interface PaletteEntry {
  group: "Create" | "Decide" | "Add a view" | "Layout" | "Brief" | "Team" | "Moodboard" | "Selected task";
  phrase: string; rank: number; needs: "none" | "project" | "selection"; fixture: FixtureName; surfaces: readonly ("demo" | "app")[];
}
export type TransportSpec = { tool: TransportTool; field?: string; action?: string };   // §9.4 names; converters in Phase 5
export interface Exempt { exempt: string /* reason ≥ 10 chars */; until?: number /* the phase that must remove it */ }
export interface OpDef<N extends string, S extends Scope, P extends { op: N }> {
  name: N; scope: S; schema: z.ZodType<P>;               // strict object(s); field ops are a discriminated union on "field"
  reduce(draft: Draft<DocOf<S>>, op: P, ctx: ReduceCtx): Rejection | void;   // Immer recipe; pure
  spawn?(op: P, ctx: ReduceCtx): ProjectDoc;            // createProject and duplicateProject only (Q9)
  caption(i: CaptionInput<S, P>): CaptionPart | CaptionPart[] | null;
  noopCaption(i: Omit<CaptionInput<S, P>, "after">): string | null;     // "Research is already done"
  undoable: boolean; activity: "show" | "hide"; idempotent: boolean;
  deprecates: readonly V0OpName[];                       // v0 op names folded into this op
  parser: { family: ParserFamily; examples: readonly ParserExample[] } | Exempt;
  palette: readonly PaletteEntry[] | Exempt;
  transport: TransportSpec | Exempt;
  sample(fx: FixtureDocs, mint: Minter): P;             // a payload that applies on its fixture (completeness test)
}
export const defineOp = <const N extends string, S extends Scope, P extends { op: N }>(d: OpDef<N, S, P>) => d;
```

**Rules for every op file:**
- It default-exports one `defineOp` whose `name` equals the file name and whose `scope` equals the folder.
- `reduce` is total over schema-valid payloads. It returns a `Rejection` and never throws.
  - Any other exception is a bug. It propagates, and the property suite fails on it.
- `reduce` never mints ids, never reads a clock, never imports another op, and writes only through the helpers (`setIfChanged`, `applyStatus`…), so a same-value write produces no patch.
- `caption` is pure English, composed from `before` and `after`, and never from the command text.

### 4.2 Example (`ops/registry/project/updateTask.ts`, abridged)
```ts
const field = <F extends string, V extends z.ZodType>(f: F, v: V) =>
  z.object({ op: z.literal("updateTask"), taskId: TaskId, field: z.literal(f), value: v }).strict();
export default defineOp({
  name: "updateTask", scope: "project", undoable: true, activity: "show", idempotent: true,
  deprecates: ["updateTask"],
  schema: z.discriminatedUnion("field", [
    field("title", Line(140)), field("description", z.string().max(5000).nullable()), field("status", Status),
    field("priority", Priority), field("progress", z.int().min(0).max(100)), field("estimateDays", halfDays(0, 250).nullable()),
    field("allocation", Allocation), field("dueDate", IsoDate.nullable()), field("costCents", Cents.nullable()),
    field("emphasis", z.boolean()), field("tags", z.array(Tag).max(20)), field("kind", TaskKind),
  ]),
  reduce(d, op, ctx) {
    const t = d.tasks[op.taskId];
    if (!t) return reject("not_found", "That task isn't in this project anymore.");
    switch (op.field) {
      case "status": return applyStatus(t, op.value, d, ctx.now);
      case "progress": return applyProgress(t, op.value, d, ctx.now);
      case "estimateDays":
        if (t.kind === "milestone" && op.value !== 0) return reject("invalid_state", `${t.title} is a milestone: it takes no time.`);
        if (t.kind === "task" && op.value === 0) return reject("invalid_payload", "An estimate is at least half a day.");
        return void setIfChanged(t, "estimateDays", op.value);
      case "kind": return applyKind(t, op.value);        // milestone: rejects steps; sets estimate 0, allocation 1
      default: return void setIfChanged(t, op.field, op.value);
    }
  },
  caption: ({ op, before, after }) => taskEditCaption(op, before.tasks[op.taskId], after.tasks[op.taskId]),
  noopCaption: ({ op, before }) => alreadyCaption(op, before.tasks[op.taskId]),
  parser: { family: "task", examples: [
    { say: "Mark UI Design in review", fixture: "demo" }, { say: "Set it to 40%", fixture: "demoSelected", selected: "UI Design" },
    { say: "It takes 2 weeks", fixture: "demoSelected", selected: "UI Design" }, { say: "Rename it to Discovery", fixture: "demoSelected", selected: "Research" },
  ] },
  palette: [
    { group: "Selected task", phrase: "Make this more prominent", rank: 20, needs: "selection", fixture: "demoSelected", surfaces: ["demo", "app"] },
    { group: "Selected task", phrase: "Mark it done", rank: 30, needs: "selection", fixture: "demoSelected", surfaces: ["demo", "app"] },
    { group: "Selected task", phrase: "Set the cost to €2,400", rank: 40, needs: "selection", fixture: "demoSelected", surfaces: ["demo", "app"] },
  ],
  transport: { tool: "task_edit" },
  sample: (fx) => ({ op: "updateTask", taskId: fx.task("UI Design"), field: "status", value: "done" }),
});
```

### 4.3 Completeness test (`src/lib/ops/registry/__tests__/completeness.test.ts`)
The test fails when any of these is false:
1. Every file in `registry/{workspace,project}/` default-exports a definition whose `name` equals the file name and whose `scope` equals the folder. `REGISTRY` has no entry without a file, and no file is missing from `REGISTRY`.
2. The `REGISTRY` keys equal the TS union `Op["op"]`, checked with a `satisfies Record<OpName, true>` table plus runtime set equality.
3. For each op:
   - the schema is strict: a valid sample plus an extra key fails, and `{op: name}` alone fails;
   - `sample(fx)` parses and applies on its fixture with outcome "applied";
   - `composeCaption` returns 1–280 characters;
   - `noopCaption`, `undoable`, `activity` and `idempotent` are set.
4. `parser`, `palette` and `transport` are each filled, or exempt with a reason of 10 characters or more. No exemption has `until ≤ FORM_PHASE`.
5. Every `transport.tool` is in `TRANSPORT_TOOLS` (§9.4). Every §9.4 tool is claimed by at least one op or local intent, or appears on a reasoned allowlist (`clarify`, `decline`).
6. Palette phrases are unique across the registry and the local intents, are 80 characters or fewer, belong to a known group, and are each exercised by the palette test (§10.5).
7. Spawn is defined for exactly `createProject` and `duplicateProject`.
8. The union of every `deprecates` list, plus `test/legacy/lower.ts`, covers exactly the 35 v0 op names.
9. Every op has `test/property/gen/<op>.ts` and a unit test that names it. Every `RejectCode` is produced by at least one unit test.

### 4.4 The op list (66)
Payload ids are minted by the producer. "←" names the v0 op it replaces. The palette and parser column shows a palette phrase in **bold** and a parser example in *italics*; "–" marks an exemption, with its reason and `until`. Activity is "hide" only for `setView`, `setFocus` and `rebalanceOrder`. Every op is undoable.

**Workspace scope (20)**

| # | Op | Payload | ← v0 | Caption (applied · no-op) | Palette / parser | Transport |
|---|---|---|---|---|---|---|
| 1 | updateWorkspace | field: name\|timezone\|defaultCurrency\|holidayPreset\|improveFormOptIn, value | new (Q12) | "Workspace renamed to {name}" · "Already {value}" | – Settings (until 5 for parser) | – Settings only |
| 2 | setWorkspaceCalendar | workingDays | new | "Working days · Mon–Fri" | – (until 5) | – Settings only |
| 3 | addClosure | closure {closureId, from, to, label} | new | "Studio closed 24 Dec–6 Jan" | – (until 5) | – Settings only |
| 4 | removeClosure | closureId | new | "Closure removed" | – (until 5) | – Settings only |
| 5 | addPerson | personId, name, role, email, capacityDaysPerWeek\|null, dayRateCents\|null | addPerson | "Giulia added to the team · capacity not set" · "Giulia is already in the team" | **Add Giulia and Paolo to the team** | person_edit |
| 6 | updatePerson | personId, field: name\|role\|email\|capacityDaysPerWeek\|dayRateCents, value | updatePerson | "Marta · 4 days a week" | **Set Marta's capacity to 4 days a week** | person_edit |
| 7 | archivePerson | personId | removePerson | "Luca removed · 1 task unassigned" | *Remove Luca from the team* | person_edit (remove) |
| 8 | restorePerson | personId | new | "Luca is back in the team" | (sample-team expansion) | – Settings "Restore" |
| 9 | deletePerson | personId (rejected `owns_tasks` unless ownership = 0) | new (Q8) | "Luca deleted" | – Settings only | – Settings only |
| 10 | linkPersonToMe | personId, userId (unlinks others) | new | "This is you: Marta" | – (until 5) | – needs an account (until 5) |
| 11 | addTimeOff | personId, timeOff {timeOffId, from, to, label} | new | "Marta is off 2–6 Nov" | – (until 5) | person_edit (timeOff) |
| 12 | removeTimeOff | personId, timeOffId | new | "Time off removed" | – (until 5) | person_edit (timeOff) |
| 13 | saveTemplate | template | new | "Saved as template · {name}" | – index action (Phase 3 UI) | – |
| 14 | updateTemplate | templateId, field: name\|kind, value | new (Q12) | "Template renamed to {name}" | – Settings | – |
| 15 | deleteTemplate | templateId | new | "Template deleted" | – Settings | – |
| 16 | createProject | projectId, draft: ProjectDraft, tasks: TaskSeed[] ≤ 150 (+ spawn) | createProject | "{View} created · 4 tasks" | **Create a timeline for my project** (+2) | project_draft |
| 17 | duplicateProject | sourceId, projectId, title (+ spawn, deriveId) | new | "Duplicated as {title}" | – index action (until 5) | – (until 5) |
| 18 | archiveProject | projectId | new | "{title} archived" | – (until 5) | – (until 5) |
| 19 | restoreProject | projectId | new | "{title} restored" | – (until 5) | – (until 5) |
| 20 | deleteProject | projectId (soft: index `deletedAt`) | v0 reset | "{title} deleted" (demo reset: "Workspace reset") | *reset* (demo control) | – |

**Project scope (46)**

| # | Op | Payload | ← v0 | Caption (applied · no-op) | Palette / parser | Transport |
|---|---|---|---|---|---|---|
| 21 | updateProject | field: title\|client\|kind\|goal\|status\|startDate\|startConfirmed\|deadline\|deadlineKind\|currency\|budgetCents\|leadId\|requireReview\|autoChain\|calendarOverride\|tags, value | renameTool, setStartDate | "Renamed to {title}" · "Start · 21 Sep" · "Review step off · 2 tasks → Done" | – direct edits (until 5) | project_edit |
| 22 | addMember | personId | new | "Giulia joins the project" | (team expansions) | assign (implicit) |
| 23 | removeMember | personId | new | "Giulia leaves the project" | – (until 5) | – (until 5) |
| 24 | addLink | target {kind:"project"}\|{kind:"task", taskId}, link | new | "Link added · Figma" | – (until 5) | project_edit / task_edit (link) |
| 25 | removeLink | target, linkId | new | "Link removed" | – (until 5) | same |
| 26 | addTask | taskId, title, kind, place, dependsOn, estimateDays\|null, priority, ownerId\|null | addTask (parentId null) | "Copywriting added" | *Add a task called Copywriting* | task_add |
| 27 | updateTask | taskId, field: title\|description\|status\|priority\|progress\|estimateDays\|allocation\|dueDate\|costCents\|emphasis\|tags\|kind, value | updateTask | "UI Design → Done" · "Research is already done" | **Mark it done**, **Make this more prominent**, **Set the cost to €2,400** | task_edit |
| 28 | removeTask | taskId (bridges dependencies) | removeTask | "UI Design removed · Development now follows Visual Direction" | *Delete UI Design* | task_remove |
| 29 | moveTask | taskId, place, status? | moveTask (toIndex) | "UI Design moved after Research" | – direct manipulation (Phase 3) | – direct manipulation only |
| 30 | addDependency | taskId, dependsOnId | new | "Development now waits on UI Design" · rejected: "That would create a loop: A → B → A." | – (until 5) | task_dependency (add) |
| 31 | removeDependency | taskId, dependsOnId | new | "Development no longer waits on QA" | – (until 5) | task_dependency (remove) |
| 32 | pinStart | taskId, date | new | "UI Design starts 12 Oct" | – (until 5) | task_edit (pinnedStart) |
| 33 | unpinStart | taskId | new | "UI Design follows its dependencies again" | – (until 5) | task_edit |
| 34 | assignTask | taskId, personId (also adds to memberIds) | assignTask | "Development → Sara" · "Development is already with Sara" | **Assign Development to Sara** | assign |
| 35 | unassignTask | taskId | assignTask(null) | "Visual Direction unassigned" | *Unassign Visual Direction* | assign ("") |
| 36 | addStep | taskId, stepId, title, estimateDays\|null, after: StepId\|null\|"end" | addTask (parentId) | "Step added to UI Design" | *Add a step called QA pass* | step_edit (add) |
| 37 | updateStep | taskId, stepId, field: title\|done\|ownerId\|estimateDays, value | updateTask on a step | "QA pass done" | *Mark QA pass done* | step_edit |
| 38 | removeStep | taskId, stepId | removeTask on a step | "QA pass removed" | *Delete the QA pass step* | step_edit (remove) |
| 39 | reorderStep | taskId, stepId, after: StepId\|null | new | "QA pass moved" | – direct manipulation | – |
| 40 | proposeSubtasks | proposalId, taskId, items {stepId, title, estimateDays\|null}[] 1–12 | proposeSubtasks | "4 steps proposed for UI Design · fits its 6d estimate. Review them on the task." | **Break this task into smaller steps** | propose (subtasks) |
| 41 | proposeReassign | proposalId, moves[] | proposeReassign | "Marta is 4d over capacity · 1 handover proposed. Review it on the team." | **Balance the workload** | propose (reassign) |
| 42 | proposeLeveling | proposalId, moves[] | new | "Leveling proposed · 3 starts move" | – (until 5) | propose (leveling) |
| 43 | proposeEstimates | proposalId, items[] | new | "Suggested estimates for 6 tasks" | – (until 5) | propose (estimates) |
| 44 | proposePlan | proposalId, tasks: TaskSeed[] 1–12 | new | "Proposal · 8 tasks, no estimates yet" | – (until 5) | propose (plan) |
| 45 | acceptProposal | proposalId, only?: string[] | acceptProposal, acceptReassign | "4 steps added to UI Design" · "1 task reassigned" · rejected `stale_proposal` | *Accept them*, *Accept the plan* | proposal (accept) |
| 46 | discardProposal | proposalId | discardProposal, discardReassign | "Proposal discarded" · "Plan discarded · nothing moved" | *Discard* | proposal (discard) |
| 47 | addView | view (appended; ≤ 6) | setRepresentation (creating half) | "{View} view added" (merged with the show caption) | **Add a timeline**, **Add a board**, **Add the tracker**, **Add the team view**, **Add focus**, **Add a brief** | view (add) |
| 48 | removeView | view (rejected `last_view`) | removeView | "Board view removed · nothing in the project is deleted" | *Remove the board* | view (remove) |
| 49 | setView | patch: density, layout, columns, sort, hideDone, highlightUrgent, fields (partial), filters (partial), briefAudience, briefShort | setView, setFields | "Compact · Sorted by priority" | **Show it as a list**, **Make the cards more compact**, **Show the tasks in two columns**, **Sort them by priority**, **Hide completed tasks**, **Highlight the urgent ones**, **Now make it for the team**, **Make the brief shorter** | view_option |
| 50 | setFocus | taskId\|null | setView.focusId | "Focus · Development" | **Focus on Development**, **What should I work on now?** | focus (pin / suggest) |
| 51 | addBlock | block (canonical order) | addBlock | "Project progress indicator added" · "Moodboard added · drop, paste or browse images" | **Add a progress indicator**, **Add a moodboard for the project** | block (visible) |
| 52 | removeBlock | block (rejected `protected_block` for header and collection) | removeBlock | "Moodboard hidden · its 12 references are kept" · "The moodboard is already hidden" | **Hide the moodboard** | block (hidden) |
| 53 | editBriefLine | key, text, basis | editBriefLine | "Brief line edited" | – direct edit in the brief | brief (editLine) |
| 54 | resetBriefLine | keys[1–80] | resetBriefLine | "FORM's wording restored" | – direct | brief (reset line) |
| 55 | addBriefLine | lineId, audience, section, text | addBriefLine | "Added to the client brief · Next" | **Add to the brief: homepage preview on Friday** | brief (addLine) |
| 56 | updateBriefLine | lineId, text (an empty edit becomes removeBriefLine at the producer) | updateBriefLine | "Brief line updated" | – direct | brief (editLine) |
| 57 | removeBriefLine | lineId | removeBriefLine | "Brief line removed" | – direct | brief (hideLine) |
| 58 | resetBrief | audience | resetBrief | "Your edits to the client brief are cleared · FORM's version" · "The client brief is already FORM's version" | **Reset the brief** | brief (reset) |
| 59 | markBriefSent | audience, snapshotId | new | "Client brief marked as sent" | – Phase 4 UI (until 4) | brief (markSent) |
| 60 | setBriefSharing | field: showBudgetToClient, value | new | "Budget shown to the client" | – Phase 4 UI (until 4) | – (until 5) |
| 61 | addMoodItems | items {itemId, kind, x?, y?, w?, h?, assetId?, hex?, text?}[] 1–24 | addMoodItems | "3 colours added to the moodboard" · "8 of 24 added · the moodboard holds 200 references" | **Add the colours #0C0C0C, off-white and terracotta**, **Add a note: warm, tactile, editorial** | moodboard (add) |
| 62 | updateMoodItem | itemId, patch {x, y, w, h, r, hex, text}, toFront | updateMoodItem | – (direct, no caption) | – direct manipulation | – direct only |
| 63 | removeMoodItem | itemId | removeMoodItem | "Reference removed" | – direct | moodboard (remove) |
| 64 | arrangeMood | layout, itemIds | arrangeMood | "Moodboard arranged as a collage" | **Tidy up the moodboard**, **Arrange the moodboard in a grid**, **Arrange the moodboard as a collage** | moodboard (arrange / tidy) |
| 65 | clearMood | itemIds | clearMood | "Moodboard cleared · 12 references removed" · "The moodboard is already empty" | *Clear the moodboard* | moodboard (clear) |
| 66 | rebalanceOrder | keys: Record<TaskId, OrderKey> | new (system) | none (folded into its commit) | – system | – system |

**Local intents** (`ops/local-intents.ts`): never ops, never in a commit or the undo stack (Q6).

| Intent | Caption (from the after-state) | Palette |
|---|---|---|
| `show(view)` | Tracker/Board: "Tracker" · "Board". Timeline: "Timeline · sample dates, sequenced from estimates · 2 tasks need a duration". Team: "Team · Marta over capacity" / "Team · everyone within capacity" / "Team · no one yet. Use the sample team, or say 'add Giulia to the team'". Focus: "Focus · UI Design — urgent priority" / "Focus · everything is done". Brief: "Status brief · for the client · composed from the project, nothing invented" | **Write a status update for the client**, **What do I tell the client?**, **Show the team workload**, **Who's overloaded?** |
| `select(taskId \| null)` | none | – |
| `zoom(day \| week \| month)` | "Timeline · weeks" (Phase 4) | – |

The palette totals 42 entries: 3 + 2 + 7 + 6 + 6 + 7 + 7 + 4, in the v0 `CAPABILITIES` order (ranks reproduce it). Only one phrase changes: "Set Marta's capacity to 10 days" becomes "Set Marta's capacity to 4 days a week".

### 4.5 Deprecations: v0 → v2 mapping
v0 never persisted ops, only documents and log labels, so no v0 op stays runnable. The mapping below exists in three places:
- as `deprecates` on each registry op;
- as the test-only `test/legacy/lower.ts`, an exhaustive switch over the 35 names that the golden parser test uses;
- in this table.

| v0 op | v2 |
|---|---|
| createProject{title, representation} | demo `createDemoProject`: deleteProject(current) if replacing, addPerson/restorePerson for sample people, createProject{draft website, start 2026-09-28 unconfirmed, 4 seeds}, local show(startAs) |
| renameTool | updateProject{title} |
| setRepresentation{r} | addView{r} if missing, then local show(r) |
| removeView | removeView (the local active view moves to the left neighbour) |
| setView{patch} | setView{patch minus focusId}; focusId → setFocus |
| setFields | setView{fields} |
| updateTask on a task | one updateTask per field in this order: title, priority, estimateDays, costCents, emphasis, progress, status (status last, so "status wins") |
| updateTask on a step | updateStep{title \| done (status === "done") \| estimateDays}; other fields are dropped |
| addTask{parentId null} | addTask{place "end", dependsOn [last] when autoChain} |
| addTask{parentId} | addStep |
| removeTask | removeTask, or removeStep on a step |
| moveTask{toIndex} | moveTask{place {after: neighbour} \| "start"} |
| proposeSubtasks | proposeSubtasks{proposalId, step ids minted} |
| acceptProposal / discardProposal | the same ops, naming the pending subtasks proposal |
| addBlock / removeBlock | the same ops |
| setStartDate | updateProject{startDate}, then updateProject{startConfirmed: true} |
| addMoodItems | addMoodItems{item ids minted; asset → assetId} |
| updateMoodItem{raise} | updateMoodItem{toFront: true} |
| removeMoodItem | removeMoodItem |
| arrangeMood / clearMood | the same ops, naming all current items |
| addPerson{name, role, capacity} | addPerson: the Team button gives 5; a command gives the stated days if ≤ 7, else null with a clarify suggestion |
| updatePerson | updatePerson(field) per key; capacity > 7 is rejected: "Capacity is days per week (0–7)." |
| removePerson | archivePerson |
| assignTask{personId \| null} | assignTask / unassignTask |
| addSampleTeam | demo `addSampleTeam`: addPerson/restorePerson + addMember for the 3 sample people, then assignTask on unowned template-titled tasks (SAMPLE_OWNER_BY_TITLE) |
| proposeReassign{moves} | proposeReassign{proposalId; moves typed "owner" with `from` filled in} |
| acceptReassign / discardReassign | acceptProposal / discardProposal on the reassign proposal |
| editBriefLine, resetBriefLine(key), updateBriefLine, removeBriefLine, resetBrief | the same ops (resetBriefLine takes `keys`) |
| addBriefLine | addBriefLine{lineId minted} |

---

## 5. Deterministic reducer

### 5.1 Setup and API (`ops/reduce.ts`)
```ts
enablePatches();          // once, at module load
setAutoFreeze(true);      // in every environment: committed documents are deeply frozen

export type OpResult<D> =
  | { kind: "applied"; doc: D; op: Op; patches: Patch[]; inverse: Patch[]; spawned?: ProjectDoc }
  | { kind: "noop"; doc: D /* === input */; op: Op }
  | { kind: "rejected"; doc: D /* === input */; op: unknown; rejection: Rejection };
export interface CommitResult<D> {
  doc: D; changed: boolean; results: OpResult<D>[]; patches: Patch[]; inverse: Patch[]; spawned: ProjectDoc[];
}
export function applyOp<D extends WorkspaceDoc | ProjectDoc>(doc: D, raw: unknown, ctx: ReduceCtx, opts?: { validate?: "full" | "touched" }): OpResult<D>;
export function applyCommit<D extends WorkspaceDoc | ProjectDoc>(doc: D, ops: readonly unknown[], ctx: ReduceCtx, opts?: { validate?: "full" | "touched" }): CommitResult<D>;
```

### 5.2 `applyOp`
```ts
class RejectSignal { constructor(readonly rejection: Rejection) {} }
export function applyOp(doc, raw, ctx, opts = {}) {
  const def = REGISTRY.get((raw as { op?: unknown })?.op as OpName);
  if (!def) return rejected(doc, raw, "unknown_op", "FORM doesn't know that change.");
  const parsed = def.schema.safeParse(raw);                                    // every source: UI, parser, migration, replay
  if (!parsed.success) return rejected(doc, raw, "invalid_payload", oneLine(parsed.error));
  if (def.scope !== doc.docType) return rejected(doc, raw, "wrong_scope", "That change belongs to another document.");
  let next, patches, inverse;
  try {
    [next, patches, inverse] = produceWithPatches(doc, (draft) => {
      const r = def.reduce(draft, parsed.data, ctx);
      if (r) throw new RejectSignal(r);                                          // Immer discards the draft: nothing half-applied leaks
    });
  } catch (e) {
    if (e instanceof RejectSignal) return { kind: "rejected", doc, op: parsed.data, rejection: e.rejection };
    throw e;                                                                     // a bug: tests fail on it
  }
  if (patches.length === 0) return { kind: "noop", doc, op: parsed.data };      // same reference
  const spawned = def.spawn?.(parsed.data, ctx);
  const bad = (opts.validate === "touched" ? validateTouched(next, patches) : validateDoc(next))
    ?? (spawned ? validateDoc(spawned) : null);
  if (bad) return rejected(doc, parsed.data, "invalid_result", "That change would break the workspace, so FORM didn't apply it.", bad);
  return { kind: "applied", doc: next, op: parsed.data, patches, inverse, spawned };
}
```
- **`validateDoc`** runs `WorkspaceDocSchema` or `ProjectDocSchema.safeParse`, then `check*`, then the JSON size check (about 0.5 ms at 150 tasks).
  - The property suite proves it never fails for registry ops. It is the last line of defence, and in Phase 2 it reports to Sentry.
- **`validateTouched`** (live gesture frames only) parses the tasks named in the patch paths with `TaskSchema` and checks their coherence. The sealed gesture then commits with full validation.

### 5.3 `applyCommit`
- Ops apply sequentially, best-effort. Each one sees the previous result. A rejected op is reported, and later ops still run.
  - An op that depends on a rejected one fails naturally (`not_found`).
- More than 12 non-system ops: every op is rejected with `limit` ("A command can change at most 12 things.").
- `patches` are concatenated in order. `inverse` is the per-op inverse lists in reverse order.
- `changed` is true if any op applied. A commit with no applied op is a no-op: no history, no log entry, no persistence write.

### 5.4 Helpers (`ops/registry/_helpers.ts`)
```ts
export function setIfChanged<T extends object, K extends keyof T>(obj: Draft<T>, key: K, value: T[K]): boolean;
// deep-equal guard (arrays and plain objects); a same-value write is never assigned, so Immer emits no patch

export function ensureFreshId(draft: Draft<ProjectDoc | WorkspaceDoc>, id: string): Rejection | void;
// idIndex(original(draft)) is a WeakMap<Doc, Set<string>> of every id in the base doc (tasks, steps, items, lines, proposal ids, people…);
// payloads that carry several ids must be unique among themselves (schema refine); a collision → duplicate_id, never re-minted

export function keyForPlace(draft: Draft<ProjectDoc>, place: Place): OrderKey | Rejection;
// sorted (order, id) list of the base doc (WeakMap cache); "end" → keyAfter(last); "start" → keyBefore(first);
// {after: X} → keyBetween(X.order, next.order). addTask with a missing anchor falls back to "end"; moveTask rejects not_found
```
- **Determinism.** Neither the reducer nor the planning code reads `Date`, `Math.random`, `performance.now` or the locale.
  - Record iteration always goes through `sortedByOrder` (order key, then id) or sorted ids. This is required because `jsonb` reorders keys, and the property suite re-applies ops with shuffled key order.
  - Formatters are fixed: `en-US` currency and fixed English month names.
- **`rebalanceOrder`.** After the project ops of a command, the runner appends `rebalanceOrder{keys: nKeys(n) in workflow order}` to the same commit if any order key is longer than 48 characters. It is deterministic.

### 5.5 Status and progress: the §5.7 table (`domain/invariants/transitions.ts`)
An op changes exactly one of status and progress; the other follows.

| Change | Result |
|---|---|
| status → done | progress 100, `completedAt = ctx.now` |
| status → todo | progress 0, `completedAt = null` (fixes todo@30 and todo@100) |
| status → active | progress 95 if it was 100, else unchanged; `completedAt = null` (fixes active@100) |
| status → review | progress 95 if it was 100 and `!requireReview`, else unchanged; `completedAt = null` (fixes review@100) |
| progress → 100 | review if `requireReview` and the task was not Done; otherwise done with `completedAt = now` |
| progress < 100 on a Done task | active, `completedAt = null` |
| progress > 0 on a To-do task | active |
| progress lowered on a task In review | stays In review |
| any task becomes active while `project.status === "planning"` | `project.status = "active"` |
| `updateProject{requireReview: false}` | every review@100 → done (`completedAt = now`), named in the caption |
| milestone | status only todo or done; progress only 0 or 100 (100 ⇔ done) |

- **"Mark UI Design done at 40%"** produces `updateTask{progress 40}`, then `updateTask{status done}`, giving done@100. Both caption parts carry the key `task:{id}:state`, so the caption reads only "UI Design → Done" (fixes done@40).
- **The slider dragged through 100** is fixed by the gesture model (§5.8), not by a rule: review@90 dragged to 100 and back to 90 is a no-op.
- **`repairTask(task, requireReview=false)`** is used only by the migration, with status winning (Q2):
  - done → 100;
  - todo with progress > 0 → active, with 100 becoming 95;
  - active or review at 100 → 95;
  - `completedAt` null.

### 5.6 Other normalisation inside op recipes
- **`addTask` / `addStep` / seeds.** `dependsOn` and tag lists are deduped on write. Milestones get estimate 0, allocation 1 and no steps.
- **`removeTask` bridging.** Every dependent D gets `D.dependsOn = unique(D.dependsOn − X ∪ X.dependsOn − D)`, which can never create a cycle. The op also:
  - clears `focusPin` when it points at X;
  - drops X from reassign, leveling and estimates proposals, and turns a subtasks proposal on X or an empty proposal into null;
  - deletes the `brief.edits` keys whose sentence id names X.

  The caption names the new links ("Development now follows Visual Direction").
- **`addDependency`** rejects a self-reference (`self_dependency`) and missing tasks. It calls `wouldCycle(dependsOnId → taskId)`, O(V+E), which returns the path for "That would create a loop: Development → UI Design → Development."
- **`assignTask`** rejects a person who is missing (`invalid_reference`) or archived (`archived`) in `ctx.workspace`, sets `ownerId`, and adds the person to `memberIds`.
- **`acceptProposal`.**
  - The id must match the pending proposal (`stale_proposal`).
  - `only` filters the items.
  - Items whose target vanished are skipped, and fresh ids are checked with `ensureFreshId`.
  - The proposal becomes null. Subtask items keep their `stepId` as the new step id, so the proposal → step morph keeps its identity.
- **`removeView`** rejects the last view. The local active view is fixed by the runner (§5.7).
- **`addView` / `addBlock`.** Views are appended; blocks are re-sorted to `BLOCK_ORDER`. Both are no-ops when the item already exists.
- **`setView`** keeps the v0 coupling: a patch with columns but no layout sets layout to list for 1 column and grid otherwise.
- **`addMoodItems`.** Placement is deterministic (`placeNext`), with z keys after the top item. It fills only up to 200 items, and the caption states it: "8 of 24 added · the moodboard holds 200 references".
- **`arrangeMood`** arranges only the named items, in z order, and clamps them to the schema bounds (the v0 safety-patch behaviour).
- **`updateMoodItem{toFront}`** computes the new top z key at apply time.
- **Limits.** A reducer rejects with `limit` rather than truncating text.

### 5.7 Commands across documents (`ops/command.ts`)
```ts
export interface DocsState { readonly workspace: WorkspaceDoc; readonly projects: Readonly<Record<ProjectId, ProjectDoc>> }
export interface Command {
  ops: readonly Op[]; local: readonly LocalIntent[]; notes: readonly QueryNote[]; notices: readonly NoticeKey[];
  reply?: { tone: "clarify"; text: string }; source: "direct" | "agent" | "system"; text: string | null;
}
export interface CommandCtx {
  now: Timestamp; actorId: string | null; projectId: ProjectId | null; local: LocalViewState; today: IsoDate;
  newId: () => string;                                 // uuid; injected (crypto.randomUUID in the store, seeded in tests)
}
export interface DocCommit { docId: WorkspaceId | ProjectId; id: string; result: CommitResult<WorkspaceDoc | ProjectDoc> }
export interface CommandResult {
  state: DocsState; changed: boolean; groupId: string | null; commits: DocCommit[]; spawned: ProjectDoc[];
  local: LocalViewState; projectId: ProjectId | null; caption: Caption | null;
}
export function runCommand(state: DocsState, cmd: Command, ctx: CommandCtx): CommandResult;
```
1. **Partition** the ops, stably: workspace ops first, then project ops.
2. **Workspace commit.** `applyCommit(workspace, wsOps, { workspace, readProject, ownership })`. Spawned project docs go into `spawned` and `state.projects`.
3. **Target project:** the last spawned project, else `ctx.projectId`. Project ops with no target are rejected with `no_project` ("Create a project first.").
4. **Project commit.** `applyCommit(project, projectOps, { workspace: afterWorkspace, … })`, so "add Giulia and assign Development to her" works. Then the rebalance check (§5.4).
5. **Local effects:**
   - apply `show`, `select` and `zoom`;
   - normalise:
     - `activeView ∈ project.views`, else the left neighbour of a removed view, else `homeView`;
     - `selectedTaskId` exists, else null;
     - the active project exists and is not deleted, else the most recently created live project, else null.
6. **Caption:** `composeCaption` (§5.9).
7. **Commits.** Each changed document yields one commit (`id = newId()`), and all commits share `groupId`. Nothing changed means no group and no history entry.

### 5.8 Undo, redo and gestures (`store/engine.ts`)
```ts
export interface HistoryEntry {
  groupId: string; label: string;
  commits: { docId: WorkspaceId | ProjectId; patches: Patch[]; inverse: Patch[] }[];
  spawned: ProjectDoc[];                                // removed on undo, restored on redo
  localBefore: LocalViewState; localAfter: LocalViewState;
  after: DocsState;                                     // development assert: state === after before an inverse is applied
}
export function undo(s: DocsState, e: HistoryEntry): DocsState;   // applyPatches(doc, inverse) per commit, in reverse; drop spawned
export function redo(s: DocsState, e: HistoryEntry): DocsState;   // applyPatches(doc, patches) per commit; re-add spawned (same frozen refs)
export function beginGesture(s: DocsState): Gesture;              // keeps the base
export function liveGesture(g: Gesture, ops: Op[]): DocsState;    // coalesce by (op, entity, field), last value wins;
                                                                  // recompute applyCommit(base, coalesced, {validate:"touched"})
export function endGesture(g: Gesture, ops: Op[] | null): CommandResult;   // one full-validation commit from the base, or restore it
```
- **Undo** restores `localBefore.activeView` when the command changed it, so undoing "Add a timeline" removes the tab and returns to the previous one. **Redo** restores `localAfter`.
- **Tab switches and `select` are local:** no entry (Q6). `HISTORY_LIMIT` is 60.
- **Gestures** are sealed on pointer up, on the next action, or after 400 ms without a live frame. A drag that ends where it began leaves no entry. Persistence is skipped while a gesture is open.
- **Phase 2 revert.** `pathsTouched(patches)` returns entity-granular paths, truncated at the first array index (`["tasks", id, "steps"]`, `["brief", "lines"]`). So index shifts inside arrays never hide a conflict, and with no stored `updatedAt`, stamping never creates a false one.

### 5.9 Captions (`ops/caption.ts`)
```ts
export interface Caption { text: string; tone: "done" | "proposal" | "info" | "clarify" | "unsupported"; undoable: boolean }
export function composeCaption(i: {
  results: { def: AnyOpDef; result: OpResult<AnyDoc>; before: AnyDoc }[]; local: LocalIntent[]; addedViews: ViewKind[];
  notes: QueryNote[]; notices: NoticeKey[]; reply?: { tone: "clarify"; text: string }; env: CaptionEnv; historyEntry: boolean;
}): Caption | null;
```
1. **Parts, in order:**
   1. the applied ops' `caption()`;
   2. the local-intent captions;
   3. the rendered query notes;
   4. the fixed notices ("Schedule now skips weekends.", " · Demo mode ships one template (website) — rename anything").
2. **`announceView`** (ported from v0): for each view that is added and shown, the show part's label "Team · …" becomes "Team view added · …", and the bare addView part is dropped.
3. **Keys.** A later part with the same key replaces the earlier one in place.
4. **Nothing applied:**
   - no-ops give `noopCaption` parts, with tone info and no Undo;
   - rejections give "Couldn't apply that: {message}";
   - partial rejections are appended as " · Couldn't apply one change: {message}".
5. **Reply.** A clarify reply replaces the text and keeps the composer open. Direct edits pass `caption: false`, so they show no caption (v0 parity) unless they were rejected or resolve a proposal.
6. **Join** with " · " and cut at 280 characters at a part boundary, after every suffix (fixes AUDIT errata 11).
7. **Tone:**
   - proposal if any applied op is `propose*`;
   - done if anything applied;
   - clarify for a clarify reply;
   - info for no-ops and notes;
   - unsupported if everything was rejected.
8. **`undoable`** is true exactly when a history entry was created.

---

## 6. Planning engine (`src/lib/planning`)

The engine is pure and isomorphic.
- **Inputs:** documents and `today: IsoDate`. The caller computes today with `todayIn(ws.timezone, Date.now())`.
- **Arithmetic** uses integer `DayNum` (days since 1970-01-01, civil and time-zone free), so DST cannot cause bugs.
- **Notation:** V = tasks, E = dependencies, S = steps, P = people, W = weeks, H = horizon days.

### 6.1 Calendar (`calendar.ts`)
```ts
export interface CalendarSpec { workingDays: readonly number[]; closures: readonly { from: IsoDate; to: IsoDate }[] }
export interface WorkCalendar {
  isWorkingDay(d: IsoDate): boolean;                    // O(1)
  ordinal(d: IsoDate): number;                          // working days before d from H0; a non-working d counts as the next working day
  dateAt(i: number): IsoDate;                           // the i-th working day; O(log H)
  nextWorkingDay(d: IsoDate, inclusive: boolean): IsoDate;
  addWorkingDays(d: IsoDate, n: number): IsoDate;       // = dateAt(ordinal(d) + n)
  workingDaysBetween(a: IsoDate, b: IsoDate): number;   // inclusive; 0 if b < a; O(1)
  key: string;                                          // calendarKey: memo key
}
export function makeCalendar(spec: CalendarSpec, extraOff?: readonly { from: IsoDate; to: IsoDate }[]): WorkCalendar;
export function effectiveSpec(ws: WorkspaceDoc, p?: ProjectDoc): CalendarSpec;   // override replaces field by field
export function personCalendar(ws: WorkspaceDoc, person: Person): WorkCalendar;   // workspace spec minus time off; capacity only
export function isoWeek(d: IsoDate): { year: number; week: number; key: `${number}-W${string}`; monday: IsoDate; sunday: IsoDate };
```
- **Build:**
  - a `Uint8Array` working-day mask over the horizon [H0, H1), initially anchor − 400 to anchor + 1,100 days and doubled when a query falls outside;
  - an `Int32Array` of prefix sums, where `P[i]` = working days in [H0, H0 + i);
  - closures are merged and marked off.
- **Cost:** build O(H + closure days). `workingDaysBetween = P[b+1] − P[a]` is O(1). `dateAt` is a binary search, O(log H).
- **Memo** by `calendarKey` (the working-days and closures references, plus the extra ranges).
- **`isoWeek`** is O(1). Thursday = d − weekday + 4; the year is the Thursday's year; week = ⌊(Thursday − 1 Jan) / 7⌋ + 1. Verified: 2026-12-31 and 2027-01-01 are 2026-W53, 2027-01-04 is W01, and 2021-01-03 is 2020-W53.

### 6.2 Graph (`domain/invariants/graph.ts`)
- **`topoOrder(project)`.** Kahn's algorithm with a binary min-heap keyed by (order key, id), so the order is deterministic and independent tasks keep workflow order. O((V+E) log V). Leftover nodes (impossible by invariant) are reported as cyclic.
- **`wouldCycle(project, taskId, dependsOnId)`** returns `TaskId[] | null`. DFS, O(V+E).
- **`bridgeOnRemove(project, id)`** returns the new `dependsOn` per dependent. O(E).
- **`descendantBits(topo, succ)`** gives one `Uint32Array(⌈V/32⌉)` per node, ORed in reverse topological order. O((V+E)·V/32), about 50 µs at V = 150.

### 6.3 Schedule (`schedule.ts`)
```ts
export type TaskTiming =
  | { kind: "scheduled"; es: number; finish: number /* exclusive working ordinal */; duration: number; start: IsoDate | null; end: IsoDate | null;
      pinned: boolean; milestone: boolean; float: number | null; critical: boolean }
  | { kind: "unknown"; reason: "noEstimate" | "waitsOn" | "cycle"; cause: TaskId };
export interface Schedule {
  anchor: { date: IsoDate | null; ordinal: number; mode: "absolute" | "provisional" | "relative" };
  timings: ReadonlyMap<TaskId, TaskTiming>;
  steps: ReadonlyMap<StepId, { es: number; finish: number; start: IsoDate | null; end: IsoDate | null; overflows: boolean } | null>;
  topo: readonly TaskId[]; end: { finish: number; date: IsoDate | null; complete: boolean } | null;
  critical: readonly TaskId[];                           // workflow order
}
export function schedule(project: ProjectDoc, cal: WorkCalendar): Schedule;
```
1. **Anchor:**
   - `startDate ?? earliest pinnedStart`, with A = `ordinal(nextWorkingDay(anchor, true))`;
   - mode is "absolute" when `startConfirmed`, "provisional" when there is a date but no confirmation, and "relative" when there is no date (a virtual Monday 2001-01-01 on the workspace working days, no closures, dates null).
2. **Forward pass**, in topological order:
   - **Unknown:**
     - a task with `estimateDays === null` (not a milestone) is unknown with reason noEstimate, its cause being itself;
     - a task with any unknown predecessor is unknown with reason waitsOn, its cause being the cause of the first such predecessor in topological order;
     - a pin never rescues an unknown predecessor.
   - **Duration** d = milestone ? 0 : ⌈estimate / allocation⌉.
   - **Start** `es = max(A, pinnedStart ? ordinal(nextWorkingDay(pin, true)) : A, max over predecessors of finish)`, and `finish = es + d`.
   - **Dates:** `start = dateAt(es)` and `end = dateAt(finish − 1)`. A milestone's date is `dateAt(es − 1)` when it has predecessors, else `dateAt(es)`. In relative mode the dates are null.
   - Done tasks are scheduled like the others.
   - Cost: O(V+E) plus O(V log H) for the dates.
3. **Steps (Q1).** Steps with an estimate are laid back to back from the parent's `es`, each `⌈est / allocation⌉` long, clamped to the parent's finish with an `overflows` flag. A step without an estimate gets null. O(S).
4. **Backward pass**, in reverse topological order over scheduled tasks:
   - T = deadline ? `ordinal(nextWorkingDay(deadline, true)) + (isWorkingDay(deadline) ? 1 : 0)` : the maximum finish;
   - `lf = min over successors of (lf_s − d_s)`, or T for a task with no successors; `ls = lf − d`; `float = ls − es`;
   - `float = null` when the task or any transitive successor is unknown;
   - critical ⇔ float ≠ null and float ≤ 0.

   O(V+E).
5. **End** is the maximum finish. `complete = false` when an open task is unknown, which makes the end a lower bound.

**Documented cases (unit tests):**

| Case | Expected |
|---|---|
| The demo chain on Mon–Fri from Mon 28 Sep 2026 | Research 28–30 Sep · Visual Direction 1–6 Oct · UI Design 7–14 Oct · Development 15–26 Oct; all critical, every float 0 (verified with a scratch script) |
| Diamond A→B, A→C, B→D, C→D with d_B = 5, d_C = 2 | float(C) = 3; critical = {A, B, D} |
| Allocation 0.5 on 2.5 days | 5 working days |
| Pinned start on a Saturday | moves to Monday |
| Milestone after two parallel tasks | dated on the later end; successors start the next working day |
| Clearing UI Design's estimate | UI Design unknown (noEstimate), Development unknown (waitsOn, cause UI Design); end lower bound |
| Deadline 8 working days before the planned end | negative float on the chain; risk sentence (§6.4) |
| Closure across New Year | no task day inside the closure |

### 6.4 Relative labels, risks and metrics
- **`relative.ts`.** `relativeRange(t, sched)` gives "D{es − A + 1}–D{finish − A}". `relativeWeek(es, sched, cal)` gives "Week {⌊(es − A) / |workingDays|⌋ + 1}".
- **`risk.ts`:** `risks(project, sched, cal, today) → { byTask: Map<TaskId, TaskRisk>; deadline }`, O(V).
  - **Late:** only in absolute mode, for a task not Done whose end is before today. `lateDays = max(1, workingDaysBetween(end + 1, today))`. Sample and unconfirmed starts are never late (fixes B.8).
  - **Due risk:** end > dueDate, with `days = workingDaysBetween(dueDate + 1, end)`.
  - **Due soon:** not Done, and dueDate within 3 working days of today or past.
  - **Deadline:** end.date > deadline, with `gap = workingDaysBetween(deadline + 1, end)`. Sentence: "Planned end 12 Dec is 8 working days after the deadline." It says "at least" when the end is a lower bound.
- **`metrics.ts`**, O(V + S):
  - `completePct = Σ(progress × est) / Σ est` over top-level tasks with an estimate, milestones excluded. When no task has an estimate it falls back to the plain average of progress, as in v0.
  - `uncounted` lists the tasks with no estimate ("2 tasks not counted: no estimate").
  - Also: count, done, byStatus, totalEstimate, missingEstimates, urgentOpen and steps.
  - `plannedEnd` and `endIsLowerBound`; `deadlineGap`.
  - **Budget:** `knownCents = Σ manual costCents`. `derivedCents = Σ est × dayRateCents` for tasks with no manual cost whose owner resolves and has a day rate ("Derived from day rates"). `withoutCost` lists the rest.

### 6.5 Weekly load and the Phase 1 Team lane
```ts
export interface WeekCell { week: string; capacity: number | null; load: number; byProject: ReadonlyMap<ProjectId, number> }
export interface LoadReport { people: ReadonlyMap<PersonId, ReadonlyMap<string, WeekCell>>; notOnCalendar: ReadonlyMap<PersonId, { projectId: ProjectId; taskId: TaskId }[]> }
export function weeklyLoad(ws: WorkspaceDoc, plans: readonly ProjectPlan[], overrides?: ReadonlyMap<TaskId, PersonId | null>): LoadReport;
export function capacityInWeek(ws: WorkspaceDoc, person: Person, monday: IsoDate): number | null;
export interface LaneLoad {
  personId: PersonId | null; taskIds: TaskId[]; days: number; unsized: number;
  capacity: number | null; over: number | null; free: number | null; otherProjectsDays: number; weeks: string[];
}
export function laneLoads(plan: ProjectPlan, report: LoadReport, ws: WorkspaceDoc): LaneLoad[];   // project members, then the unassigned row
```
- **Projects counted:** status planning or active, and not archived or deleted in the index (§7.4).
- **Load:** for every open task (not Done) whose owner resolves to a non-archived person and that is scheduled, the daily share `estimateDays / duration` (equal to the allocation except for half-day rounding) is added, for each ISO week it spans, times its working days in that week. O(weeks spanned) per task.
- **Capacity:** `cap(p, w) = capacityDaysPerWeek × personCalendar.workingDaysBetween(monday, sunday) / |ws.workingDays|`. It is null when the capacity is null (Q3: no verdict).
- **Not on the calendar:** open owned tasks that are unestimated or unknown ("Not on the calendar: N tasks").
- **Complexity:** O(Σ V + Σ weeks spanned + P·W).
- **Lane window:** the ISO weeks of the person's open, scheduled work in this project. If there is none, the lane shows one standard week (`capacity = capacityDaysPerWeek`).
- **Lane figures:**
  - `capacity = Σ cap_w`;
  - `days` = this project's load in the window;
  - `otherProjectsDays` = other projects' load in the same weeks (drawn as a neutral segment in Phase 4);
  - `over = Σ_w max(0, loadAll_w − cap_w)` and `free = Σ_w max(0, cap_w − loadAll_w)`;
  - `unsized` = open owned tasks that are not on the calendar.
- **Overrides** let the Team view preview a pending reassign proposal.
- **Demo seed values** (verified week by week; capacities 2/4/5):

  | Person | Weeks | Lane | Label |
  |---|---|---|---|
  | Marta | W40 2, W41 5, W42 3 | 10/6d | "+4d over" |
  | Sara | none | 0/4d | "4d free" |
  | Luca | W42 2, W43 5, W44 1 | 8/15d | "7d free" |
  | After UI Design → Sara: Marta | W40 2, W41 2 | 4/4d | |
  | After UI Design → Sara: Sara | W41 3, W42 3 | 6/8d | "2d free" |

### 6.6 Balance v2 (`balance.ts`) and leveling (`level.ts`)
```ts
export type BalanceMove =
  | { type: "owner"; taskId: TaskId; from: PersonId | null; to: PersonId; why: string }
  | { type: "shift"; taskId: TaskId; days: number; pinnedStart: IsoDate; why: string };
export function balance(ws: WorkspaceDoc, plans: readonly ProjectPlan[], scope: ProjectId,
  opts?: { allowShift?: boolean /* default true */; maxMoves?: number /* 8 */; assignUnowned?: boolean /* true */ }):
  { moves: BalanceMove[]; blocked: { personId: PersonId; over: number } | null };
export function level(ws: WorkspaceDoc, plan: ProjectPlan): { taskId: TaskId; pinnedStart: IsoDate; days: number; why: string }[];
```
**Balance:**
1. Optionally, each unowned, scheduled, open task goes to the first receiver that fits every week (v0 parity).
2. Up to `maxMoves` times:
   - the giver P is the person with the largest `Σ_w max(0, load − cap)`; stop when that is ≤ 0;
   - candidates are P's tasks in scope with status todo or active (never review or done) that overlap one of P's overloaded weeks, sorted by progress ascending, then order key;
   - receivers are non-archived people with a known capacity, other than P, with `free(R, w) ≥ share(t, w)` in **every** week of t;
   - receivers are ranked by:
     1. role equality (trimmed, case-insensitive);
     2. the largest minimum free capacity across t's weeks;
     3. name;
   - the first fit becomes an owner move, and loads update incrementally.
   - The why reads "Marta is 4d over capacity. Sara has room for its 6d." (the v0 card copy).
3. If nothing fits and `allowShift` is on: pick the candidate with known float ≥ 1 and the smallest shift s ≤ float that clears P's overload over the shifted window. The why reads "Shift Copywriting by 3 days: it has 5 days of float".

- **Demo:** exactly one move, UI Design → Sara. Sara's minimum free capacity over W41–W42 is 4; Luca's is 3, because W42 holds 2 of his days.
- **Cost:** O(M·C·R·W).
- `/demo` calls `balance` with `allowShift: false`, because the v0 PlanCard shows owner moves only. Phase 4 enables shifts.

**Leveling:** serial schedule generation.
- Tasks are taken in topological order, then priority descending, then order key.
- Each start is the first index at or after the predecessors' finish (and the pin) where the owner's daily usage plus the share stays at most 1.
- Daily usage is tracked per person with an `Int16` map. Review and Done tasks are fixed.
- Cost: O(V log V + Σ d). Implemented and tested in Phase 1; the UI arrives in Phase 5.

### 6.7 Focus v2 (`focus.weights.ts`, `focus.ts`)
```ts
export const FOCUS_WEIGHTS = { priority: { urgent: 40, high: 25, medium: 12, low: 4 }, active: 15, review: 10,
  late: 35, latePerDay: 3, lateMax: 30, dueSoon: 20, dueSoonDays: 3, critical: 15, tightFloat: 8, tightFloatDays: 2,
  waitingEach: 5, waitingMax: 25 } as const;
export interface FocusReason { key: "priority" | "late" | "dueSoon" | "active" | "review" | "critical" | "waiting" | "tightFloat";
  points: number; text: string; phrase: string | null; clause: boolean; risk: boolean }
export interface FocusCandidate { taskId: TaskId; projectId: ProjectId; score: number; reasons: FocusReason[]; why: string; nextStepId: StepId | null }
export interface FocusResult { pick: (FocusCandidate & { chosenBy: "form" | "you" }) | null; ranked: FocusCandidate[]; blocked: ReadonlySet<TaskId> }
export function focus(plans: readonly ProjectPlan[], opts: { today: IsoDate; pin?: TaskId | null; ownerId?: PersonId | null }): FocusResult;
```
- **Blocked:** status todo and any predecessor not Done. Blocked tasks are excluded from the pick.
- **Pin:** a pinned task wins when it is open.
- **Ties:** order key, then project creation order (for "me").
- **Reasons:**
  - **priority:** text "Urgent priority", phrase "urgent", risk true (for High: "High priority", phrase "high priority"; Medium and Low have no phrase);
  - **active:** "In progress · 30%";
  - **review:** "In review, close to done";
  - **late:** "Late · N working days", clause, risk;
  - **dueSoon:** "Due 16 Oct", risk;
  - **critical:** "On the critical path", phrase "on the critical path";
  - **tightFloat:** "2 days of float";
  - **waiting:** "Development waits on it" or "3 tasks wait for it", clause.
- **Ordering** is by points, then the fixed key order above.
- **Why** joins the two highest phrase-bearing reasons: adjectives with " and ", clauses with "; ". Example: "Urgent and on the critical path."
- **Demo at 2026-10-14:**

  | Task | Score | Note |
  |---|---|---|
  | UI Design | 83 (40 + 15 + 15 + 8 + 5) | picked; why "Urgent and on the critical path." |
  | Visual Direction | 68 (25 + 10 + 15 + 8 + 10) | |
  | Development | – | blocked |
  | Research | – | done |

- **Cost:** scores O(V+E) plus the bitsets; the pick O(V log V).

### 6.8 Plan façade and memoisation (`index.ts`, `memo.ts`)
```ts
export interface ProjectPlan {
  readonly project: ProjectDoc; readonly workspace: WorkspaceDoc; readonly today: IsoDate; readonly calendar: WorkCalendar;
  readonly topo: readonly TaskId[]; readonly schedule: Schedule; readonly risks: Risks; readonly metrics: Metrics;
  readonly focus: FocusResult; readonly number: (id: TaskId) => string /* "01" */;
}
export function planProject(project: ProjectDoc, ws: WorkspaceDoc, today: IsoDate): ProjectPlan;   // parts are lazy getters
export function planWorkspace(ws: WorkspaceDoc, projects: readonly ProjectDoc[], today: IsoDate): { plans: ProjectPlan[]; load: LoadReport };
```
- **Identity is the version.** Immer keeps unchanged subtrees and every committed version is a new frozen object, so object identity stands for the version.
- **`planProject`** is memoised in a `WeakMap<ProjectDoc, Map<string, ProjectPlan>>` keyed by `${calendarKey}|${today}`.
- **Stage memos:**
  - `schedule` is keyed on (the `project.tasks` reference, startDate, startConfirmed, deadline, calendarKey), so a viewConfig change does not reschedule (a spy test covers it);
  - `weeklyLoad` is keyed on the shallow tuple (project references, `ws.people`, overrides).
- **Performance budgets** (Node; median of 30 runs after 5 warm-ups; CI multiplies the budget by 3):

| Function, on a 150-task DAG (3 steps per task, about 1.5 predecessors) | Budget |
|---|---|
| planProject cold (schedule + risks + metrics + focus) | ≤ 8 ms (target ≈ 2 ms) |
| planProject warm | ≤ 0.05 ms |
| focus | ≤ 2 ms |
| composeBrief | ≤ 4 ms |
| weeklyLoad, 10 projects × 150 tasks | ≤ 15 ms |
| balance | ≤ 5 ms |
| level | ≤ 5 ms |

- **Growth guard:** t(300) / t(150) < 3 for every function.
- **For comparison, v0 measured** focusPick at about 150 ms and composeBrief at about 300 ms at 150 tasks. No Web Worker is needed in Phase 1.

### 6.9 Brief composer v2 (`compose/brief.ts`)
- **Signature:** `composeBrief({ plan, ws, audience, short, today, lanes }) → Brief | null`.
- **Keeps** v0's `Brief` type, section order, short-version rules and stable sentence ids: `head:status`, `head:focus`, `done:all|none`, `moving:<taskId>`, `next:up|then|step|end`, `risks:<taskId>`, `risks:load:<personId>`, `risks:none`, and `questions:start|unsized|owners|costs`.
- **New ids:** `questions:unknown` and `risks:deadline`.
- **Cost:** O(V + S + L), with no nested scans. People and tasks are indexed once.
- **Wording comes from the plan:**
  - `next:end`: "On the sample schedule, the last task ends 26 Oct.";
  - risks use only risk phrases (urgent, late, due soon, deadline): "UI Design is urgent.";
  - load lines use lane `over`: "Marta is 4 days over capacity.".
- **The eyebrow** keeps "Sample schedule" in `/demo`. "Indicative dates" arrives in Phase 4.

---

## 7. Migration v0 → v2 (`src/lib/migrate`)

"v0 document" means what `localStorage["form.workspace.v1"]` holds. v1 §5.8 calls it "v1"; it has no `schemaVersion`. The migration:
- is pure;
- is deterministic for a given `(now, minter seed)`;
- never writes or removes either v0 key, because the Phase 2 importer reads them again.

### 7.1 Entry points
```ts
export function readV0(storage: Pick<Storage, "getItem">): { raw: unknown; source: "main" | "backup" } | null;
// main: JSON.parse(form.workspace.v1).state.doc (zustand envelope) or a bare doc; if missing or unsalvageable,
// form.workspace.v1.backup ({doc, log}, written by the safety patch). Runs before any store hydrates.
export interface MigrateV0Options {
  now: Timestamp; mint: Minter; mode: "demo" | "import"; workspace: WorkspaceDoc;
  sample: { ids: Record<"p-marta" | "p-sara" | "p-luca", PersonId>; capacities: Record<"p-marta" | "p-sara" | "p-luca", number> };   // demo mode
  includeSampleTeam: boolean;                            // import mode only (Q4)
}
export interface MigrationReport {
  source: "main" | "backup"; salvaged: { path: string; was: string; now: string }[]; dropped: { what: string; why: string }[];
  promoted: number; repaired: { title: string; from: string; to: string }[]; notices: "weekendsNow"[];
  sample: { team: boolean; start: boolean }; assets: { referenced: string[] }; capacityUnknown: PersonId[]; changes: number;
}
export function migrateV0(raw: unknown, o: MigrateV0Options): {
  people: Person[]; project: ProjectDoc | null; idMap: IdMap; local: { activeView: ViewKind | null }; report: MigrationReport;
};
export function detectV0(raw: unknown): boolean;          // has tool and tasks, no schemaVersion
export const CURRENT_SCHEMA = 2;
export const MIGRATIONS: Record<number, { project?: (d: unknown) => unknown; workspace?: (d: unknown) => unknown }> = {};   // 2 → 3 and later
export function upgradeProjectDoc(d: unknown): ProjectDoc;   // loops while schemaVersion < CURRENT, then strict parse + checkProject
```

### 7.2 Steps, field by field
1. **Salvage parse** (`v0/schema.ts`, lenient: a `.catch` per field and per item). Every coercion is written to `report.salvaged`.
   - The project title is cut to 80.
   - **Each task:**
     - title cut to 140, with nothing to truncate in practice (Q11);
     - unknown status or priority becomes todo or medium;
     - progress is rounded and clamped to 0–100;
     - the estimate is rounded to the nearest 0.5 and clamped to [0.5, 250];
     - cost is kept only if finite and ≥ 0;
     - owner is a string or null.
   - **Legacy shapes:** no `tool.views` → `[view.representation]` (the old `migrateViews`); missing `mood`, `people`, `plan` or `brief` → defaults.
   - **Caps:** people at 20 (by array order); mood at 200, with its geometry clamped.
   - `tool === null` gives `project: null` and `people: []`.
2. **IdMap (Q10).** Ids are minted once, in a fixed order, so snapshots are stable:
   1. project;
   2. top-level tasks in v0 order;
   3. steps, by parent in workflow order, then record order;
   4. people in array order;
   5. mood items in array order;
   6. brief lines;
   7. the proposal and its items.

   | v0 | v2 |
   |---|---|
   | `tool-*` | `prj_` |
   | `t-*` (top level) | `tsk_` |
   | `t-*` / `s-*` (steps) | `stp_` |
   | `p-*` (people) | `per_`; in demo mode the sample ids map to `SAMPLE_PEOPLE` |
   | `m-*` | `mdi_` |
   | `b-*` | `brl_` |
   | proposal items (`p-*`, which clash with the person prefix) | `stp_` |
   | `img-*` | `ast_`, recorded in `assetAliases` |
3. **Project fields:**

   | v2 field | Value |
   |---|---|
   | kind | "website" (the v0 template is always a website) |
   | title | `tool.title` |
   | startDate | `tool.startDate` (null if not a valid date) |
   | startConfirmed | `!startDateIsSample`. Caveat recorded: the ±1-week buttons set it in v0. |
   | status | "active" if any task is active, in review, or done; else "planning" |
   | deadline, budgetCents, client, goal, leadId | null; deadlineKind "soft"; currency = `workspace.defaultCurrency` (EUR) |
   | requireReview / autoChain / calendarOverride | false / true / null |
   | links, tags | [] |
   | memberIds | the distinct resolved owners, plus the sample people in demo mode |
   | views | `tool.views` (same ids, "cards" kept) |
   | blocks | `tool.blocks` in BLOCK_ORDER |
   | createdAt | now |

   **viewConfig:**
   - density, layout, columns and sort from `view`;
   - hideDone and highlightUrgent from `view`;
   - fields: priority, estimate and progress from v0; owner, due and cost false;
   - filters empty (due "any");
   - `focusPin` = the mapped `focusId` only if it points at an existing top-level task, else null with a report line;
   - brief = `{ audience: briefAudience ?? "client", short: briefShort ?? false }`.

   The local active view is `view.representation` when it is in `views`, else `views[0]`.
4. **Tasks:**
   - **Order:** the `order` array filtered to existing top-level ids and de-duplicated, then the top-level tasks missing from it (by record order, reported). Order keys are `nKeys(n)`.
   - **Dependencies:** a finish-to-start chain over that order, where task i depends on task i−1 (§5.8). The sequence is identical, and the dates are recomputed on working days.
   - **Fields:**
     - `estimateDays` = the v0 number read as working days, with no ×5/7 conversion (Q5);
     - `costCents = Math.round(cost × 100)`, manual;
     - `ownerId` = the mapped owner, or null if that person is not imported (reported);
     - emphasis is kept; `origin` is dropped;
     - kind "task", allocation 1, everything else null or empty;
     - `createdAt` = now.
   - **Coherence:** `repairTask` (Q2, status wins), with every change reported.

     | v0 state | v2 state |
     |---|---|
     | done@40 | done@100 |
     | todo@30 | active@30 |
     | review@100 | review@95 |
     | active@100 | active@95 |
     | todo@100 | active@95 |

     `completedAt` is null for imported Done tasks: unknown, never invented.
5. **Steps:**
   - Tasks whose parent is top-level become `Step{id, title, done: status === "done", ownerId: null, estimateDays}`, in record order (v0 `Object.values`).
   - Grandchildren are flattened onto their top-level ancestor, after its direct steps (reported).
   - **Orphans** (parent missing or a parentId cycle) are promoted to top-level tasks at the end, with no dependencies (`report.promoted`). Nothing the user wrote is lost.
   - Steps beyond 40 on one task are promoted to tasks (reported).
   - A step's status other than Done, and its priority, progress, cost and emphasis, are lost and reported.
6. **People:**
   - **Demo mode:** p-marta, p-sara and p-luca, when their names match, map to `SAMPLE_PEOPLE`: their fixed ids, weekly capacities 2/4/5 and roles. Every other person gets `capacityDaysPerWeek: null`, because v0 stored days per project, which has no honest weekly conversion (Q3, reported in `capacityUnknown`).
   - **Import mode (Phase 2):**
     - sample people are imported only if `includeSampleTeam` (Q4); otherwise their tasks lose their owner (reported);
     - people are deduplicated by case-insensitive name against `workspace.people`, reusing the existing id;
     - everyone gets capacity null.
   - All modes: name and role kept; email, userId and dayRate null; time off {}; archived false; order keys appended.
7. **Proposal.** When v0 has both a `proposal` (subtasks) and a `plan` (reassign), the subtasks one is kept: it is tied to a task the user chose, and "Balance the workload" recomputes the plan in one command. The plan is reported as dropped.
   - Targets are validated. Items get fresh `stp_` ids. Reassign moves become `type: "owner"` with `from` filled in, and moves with `to: null` are dropped.
8. **Moodboard:**
   - items become a record keyed by `mdi_` ids;
   - z keys follow the array order, so stacking is preserved;
   - geometry is clamped;
   - hex is lowercased;
   - `asset` becomes `assetId` through the IdMap, and the referenced keys go to `report.assets` (Phase 2 uploads only those).
9. **Brief:**
   - lines get `brl_` ids;
   - edit keys are rewritten segment by segment where the sentence id embeds an entity (`moving:<t>`, `risks:<t>`, `risks:load:<p>`);
   - an edit whose entity is gone, or whose key fails `BriefEditKey`, is dropped (reported);
   - bases are kept, so lines whose composed wording changes with working days show "FORM's version changed", which is honest;
   - `sent` is [] and sharing is `{showBudgetToClient: false}`.
10. **Log:** the labels are dropped (raw commands, privacy). In demo mode `changes = log.length`, so the corner counter is unchanged.
11. **Notices:** `weekendsNow` when a project with estimates and a start date was migrated. `/demo` shows "Schedule now skips weekends." once (Q5, Q13).
12. **Validation:** both outputs must pass the strict schemas and `check*`. Otherwise a `MigrationError(report)` is thrown; the fixtures and the totality property prove this never happens.

### 7.3 `/demo` first load (`demo/storage.ts`)
- **No `form.demo.v2` key:**
  - `readV0` returns a document → `migrateV0` in demo mode, merged into `demoWorkspace(now, browserTz)` ("Demo studio", EUR, Mon–Fri);
  - the result is written to `form.demo.v2` with `assetAliases`; IndexedDB blobs are never copied or deleted, and `useAssetUrl` falls back to the alias key;
  - `notices.weekendsPending` is set to true.
- **No v0 document either:** an empty demo workspace. The sample people are added when a project is created.
- **`form.demo.v2` present but unreadable** (JSON, schema or invariants):
  - its raw string is copied to `form.demo.v2.backup`;
  - the demo starts empty;
  - the caption reads "FORM couldn't read the saved demo, so a copy was kept." There is never a silent wipe.
- **Saving:** debounced at 250 ms, only on document, local or notice changes. Deleted projects and their index entries are compacted out of the envelope (demo-only; history is session-only, so nothing can reference them after a reload).
- **Phase 2's importer** prefers `form.demo.v2` (newer, already v2) and falls back to the v0 keys.

---

## 8. `/demo` on the new engine

### 8.1 Mechanism
- **Reads:** components → hooks (`lib/store/hooks.ts`) → memoised selectors over `{ workspace, projects[active], local, today }` → v2 documents and planning.
- **Writes:**
  - components → `useActions()` → action creators (which mint ids) → `commit` → `runCommand` → new documents, history entry and caption;
  - gestures → `beginGesture` / `live` / `endGesture`.
- **Parser:** `submit(text)` → `fastParse` (synchronous) → the 340 ms beat → `runCommand`.

**Store** (`lib/store/form.ts`, Zustand; exposed as `window.__form` only when `NODE_ENV !== "production"` or `NEXT_PUBLIC_FORM_E2E=1`):
```ts
interface FormState {
  docs: DocsState; activeProjectId: ProjectId | null; local: LocalViewState; today: IsoDate;
  changes: number; notices: { weekendsPending: boolean }; assetAliases: Record<AssetId, string>;
  past: HistoryEntry[]; future: HistoryEntry[]; gesture: Gesture | null;
  composerOpen: boolean; phase: "rest" | "processing" | "creating"; caption: (Caption & { id: number }) | null;
  fx: Fx; spawn: Rect[] | null; commandHistory: string[]; reducedMotion: boolean; intro: boolean;
  submit(text: string): Promise<boolean>;
  commit(ops: Op[], meta: { label: string; caption?: boolean; local?: LocalIntent[] }): CommandResult;
  beginGesture(): void; live(ops: Op[]): void; endGesture(): void;
  showView(v: ViewKind): void; select(id: TaskId | null): void;
  resolveProposal(accept: boolean, only?: string[]): void;
  undo(): void; redo(): void; reset(): void;   // reset = deleteProject(active), undoable, caption "Workspace reset"
  openComposer(): void; closeComposer(): void; dismissCaption(): void; setSpawn(r: Rect[] | null): void;
  setReducedMotion(v: boolean): void; setIntro(open: boolean): void; tick(today: IsoDate): void;
}
```
- **`fx`** ports `fxFor`:
  - create when createProject applied;
  - shift when the active view changed, or the active view was removed;
  - reflow for setView, addBlock and removeBlock;
  - edit otherwise;
  - restore for undo and redo.

  `added` is the view added and shown. `phase: "creating"` and `CREATE_TOTAL_MS` are unchanged, so the birth, morph and handover choreographies receive the same signals.
- **`changes`** increments once per history entry and is shown in the corner ("{n} changes · saved locally").
- **The view in the URL.** `?view=` is read on mount; otherwise the envelope's `lastView` is used, otherwise `homeView`. It is written with `history.replaceState` on every tab change. Selection stays session-only.
- **Today** is `todayIn(ws.timezone, Date.now())`, re-ticked at local midnight. The demo workspace's time zone is the browser's at creation.

**Hooks** (`lib/store/hooks.ts`):
- Each derived hook is `useForm(selectX)`, where `selectX` is memoised with WeakMaps over (active project, workspace, local, today), so selectors return stable references and no component subscribes to the whole state (§12.9).
- `useShallow` is used for arrays of ids.

| Group | Hooks |
|---|---|
| Data | `useProject()`, `useProjectTitle()`, `useViews()`, `useBlocks()`, `useViewConfig()`, `useActiveView()`, `useTask(id)`, `useTaskIds()`, `useVisibleTaskIds()`, `useTasksByStatus()`, `useTaskNumber(id)`, `useSteps(taskId)`, `useProposal()`, `useSubtaskProposal(taskId)`, `useMembers()`, `usePerson(id)`, `useMoodItems()`, `useBriefState()` |
| Derived | `usePlan()`, `useTiming(id)`, `useTimelineGrid()` (calendarOffsets for the v0 day grid), `useMetrics()`, `useFocus()`, `useFocusFor(id)`, `useLaneLoads({ preview })`, `useBrief()`, `useToday()` |
| Session | `useSelectedId()`, `useIsSelected(id)`, `usePhase()`, `useCaption()`, `useComposerOpen()`, `useFx()`, `useSpawn()`, `useReducedMotion()`, `useIntro()`, `useCanUndo()`, `useCanRedo()`, `useChangeCount()`, `useSuggestions()`, `usePalette()` |
| Actions | `useActions()`: a stable object with commit, the gesture API, showView, select, resolveProposal, undo, redo, reset, submit, and the minting creators (`addTaskAtEnd(title)`, `addStep(taskId, title)`, `addImages(files, at)`, `addColour`, `addNote`, `addPerson()` with capacity 5, `addSampleTeam()`, `addBriefLine(...)`, `shiftStart(±7)`) |

**Call-site mapping:**

| v0 | v2 |
|---|---|
| `useForm(s => s.doc)` + `visibleTasks(doc)` | `useVisibleTaskIds()` + `useTask(id)` |
| `doc.view.*` | `useViewConfig()` / `useActiveView()` |
| `doc.tool!.title` / `.views` / `.blocks` | `useProjectTitle()` / `useViews()` / `useBlocks()` |
| `schedule(doc)` | `useTimelineGrid()` |
| `loadsOf(doc)` / `ownersOf(doc, plan)` | `useLaneLoads({ preview })` |
| `focusPick` / `pickFor` / `summaryOf` | `useFocus()` / `useFocusFor(id)` / `summaryOf(candidate, task)` (planning/format) |
| `composeBrief(doc, …)` | `useBrief()` |
| `subtasksOf` | `useSteps(taskId)` (`task.steps`) |
| `taskNumber(doc, id)` | `useTaskNumber(id)` |
| `updateTask(id, p, {history: false})` + `checkpoint()` | `beginGesture` / `live` / `endGesture` |

**Field renames:**
- `estimate` → `estimateDays`;
- `cost` → `costCents` with `formatMoney`;
- `owner` → `ownerId`;
- step status → `done`;
- `representation` → `local.activeView`;
- `tool` → `project`;
- `startDateIsSample` → `!startConfirmed`;
- `focusId` → `focusPin`.

The view ids, block ids and labels are unchanged.

### 8.2 Component changes, file by file
Markup, classes and motion props stay unchanged unless stated. Every layoutId is kept: `sub-${stepId}`, `tl-sub-${stepId}`, `team-${taskId}`, and the tab and ink ids.

| File | Change |
|---|---|
| `FormApp.tsx` | Engine discovery removed. View-URL sync and the midnight tick added. The `__form` handle is gated as above. |
| `Chrome.tsx` | The engine label is constant: "Demo parser · no AI model"; the tooltip is unchanged. The counter comes from `useChangeCount`. |
| `Intro.tsx` | Engine-dependent text removed; the demo-parser sentence is kept as is. |
| `Workspace.tsx`, `registry.ts`, `reveal.ts` | Hooks only. |
| `blocks.tsx` | Header title → `updateProject{title}`. The subtitle reads metrics and `!startConfirmed` ("sample start"). Tabs read `views`, and a click calls `showView` (local, Q6). ViewControls → `setView`. Metrics and Progress use `useMetrics`. |
| `CardsView`, `BoardView`, `EmptyFilter`, `TaskCard` | Hooks only. Board lane arrows → `updateTask{status}` (transitions apply). |
| `parts.tsx` | The status, priority and progress controls use the gesture API. **EstimateControl:** "+ Duration" opens the stepper empty ("—") and the first "+" sets 0.5 (Q3). SubtaskList renders `task.steps` through updateStep and removeStep. ProposalBlock reads the subtasks proposal. CostTag uses `formatMoney`. |
| `TimelineView.tsx` | A calendar-day grid with weekends shaded (v0 look). Bars come from `calendarOffsets` (working-day start to end, visually spanning the weekends inside). Unknown rows: a task without an estimate keeps "Needs a duration" plus "+ Duration"; its successors show "Needs {Root}'s estimate" in the same `t-data text-text-3` style, without the control. Step bars come from the step slots. Proposal dashed bars use the step slots of the proposal preview. Footer: "{Sample schedule \| Schedule} · working days, from estimates and dependencies · {n} without dates". The ±1-week buttons → `updateProject{startDate}` + `updateProject{startConfirmed: true}`. |
| `TeamView.tsx` | Rows are project members (plus the Unassigned row) from `useLaneLoads`. Track = `lane.capacity`. Segments are sized by estimate (unknown = 1 day, dashed, as in v0). The hatch spans [days − over, days]. LoadFigure prints "{days}/{capacity}d" and "+{over}d over" or "{free}d free". A null capacity gives a lane equal to the work, no capacity line and "Capacity unknown" (Q3). Drag → assignTask / unassignTask. "Add person" → `addPerson()` with a visible 5. "Use a sample team" → `addSampleTeam()`. `SAMPLE_IDS` → `isSamplePerson(id)`. PlanCard reads the reassign proposal. |
| `FocusView.tsx` | `useFocus` and `useFocusFor`. The pin → `setFocus` (a commit). The next step's "Mark done" → `updateStep{done: true}`. The floating volumes are unchanged in Phase 1. |
| `BriefView.tsx` | `useBrief`. Brief ops carry minted line ids. "Show N hidden" → one `resetBriefLine{keys}`. |
| `Moodboard.tsx`, `ColorPicker.tsx` | `useMoodItems` (sorted by z). Drops mint `ast_` ids through `addImages`. Arrange and clear pass the current item ids. Raise → `toFront`. |
| `agent/Composer`, `CommandSheet`, `CompactPill`, `ViewNodes`, `AgentLayer` | Hooks only. `suggestions.ts`: `suggestionsFor(project, local, selection)` ported; `CAPABILITIES` replaced by `paletteGroups("demo")`, with the same groups and order. |
| `agent/Fluid.tsx`, `agent/loop.ts`, `AgentLayer.tsx` | The agent loop fix (§9.1), landed earlier on the v0 code. |
| `Caption.tsx`, `TextMotion.tsx`, `ShuffleText.tsx`, `geometry.ts`, `IdleCaption.tsx` | Unchanged except for hooks. |

### 8.3 The v0 template in v2 (`lib/demo/sample.ts`, `seed.ts`)
- **SAMPLE_PEOPLE** (§0.7 allows sample data only in `/demo`):

  | Id | Name | Role | Days a week |
  |---|---|---|---|
  | `per_demomarta` | Marta | Art director | 2 |
  | `per_demosara` | Sara | Designer | 4 |
  | `per_demoluca` | Luca | Developer | 5 |

  These capacities keep the v0 story true under weekly load: Marta starts over, and balance moves UI Design to Sara.
- **`demoDraft(title, startAs)`:**
  - kind website, `startDate: "2026-09-28"` (SAMPLE_START), `startConfirmed: false`;
  - currency EUR, the sample people as members;
  - autoChain true, requireReview false;
  - views `[startAs]`, blocks `[header, metrics, collection]`.
- **Seeds** (`DEMO_TASKS`, with the task ids minted at creation):

  | Task | Status | Priority | Progress | Estimate | Owner | Depends on |
  |---|---|---|---|---|---|---|
  | Research | done | low | 100 | 3 | Sara | – |
  | Visual Direction | review | high | 85 | 4 | Marta | Research |
  | UI Design | active | urgent | 30 | 6 | Marta | Visual Direction |
  | Development | todo | medium | 0 | 8 | Luca | UI Design |

  `completedAt` is null for Research: unknown for a sample. The project status is "active".
- **`createDemoProject(title, startAs, wantsMoodboard)`** produces:
  1. `deleteProject(active)` when replacing (the `replacesProject` rule);
  2. addPerson or restorePerson for each missing or archived sample person;
  3. `createProject{projectId, draft, tasks}`;
  4. `addBlock(moodboard)` when asked;
  5. the local `show(startAs)`.

  That is at most 7 ops, in one history entry.

### 8.4 Parser (`lib/interpret/fast`)
- **Port.** `demo.ts` is split by family. The regexes and the precedence order are unchanged:
  1. control;
  2. view removal;
  3. brief edits;
  4. reset;
  5. unsupported families;
  6. status brief;
  7. create;
  8. no project;
  9. plan follow-ups;
  10. moodboard;
  11. team;
  12. proposal follow-ups;
  13. entity;
  14. workspace.
- **Context:** `{ ws, project, plan, local, selectedTaskId, mint, today, breakdown }`, where `breakdown` is injected from `demo/library` (Q20).
- **Output:**
  ```ts
  type FastResult =
    | { status: "matched"; confidence: 1 | 0.9 | 0.5; ops: Op[]; local: LocalIntent[]; notes: QueryNote[]; notices: NoticeKey[]; reply?: { tone: "clarify"; text: string } }
    | { status: "matched"; confidence: 1; control: "undo" | "redo" | "reset" }
    | { status: "none"; reply: { tone: "unsupported"; text: string } };   // v0 texts; Phase 5 routes "none" to Claude
  ```
  This is already the §9.2 contract.
- **Changes from v0:**
  - Every op is built through `ops/build.ts`, and every id is minted with `ctx.mint`.
  - `setRepresentation` becomes `addView` when the view is missing, plus a local show.
  - `setView.focusId` becomes `setFocus`.
  - Proposal follow-ups name the pending proposal id.
  - "Add a sample team" uses the demo expansion.
  - "N weeks" means N × 5 working days.
  - "N days a week" and "N days" in a capacity sentence mean days per week; above 7 the parser answers the clarify "Capacity is days per week, up to 7.".
  - People added by command get a null capacity; the caption adds "· capacity not set", and the next suggestion chip is "Set Giulia's capacity to 4 days a week" (Q3).
- **Kept:** the v0 false positives (deadline → timeline, budget → cost, start → active) remain in `/demo` until Phase 5 narrows them.
- **Captions:** the parser builds none. The clarify and unsupported texts are v0's, verbatim.
- **Breakdown library.** It allocates half-day units by largest remainder, so step estimates add up exactly to the parent's estimate. When there are fewer units than steps, the estimates are null and the caption says "· no estimates". The proposal caption claims "fits its Nd estimate" only when the sum is exact.

### 8.5 What changes visually
Every visible change in `/demo` comes from one of these decided sources:
- working days and unknown blocking (Q5, Q13);
- the Q14 contrast tokens;
- the agent settling (Q29), already in baseline B;
- honest captions and no-ops (AUDIT #6);
- the Q3 and Q6 behaviours;
- the model corrections those imply.

Everything else must be pixel-identical to baseline B. The expected differences against B, at a frozen clock of 2026-10-14 (`e2e/expected-diffs.md`, each with a masked region and a text assertion):

| Id | Where | Expected |
|---|---|---|
| ED-1 | Timeline chart | Bars and ranges: Visual Direction 01.10–06.10, UI Design 07.10–14.10, Development 15.10–26.10. The grid extends to the planned end. "Needs {Root}'s estimate" rows only in states with a cleared estimate. |
| ED-2 | Timeline footer | "Sample schedule · working days, from estimates and dependencies" |
| ED-3 | Team lanes and figures | Marta 10/6d "+4d over"; Sara 0/4d "4d free"; Luca 8/15d "7d free". Plan card: "Marta is 4d over capacity. Sara has room for its 6d." After accepting: Marta 4/4d, Sara 6/8d "2d free". |
| ED-4 | Focus | Lead "In progress, 30% done." Point "Urgent and on the critical path." Chips: Urgent priority · In progress · 30% · On the critical path. |
| ED-5 | Brief | next:end "On the sample schedule, the last task ends 26 Oct."; client risks "UI Design is urgent."; team load line "Marta is 4 days over capacity." |
| ED-6 | Captions | Only the lines in `test/golden/expected-diffs.ts`: no-ops ("Research is already done", no Undo); capacity wording; "Luca removed · 1 task unassigned"; the honest breakdown "fits"; "2 weeks" = 10d; tab-only commands without Undo (Q6). |
| ED-7 | Corner chrome | Engine label "Demo parser · no AI model"; the change counter no longer counts tab switches (Q6). |
| ED-8 | Palette | "Set Marta's capacity to 4 days a week" |
| ED-9 | Interaction states | "+ Duration" opens empty; Team "Add person" shows 0/5d; command-added people show "Capacity unknown". |
| ED-10 | First load of a migrated save | The one-off caption "Schedule now skips weekends." |

---

## 9. Agent loop and the other audit additions scheduled in Phase 1

### 9.1 Agent loop (AUDIT §11.2a; Q26, Q29)
These edits land on the v0 code before the switchover, in their own commit.

- **A1: `src/components/agent/loop.ts` (new).** `useSettlingLoop(step, { awake })` is a rAF loop that the agent can put to sleep. It replaces Motion's `useAnimationFrame` in `Fluid.tsx`.
  - **Settled** means every particle has speed < 2 px/s, |vr| < 1 px/s, |home − pos| < 0.25 px and |home.r − r| < 0.25 px for 500 ms. The loop then snaps to the homes, writes the attributes once and stops.
  - **Only the rest modes can settle** (ring, compact, docked). Hover, input, processing, emit and creation never sleep.
  - **Breathing** (the time-based ring and compact oscillation) fades to zero over 0.8 s after 4 s without input (Q29), so the material can settle.
  - **Wake triggers:**
    - any prop change (mode, anchor, scale, targets, satellite, pressed);
    - a `pointermove` within 1.5 × the influence radius (330 × scale px from the anchor);
    - `visibilitychange` to visible.
  - **Hidden tab:** the loop never runs; it stops explicitly on `visibilitychange`.
  - **Reduced motion:** no loop. The homes are written once per change, giving a static SVG with the same pixels as v0's reduced-motion rest.
- **A2: `AgentLayer.tsx`.**
  - The `#form-goo` filter uses `filterUnits="userSpaceOnUse"`, with x, y, width and height set to the union bounding box of the volumes, node blobs and body, plus 3σ (26 px). The region is updated only when it moves by more than 8 px.
  - During creation the region is the viewport, as today.
  - The SVG gets its own compositing layer (`will-change: transform`), so idle frames no longer repaint the page.
- **Done when:**
  - the agent SVG shows 0 mutations per second 1 s after settling, in normal and reduced motion, with 60 cards;
  - the loop resumes within one frame of a pointer moving near the agent;
  - a hidden tab gives 0;
  - renderer main-thread time at rest with 60 cards falls from 108 ms/s toward the audit's agent-hidden 22 ms/s (CDP);
  - clock-stepped frames of birth, hover, input, processing, emit and compact (0–1,750 ms) match the tokens baseline.

### 9.2 Contrast tokens (Q14)
This is its own commit, on the v0 code, before baseline B.
- **C1: `globals.css`:**

  | Token | Value |
  |---|---|
  | `--text-2` | `rgba(10,10,10,.72)` |
  | `--text-3` | `rgba(10,10,10,.60)` |
  | `--on-ink-3` | `rgba(244,244,242,.56)` |
  | new `--line-strong` | `rgba(10,10,10,.46)` |
  | new `--signal-text` | `#b81f17` in `.tone-light`, `#ff3b2f` in `.tone-dark` |
  | new `--signal-graphic` | `#e8261b`, for red on paper or the bar track |
  | `.tone-dark --c-dot-off` | `rgba(255,255,255,.40)` |

  `--text-4` stays for disabled controls and decorative hairlines only.
- **C2: dim the surface, not the text.** The card background alpha goes from .52 to .29, plus the frame and shadow, in:
  - `TaskCard.tsx` (urgent highlight);
  - `BoardView.tsx` cards;
  - `TeamView.tsx` segments (50% and 40%);
  - the `TimelineView.tsx` bars.
- **C3: red text uses `--signal-text`**: the TaskCard "Urgent" label and the TeamView "+Nd over". The urgent dot on the timeline bar track uses `--signal-graphic`.
- **C4: `--line-strong` replaces weak strokes and `--text-3` replaces `--text-4` where information was shown:**
  - `--line-strong` for the priority off ring (`parts.tsx`, `globals.css --c-dot-off`), the switch off track (`blocks.tsx`), meaningful dashed borders and the contenteditable focus ring;
  - `--text-3` for the informational uses of `--text-4`: the CommandSheet hint, the weekend day numbers, the note placeholder and the brief editor placeholder.

  The call sites are listed in AUDIT §12.1. The Team hatch stays decorative.
- **Done when:**
  - `scripts/audit/contrast.mjs` reports ≥ 4.5:1 for every text token on paper, paper-lo, glass, glass-hi, the sheet, the board card and the dimmed card, and ≥ 3:1 for `--line-strong` and `--signal-graphic`;
  - axe shows no colour-contrast violation on resolvable nodes in the 9 audited states;
  - before and after screenshots of every view are in the PR for Nicola's review.

### 9.3 Audit Phase 1 additions (AUDIT §5) and where they land
| AUDIT §5 Phase 1 item | Where |
|---|---|
| Test infrastructure first; harnesses moved into `scripts/` and `e2e/` | Step 1 |
| Ids minted by producers and carried in the op; collisions rejected; `ctx.now` for time | §3.1, §5.2, §5.4 |
| Every commit validated with Zod, whatever its source | §5.2 |
| Reducer returns rejections; no-ops detected and never recorded | §5.2, §5.3 |
| Invariants normalised, including the five measured incoherences | §5.5 |
| Captions composed from applied ops through the registry | §5.9, §8.4 |
| Scheduling, focus and brief O(n log n) or better, memoised by version, < 8 ms at 150 tasks | §6.8 |
| Unknown durations propagate to successors | §6.3 |
| Agent loop stops when settled and in reduced motion; goo region limited | §9.1 |
| Contrast tokens (Q14) | §9.2 |
| Plus: raw v0 read before any hydrate; no silent wipe | §7.3 |

**Not in Phase 1** (scheduled by the AUDIT):
- Phase 3: the popover keyboard fixes and the tabs pattern.
- Phase 4: the Focus cap of 7 volumes.
- Phase 6:
  - code splitting, card blur removal and an SSR shell;
  - the caption live region and the caption timers (Q28);
  - React Compiler.

---

## 10. Test plan

### 10.1 Setup
- **Dependencies:**
  - **runtime:** `immer`, `fractional-indexing`, `nanoid` (direct, v5; today it arrives only transitively at 3.3.20);
  - **devDependencies:** `vitest`, `@vitest/coverage-v8`, `fast-check`, `happy-dom` (store and persistence tests), `@playwright/test`, `@axe-core/playwright`.
  - Exact versions are pinned at install, after checking each library's current docs.
- **Scripts:**
  - `typecheck` = `tsc --noEmit`;
  - `test` = `vitest run --project unit --project golden`;
  - `test:property`, `test:perf`;
  - `e2e` = `playwright test`;
  - `e2e:compare` = `node scripts/e2e/compare.mjs`.
- **`vitest.config.ts`:** the `@` alias maps to `src`. Projects:
  - **unit:** `src/**/__tests__/*.test.ts`, in node (store tests under happy-dom);
  - **property:** `test/property`, timeout 15 min;
  - **golden:** `test/golden`;
  - **perf:** `test/perf`, a single fork, retry 1.
- **fast-check:** `fc.configureGlobal({ seed: env FC_SEED, numRuns: Number(env FC_RUNS ?? 500), endOnFailure: true })`. A failure prints the seed and path for replay.
- **ESLint** (`eslint.config.mjs`):
  - **Purity override** for `src/lib/{domain,planning,ops,compose,migrate}/**`, `src/lib/interpret/fast/**` and `src/lib/demo/{sample,seed,library}.ts`:
    - `no-restricted-properties`: `Math.random`, `Date.now`, `performance.now`;
    - `no-restricted-syntax`: `new Date(...)` with any arguments, `.toLocaleString()`, and `localeCompare` without a fixed `Intl.Collator("en")`;
    - `no-restricted-globals`: `window`, `document`, `localStorage`, `crypto`, `fetch`;
    - `no-restricted-imports`: `react`, `zustand`, `motion/*`, `gsap`, `@/components/*`, `@/lib/store/*`.
  - **Components:** `no-restricted-imports` for `@/lib/store/form`, `@/lib/ops/reduce`, `@/lib/ops/command`, `@/lib/migrate/*` and `@/lib/demo/storage`.
  - **Check:** a deliberate `Math.random` in `src/lib/domain` must fail lint.
- **CI** (`.github/workflows/ci.yml`, on every push of `phase-*`):
  1. typecheck → lint → unit → golden;
  2. property with `FC_RUNS=10000`, sharded `--shard 1/4..4/4` with different seeds;
  3. perf with `PERF_SCALE=3`;
  4. build;
  5. e2e and visual on `macos-latest` (Chromium and WebKit, Q23).

  A nightly job runs property with `FC_RUNS=100000`.

### 10.2 Unit tests
- **Domain:**
  - schema boundaries: every limit at +1 is rejected;
  - an invalid id, 2026-02-30, an estimate of 2.7, a title of 141 characters, 501 tasks and a 1 MB document are all rejected;
  - every invariant is caught by `check*` on a hand-built broken document;
  - dates: leap day, DST borders, `todayIn` for Europe/Rome and Pacific/Auckland at 23:30 UTC, ISO week 53;
  - ids, `deriveId` stability, order keys;
  - `parseViewQuery` round-trips.
- **Transitions:** an exhaustive table over 4 statuses × progress {0, 30, 95, 100} × {status op, progress op} × `requireReview`, including the five audit paths and the milestone rules.
- **Graph:** cycle paths; bridging (a chain, a diamond, removing a root); determinism of the topological order.
- **Registry,** one spec file per family:
  - for every op: the happy path; the no-op (same reference plus `noopCaption`); every rejection code it can produce; the exact caption strings;
  - `REGISTRY` coverage: every `RejectCode` is produced at least once.
- **Planning:**
  - the calendar against a naive day-walk oracle (fast-check over random specs, closures and n);
  - the schedule, float and critical cases in §6.3;
  - risk sentences; lateness only with a confirmed start;
  - load with time off, closures and two projects;
  - lanes on the demo values (§6.5);
  - balance: exactly UI Design → Sara on the demo, the role preference, review excluded, the every-week rule, the shift fallback;
  - focus: the demo pick (83) with its why, blocked exclusion, ties, the "me" scope;
  - metrics and derived cost;
  - the memo spy test (a viewConfig change does not reschedule).
- **Compose:** brief sentence ids on the demo equal v0's, plus the new ids. The short-version rules hold.
- **Migration:** the fixtures in §10.6.
- **Store** (happy-dom):
  - submit; a no-op creates no entry;
  - undo and redo across workspace and project commits, including spawn;
  - gesture coalescing; review@90 → 100 → 90 creates no entry;
  - Q6: a tab click creates no entry, and undoing addView restores the previous tab;
  - persistence debounce and gesture skip;
  - first-load migration from each v0 fixture;
  - a corrupt `form.demo.v2` goes to `.backup` with the caption;
  - a storage spy proves the v0 keys are never written;
  - render-count tests show the hooks return stable references.

### 10.3 Property suite (`test/property`)
Generation is state-aware. The suite generates *intents* and materialises them against the current state, so shrinking works on plain numbers.
```ts
const stepArb = fc.record({
  op: fc.constantFrom(...WEIGHTED_OP_NAMES),            // task, step, dependency and proposal ops weighted × 3
  picks: fc.array(fc.nat(), { minLength: 6, maxLength: 6 }),
  text: fc.oneof(fc.string({ maxLength: 160, unit: "grapheme" }), fc.constantFrom("", "  x", "x".repeat(140), "x".repeat(141), "x".repeat(81))),
  nums: fc.array(fc.double({ min: -10, max: 400, noNaN: true }), { minLength: 4, maxLength: 4 }),
  flags: fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
});
const runArb = fc.tuple(fc.constantFrom<FixtureName>("empty", "demo", "generated60", "multiProject150"), fc.array(stepArb, { maxLength: 30 }));
// test/property/gen/<op>.ts, one per op: (step, state, mint) → raw op | null
//  picks[i] % 10 === 0 → a fresh (missing) id, otherwise an existing id of the needed kind
//  addDependency toward an ancestor 30% of the time (forced cycles); addStep on a step id 5% (nesting attempt)
//  moveTask anchors on real neighbours, sometimes a missing one; accept/discard with a stale proposal id 10%
//  ≈ 5% raw invalid payloads (wrong types, extra keys, 2.7, 2026-02-30); batches past 100 people and 200 mood items
//  updateTask cycles through every field, with status and progress interleaved; requireReview toggles
```
**Checked after every op**, with the commit runner in full-validation mode:
1. Both schemas parse; the result never comes from `invalid_result`.
2. `checkProject` and `checkWorkspace` are empty.
3. **Patch inverse:** `applyPatches(after, inverse) ≡ before` and `applyPatches(before, patches) ≡ after`.
4. **Determinism:** two runs on structured clones give deep-equal documents and patches. A third run on a JSON round-trip with shuffled record key order gives the same result (the `jsonb` guard).
5. **Purity:** inputs are deep-frozen, and the op object is frozen too.
6. A no-op returns the same reference and no patches. An idempotent op applied twice is a no-op the second time.
7. A rejection returns the same reference, a known code and a 1–140 character message.
8. An applied op yields a 1–280 character caption.
9. JSON size ≤ 1 MB.
10. **`planProject` is total:**
    - every top-level task is scheduled or unknown, with an existing cause;
    - a known task starts at or after every predecessor's finish and at or after its pin, on a working day;
    - critical ⊆ the scheduled tasks with a known float.

**End of each run:** undoing everything gives the initial state exactly, and redoing everything gives the final state. The same holds at store level, gestures included.

**Coverage meta-test** (2,000 runs): every op is applied at least 20 times, every `RejectCode` occurs, and every idempotent op shows a no-op.

**Also covered by properties:**
- **Calendar:** `workingDaysBetween(d, addWorkingDays(d, n)) === n + 1`, and `ordinal` is monotone.
- **`weeklyLoad`:** the sum over weeks equals the sum over tasks of the estimates of open, owned, scheduled tasks.
- **Balance:** a move never overloads a receiver in any week.
- **Leveling:** no owner's daily usage exceeds 1.
- **Focus:** never picks a blocked or Done task.
- **`migrateV0` is total:** arbitrary perturbations of the v0 fixtures (fields deleted, retyped or oversized; unknown enums; parentId cycles; duplicate order entries) never throw, and every result validates.

### 10.4 Golden tests (`test/golden`), against the frozen legacy copies
- **Parser corpus:** about 130 commands:
  - the 42 palette phrases;
  - the v0 §9 examples;
  - the audit false-positive table;
  - edge cases, over several fixture states.

  For each command, `applyV2(fastParse(cmd))` must equal `applyV2(lower(legacyParse(cmd)))` in canonical form (ids replaced by title-derived labels, timestamps removed). The new caption is compared with the legacy message. Every difference must be listed in `expected-diffs.ts` with its reason, or the test fails.
- **Brief:** every sentence of the demo brief (client, team, short) equals the legacy wording, apart from the listed diffs (ED-5).
- **Demo seed:** `createDemoProject` gives a project whose canonical form equals the migrated legacy `websiteTemplate()` document, apart from capacities and the stated fields.

### 10.5 Palette and parser test (`test/golden/palette.test.ts`)
The test is generated from `paletteGroups()` and every op's `parser.examples`. For each phrase:
1. build its fixture: empty, demo, demoSelected (UI Design), demoProposal, demoMood3 (three or more items, so arrange does not clarify), demoMoodShown (for "Hide the moodboard"), or demoNoTeam;
2. `fastParse` must return status "matched", confidence 1 for palette phrases, and ops or local intents that include the owning op or intent;
3. `runCommand` must reject nothing.

All 42 v0 phrases are covered.

### 10.6 Migration fixtures (`test/fixtures/v0`)
Each fixture is checked with `toMatchFileSnapshot` under `test/fixtures/v2/expected/`, with a seeded minter and `now = 2026-10-14T09:00:00Z`.

**Fixtures:**
1. the template as created (docDemo);
2. a legacy document with no views, people, mood or brief;
3. the over-limit cases: a 140-character title, 21 people, 216 mood items, a masonry of tall notes, a 0.06-wide note;
4. one per incoherent state: done@40, todo@30, review@100, active@100, todo@100, and review@90 after a slider pass;
5. a grandchild step and an orphan step;
6. a subtasks proposal and a reassign plan pending at once;
7. steps with estimates;
8. a dangling `focusId`;
9. brief edits keyed by template ids (`client:risks:t-ui`, `team:risks:load:p-marta`), plus one keyed by an unknown id;
10. a mood image with a missing blob;
11. a corrupt main key with a valid `.backup`;
12. the zustand envelope, the backup shape and a bare document;
13. `tool: null`;
14. doc60 and doc150 from the audit.

**Assertions for each fixture:**
- both v2 schemas pass and the invariants are empty;
- there are no dangling references;
- two runs are deep-equal;
- the report matches the expected salvage, repair and drop lines;
- the v0 keys are untouched (storage spy);
- `migrateV0(doc150)` takes ≤ 20 ms.

**Calendar assertion for the template:** Research 28–30 Sep, Visual Direction 1–6 Oct, UI Design 7–14 Oct, Development 15–26 Oct, with no weekend day inside any task. The `weekendsNow` notice is present.

### 10.7 Performance tests (`test/perf`)
The budgets are those in §6.8, plus:

| Function | Budget |
|---|---|
| `applyCommit(updateTask)` with full validation, 150 tasks | ≤ 2 ms |
| live gesture frame (touched validation) | ≤ 0.5 ms |
| `fastParse` at 150 tasks | ≤ 1 ms |
| `migrateV0(doc150)` | ≤ 20 ms |

The growth guard t(300) / t(150) < 3 applies to every function. The fixtures are `generated(150, { stepsPerTask: 3, predsMean: 1.5, people: 8 })`, `generated(300)`, and 10 × 150 tasks for load.

### 10.8 Playwright: `/demo` visual and motion baselines (taken before any change)
- **Builds:**
  - **A** = `main@b201af8` served at `/`;
  - **R** = the route-move commit served at `/demo`;
  - **B** = the tag `phase1-baseline-b` (route move + Q14 + agent fix), served at `/demo`;
  - **C** = the branch head.

  `scripts/e2e/compare.mjs` builds two commits in git worktrees and serves them on ports 3500 and 3501 (`next build && next start`, `NEXT_PUBLIC_FORM_E2E=1` where the code supports it). Baselines are regenerated on the same runner in the same job, so no PNGs are committed. Diff reports are uploaded as artifacts.
- **Determinism:**
  - viewports 1440×900 and 390×844 (iPhone 13 preset), in Chromium and WebKit;
  - `timezoneId: "Europe/Rome"`, `locale: "en-US"`;
  - `page.clock.install({ time: "2026-10-14T10:00:00+02:00" })`;
  - `document.fonts.ready`;
  - **settle signal:** no running finite animation in `document.getAnimations()`, 1.5 s idle, and the store phase "rest" when the handle exists;
  - stills use `reducedMotion: "reduce"`.
- **Same input on every build:** `addInitScript` seeds `form.intro.seen.v1` and a v0 `form.workspace.v1` fixture. C therefore goes through the real first-load migration. Its one-off weekends caption is asserted once, then dismissed before capture. Further states are reached by typing commands and clicking.
- **States:**
  - intro;
  - empty workspace (idle ring);
  - the composer with suggestions; the command palette;
  - tracker comfortable and compact, grid and list, Hide-done empty state, urgent highlight;
  - board;
  - timeline, plus timeline with a cleared estimate;
  - team, plus the balance preview and after accepting;
  - focus;
  - brief client, brief team, brief short;
  - moodboard with colours, notes and a collage, plus an IndexedDB fixture image;
  - a caption with Undo;
  - the subtasks proposal on UI Design and after accepting.
- **Gates:**
  - **R vs A:** 0 differing pixels in every state.
  - **B vs R:** reviewed by eye (Q14 before and after), plus axe and the contrast script.
  - **C vs B, stills:** `maxDiffPixels: 0` outside the masked regions of ED-1 to ED-10. Every masked region also gets a text assertion of its expected v2 value.
- **Motion** (`motion.spec.ts`, Chromium, no reduced motion):
  - after each trigger (create from empty, add a view, tracker → board morph, compact toggle, focus enter, team handover, caption, agent hover, press, input, processing and emit), JS timers and rAF are stepped with `page.clock.runFor`, while WAAPI and CSS animations are paused and seeked to the same elapsed time (`document.getAnimations()`);
  - frames are taken at 0, 120, 240, 480, 900 and 1,750 ms;
  - C vs B allows ≤ 0.1% differing pixels per frame (filter and blur rasterisation), outside the ED regions;
  - in builds with the handle, the test also asserts the fx kind sequence, the create phase ending within `CREATE_TOTAL_MS` ± 100 ms, the tab growing before the ink moves, and undo producing "restore".
- **Videos:** `flow.spec.ts` records the v0 §15 path (intro, create a timeline, +Team, balance preview, accept, +Board, compact and priority, select UI Design, breakdown, accept, focus, brief for the client and the team, edit a line, moodboard colours, note and collage, undo chain) on B and C, attached side by side to the PR.
- **`agent-idle.spec.ts`:** the §9.1 criteria, plus a CDP main-thread measurement at rest with doc60.
- **`a11y.spec.ts`:** axe on every state. The resolvable color-contrast nodes pass after Q14, and there are no new rule violations against A. `aria-prohibited-attr` and target size remain Phase 3 and Phase 6 work.

---

## 11. Implementation steps

**Worktree lanes.** After step 1, these lanes touch disjoint directories and run in parallel git worktrees:

| Lane | Steps | Touches |
|---|---|---|
| **E** (evidence and e2e) | 2 | `test/fixtures/v0`, `test/legacy`, `e2e/`, `scripts/e2e` |
| **UI** (v0-code changes) | 3 → 4 → 5 | `src/app`, `src/components`, `globals.css`, `next.config.ts`, `e2e/*.spec` additions |
| **D** (domain and ops) | 6 → 7 → 9 → 10a–e (parallel sub-worktrees) → 16 | `src/lib/domain`, `src/lib/ops`, `test/property` |
| **P** (planning) | 8 (after 6) → 11 → 12 → 13 | `src/lib/planning`, `src/lib/compose`, `test/perf/planning` |
| **M** (migration) | 14 | `src/lib/migrate`, `src/lib/demo/sample.ts`, migration fixtures |
| **F** (parser) | 15 | `src/lib/interpret/fast`, `src/lib/demo/{seed,library}.ts`, `test/golden` |

The only files that several lanes would edit are created once by an earlier step and never edited again by a parallel lane:
- `package.json`, `package-lock.json`, `eslint.config.mjs`, `vitest.config.ts` and `ci.yml` (step 1);
- `ops/registry/index.ts` and `test/property/gen/index.ts` (step 9, with stubs for all 66 ops).

Steps 17–20 are sequential on the phase branch.

| # | Step | Lane / depends on | Files | Done when |
|---|---|---|---|---|
| 0 | Record the decisions and save this plan | – | `docs/DECISIONS.md` (§13 entries), `docs/PHASE-1-PLAN.md` | Entries reviewed; no code yet |
| 1 | Tooling and test infrastructure | blocking | `package.json` (all deps for the phase), `vitest.config.ts`, `eslint.config.mjs` (purity and boundary rules), `.github/workflows/ci.yml`, `scripts/audit/**` (moved from `docs/audit/harness`, relative paths), `test/fixtures/v0/{docDemo,doc60,doc150}.json`, `test/legacy/v0/**` (frozen copies of the v0 lib and `suggestions.ts`), `test/legacy/lower.ts` stub, `src/lib/phase.ts` | `npm test` runs a smoke test green; typecheck, lint and CI are green; a deliberate `Math.random` in `src/lib/domain` fails lint; the legacy copies type-check |
| 2 | Freeze the v0 evidence | E, after 1 | `scripts/fixtures/gen-v0.mts` (jiti over `test/legacy/v0`), `test/fixtures/v0/*.json` (all §10.6 cases), `e2e/{playwright.config,states,settle,frames}.ts`, `e2e/{visual,motion,flow}.spec.ts`, `scripts/e2e/compare.mjs` | Fixtures committed with one documented line each. Baseline A captured for every state, viewport and engine; clock-stepped frames and the v0 §15 video recorded; the idle probe records today's 3,000 mutations per second. |
| 3 | Route move only | UI, after 2 | `src/app/demo/page.tsx`, `src/app/page.tsx` deleted, `next.config.ts` `redirects()` (read the Next 16 docs first, per AGENTS.md), `e2e/route.spec.ts` | `GET /` answers 307 → `/demo`; R vs A shows 0 differing pixels in every state; build green |
| 4 | Q14 contrast tokens on the v0 code | UI, after 3 | `globals.css` (C1); `TaskCard`, `BoardView`, `TeamView`, `TimelineView`, `parts`, `blocks`, `CommandSheet`, `Moodboard`, `BriefView`, `ColorPicker` (C2–C4); `e2e/a11y.spec.ts` | Contrast script and axe criteria in §9.2; before and after shots of every view in the PR |
| 5 | Agent loop stop, goo region, static reduced motion, on the v0 code | UI, after 4 | `components/agent/{loop.ts (new), Fluid.tsx, AgentLayer.tsx}`, `e2e/agent-idle.spec.ts` | §9.1 criteria; frames match the tokens build; tag `phase1-baseline-b` (B) |
| 6 | Domain primitives | D, after 1 | `domain/{ids,dates,money,limits,order,labels,views,colours}.ts`, `schema/{primitives,ids}.ts` + tests | Ids, dates (W53, DST, leap), money and order keys tested |
| 7 | Schema v2 and invariants | D, after 6 | `domain/schema/{workspace,project,proposal,template,local,commit,demo,index}.ts`, `domain/invariants/{transitions,graph,check}.ts`, `domain/{starters,mood-geometry}.ts`, `test/fixtures/v2/build.ts` | The builders produce valid empty, demo, 60-task and 150-task documents; every §3.8 invariant is caught; the transition table is exhaustive; `ProjectDraftSchema` imports cleanly (pick works) |
| 8 | Working-day calendar | P, after 6 (parallel with 7) | `planning/calendar.ts` + `__tests__/calendar.test.ts`, the calendar property | §6.1 cases; 10,000 `addWorkingDays` calls in < 5 ms; the oracle property holds over 10,000 runs |
| 9 | Ops core and the first five ops | D, after 7 | `ops/registry/{_contract,_helpers,index}.ts`; **stubs for all 66 ops**; `ops/{reduce,command,caption,caption-env,build,local-intents,queries,notices,palette,transport}.ts`; ops addTask, updateTask, removeTask, addDependency, setView; `test/property/{arbitraries,materialise}.ts` with `gen/*.ts` stubs and the index | Properties 1–9 pass 1,000 runs on the five ops; a no-op keeps the reference; undoing a whole sequence restores the start; bridging and cycle captions are exact |
| 10 | The remaining 61 ops, in five parallel sub-worktrees | D, after 9 | **10a** tasks, steps, dependencies, pins, assignment, links, members, updateProject, rebalanceOrder · **10b** views, blocks, setFocus, brief · **10c** moodboard (with mood-geometry) · **10d** workspace (people, time off, closures, templates, updateWorkspace) and the index ops with spawn (create, duplicate via deriveId, archive, restore, delete) · **10e** proposals with partial accept. Each sub-worktree edits only its own op files, `__tests__/<family>.test.ts` and `test/property/gen/<op>.ts` | Completeness test green for all 66; every op has its happy, no-op and rejection tests with exact captions; the 35 v0 names are covered |
| 11 | Planning: schedule, relative, risk, metrics, format, memo, index | P, after 7 and 8 (parallel with 9–10) | `planning/{schedule,relative,risk,metrics,format,memo,index}.ts` + tests, `test/perf/planning.perf.test.ts` | §6.3 cases (demo chain 28–30 Sep, 1–6 Oct, 7–14 Oct, 15–26 Oct); no lateness on an unconfirmed start; planProject ≤ 8 ms cold and ≤ 0.05 ms warm; the memo spy passes |
| 12 | Planning: load, lanes, balance, level, focus | P, after 11 | `planning/{load,lanes,balance,level,focus,focus.weights}.ts` + tests + perf | Demo lanes 10/6 +4, 0/4, 8/15; exactly one balance move, UI Design → Sara; focus UI Design 83 with "Urgent and on the critical path."; Development blocked; weeklyLoad 10 × 150 ≤ 15 ms |
| 13 | Brief composer v2 | P, after 12 | `compose/{brief,brief-export}.ts`, `test/golden/brief.golden.test.ts`, `test/perf/compose.perf.test.ts` | Sentence ids equal v0's plus the new ids; text equals legacy apart from ED-5; ≤ 4 ms at 150 tasks |
| 14 | Migration v0 → v2 | M, after 9 (parallel with 10–13) | `migrate/{index.ts, v0/schema.ts, v0/read.ts, v0/idmap.ts, v0/to-v2.ts}`, `demo/sample.ts`, `test/fixtures/v2/expected/*`, `test/property/migrate.property.test.ts` | Every §10.6 snapshot matches; schemas and invariants pass; deterministic; the template calendar assertion passes; totality property green; storage spy proves the v0 keys are untouched; ≤ 20 ms on doc150 |
| 15 | Demo seed, library and the fast parser port | F, after 10, 12 and 14 | `demo/{seed,library}.ts`, `interpret/fast/*.ts`, `test/legacy/lower.ts` (complete), `test/golden/{corpus,parser.golden.test,palette.test,expected-diffs}.ts` | Palette test green for all 42 phrases and every parser example; the about-130-command corpus matches legacy plus lowering apart from the reviewed diffs; the breakdown caption is honest; `fastParse` ≤ 1 ms |
| 16 | Full property suite and coverage | D, after 10 (parallel with 11–15) | `test/property/{reducer,planning,coverage}.property.test.ts` | 10,000 runs green in CI (sharded) with all checks, including the shuffled-key determinism; coverage meta-test green |
| 17 | Store engine, hooks, actions, persistence | after 13, 14, 15, 16 | `store/{engine,form,hooks,actions,fx,persist,view-url,today}.ts`, `demo/storage.ts`, `lib/assets.ts` (aliases), store tests | §10.2 store criteria; the store property passes (undo all, redo all, gestures); `next build` passes with the v0 components still on the old lib (the new store is not yet mounted) |
| 18 | Component switchover, v0 lib removal, Claude removal | after 5 and 17; areas a–g in parallel sub-worktrees once `hooks.ts` is merged | **(a)** FormApp, Chrome, Intro, Workspace, registry, reveal and the agent files · **(b)** TaskCard, parts, CardsView, BoardView, EmptyFilter · **(c)** TimelineView · **(d)** TeamView · **(e)** FocusView · **(f)** blocks, BriefView · **(g)** Moodboard, ColorPicker. Then, on the branch: delete `src/lib/{schema,ops,seed,selectors,focus,team,views,brief,mood,store}.ts`, `src/lib/interpret/{demo,library,index,claude.server}.ts` and `src/app/api/interpret/route.ts`; remove `@anthropic-ai/sdk` and `server-only`; update `.env.example` and `README.md` | Typecheck and lint green with the boundary rules; `rg` finds no reference to the deleted modules; Vitest green; the v0 §15 path runs end to end in Playwright on C |
| 19 | Verification gate | after 18 | `e2e/*.spec.ts`, `e2e/expected-diffs.md`, `scripts/audit/runtime.mjs` | C vs B: 0 differing pixels outside ED-1 to ED-10 at both viewports in both engines; motion frames ≤ 0.1%; videos attached; agent idle 0 mutations per second; axe criteria met; in-browser planning, focus and brief at 150 tasks < 8 ms at 4× CPU; bundle gzip delta of `/demo` measured and reported |
| 20 | Report and stop | after 19 | `docs/AUDIT.md` §5 (Phase 1 status), `docs/DECISIONS.md` (outcomes), `docs/FORM-v0.md` note "/demo runs on v2", PR text | CI all green on `phase-1-domain`. The report lists the expected diffs with their reasons, the decisions, measured performance (planning, focus and brief at 150 tasks; property run times) and the bundle delta. The branch is pushed, the GitHub compare URL is given, and work stops for Nicola's review. |

---

## 12. Risks and mitigations

1. **Visual and motion fidelity of the switchover.** About 25 files and about 150 `useForm` call sites change, and layoutIds and keys drive the morphs.
   - The UI lane lands on the v0 code before the switchover, so B isolates the engine port.
   - The hooks mirror the v0 call sites; layoutIds and the view and block ids are unchanged.
   - Proposal step ids become step ids, so morphs keep their identity.
   - Gate: 0 pixels outside the allowlist, clock-stepped frames and side-by-side videos. Step 18 is a commit series that can be reverted area by area.
2. **Engine-driven text reads as a regression.** Timeline dates, Team figures, the Focus why, brief lines and some captions change by design.
   - Each one is listed in ED-1 to ED-10 with its expected value, its reason and a text assertion, and the matching decision is in DECISIONS.md.
3. **The Phase 1 Team lane is an aggregate.** Over and free are summed per week across a window, so in free play the hatch can start before the capacity line when a person has slack in one week and overload in another.
   - It is honest (it never hides overload), and the sample capacities are verified on the scripted path.
   - Captions and the brief read the same lane numbers, so the screen never shows two figures. Phase 4 replaces the lane with the weekly grid.
4. **The sample capacities (2/4/5 a week) can look contrived.** They are labelled sample data. Changing them needs no code change.
5. **Q6 undo semantics change.** Tab switches are no longer undo steps, and pure "show X" commands lose their Undo.
   - History entries restore `localBefore`, so undoing a view addition still returns to the previous tab.
   - Recorded in DECISIONS and in the PR.
6. **The parser port regresses matching.** Mitigated by the golden corpus against the frozen legacy parser plus lowering, every difference reviewed, and a palette test generated from the registry.
7. **Determinism leaks:**
   - `jsonb` key order: order keys, sorted iteration, and the shuffled-key property;
   - locale formatting: fixed formatters and lint;
   - a stray `Date` or `Math.random`: lint plus the double-apply property;
   - float accumulation order: sorted iteration.
8. **Zod traps.** `.pick()` or `.partial()` on objects with object-level refinements throws in 4.6.5 (verified). Document schemas therefore carry no object-level refinement; every cross-field rule lives in `check.ts`. A unit test imports `ProjectDraftSchema`.
9. **Cost of full validation per op, Immer and autofreeze at 300–500 tasks.**
   - Records for tasks and mood items; touched-only validation on live frames; stage memos; perf budgets with growth guards.
   - Fallback if a budget fails: validate the patch-touched entities plus the graph invariants only (measured before switching).
10. **Autofreeze turns latent component mutations into runtime errors** (in-place sorts, mutated props). Before step 18, grep for mutating array methods on store data, and run every view in e2e.
11. **Property suite runtime and flakiness** (10,000 runs of up to 30 ops). Sharding, printed seeds and paths, every failure added as a fixed regression case, and the 100,000-run sweep moved to a nightly job.
12. **Visual-test flakiness.** Same-runner rebuilds of both commits, a frozen clock and time zone, fonts awaited, reduced-motion stills, the settle signal, and per-frame tolerance only for animation frames. WebKit gets stills and videos; frame stepping runs on Chromium.
13. **Storage safety:**
    - the v0 keys are never written (storage spy);
    - an unreadable v2 save is backed up, never wiped;
    - asset aliases avoid blob copies, with the fallback lookup tested;
    - deleted demo projects are compacted only on save, after the session's undo history has gone.
14. **Phase 2 coupling:**
    - `createProject` and `duplicateProject` spawn documents;
    - workspace ops apply first;
    - the archivePerson caption counts tasks across projects.

    `CommandResult` mirrors §10.2 commits with a shared `groupId`, `pathsTouched` is defined, and no op mutates two documents. The Phase 2 design reviews `command.ts` before building `/api/docs/*/commits`.
15. **Fractional keys** grow under repeated inserts at one spot. The explicit `rebalanceOrder` op at 48 characters is visible in patches and history. The property generator inserts adversarially.
16. **Scope (66 ops plus planning, migration and the parser).** Op stubs and family sub-worktrees allow parallel work. Exemptions carry `until`, so nothing is skipped silently. Done criteria are defined per step.
17. **Bundle growth** on a route already 71% over budget (immer, the registry schemas, planning). It is measured and reported in step 19; code splitting stays in Phase 6, and the schemas stay tree-shakable.
18. **Next 16 specifics** (redirects with `cacheComponents`, the page move): read `node_modules/next/dist/docs` first (verified: `permanent: false` gives 307, and redirects run before the filesystem), and smoke-test both routes in e2e.
19. **Removing the Claude path** drops an opt-in capability that never ran. It is stated in the report, and Phase 5 rebuilds it on the registry's transport specs.

---

## 13. New `docs/DECISIONS.md` entries

Each entry follows the existing format: date 2026-10-14, context, choice, rejected alternative.

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