import type { Draft } from "immer";
import type { z } from "zod";
import type { Minter } from "@/lib/domain/ids";
import { CAPTION_PART } from "@/lib/domain/limits";
import type { PersonId, ProjectId, TaskId } from "@/lib/domain/schema/ids";
import type { Timestamp, ViewKind } from "@/lib/domain/schema/primitives";
import type { ProjectDoc } from "@/lib/domain/schema/project";
import type { WorkspaceDoc } from "@/lib/domain/schema/workspace";
import type { TransportTool } from "@/lib/ops/transport";

/**
 * The operation contract (plan §4.1). Every registry op is one file in `registry/workspace/` or
 * `registry/project/` that default-exports one `defineOp(…)`. The reducer, the command runner,
 * the caption composer, the palette, the transport list and the completeness test read only
 * this contract, so adding an op never touches them.
 */

/* ------------------------------------------------------------------
   Documents and the reducer context
   ------------------------------------------------------------------ */

export type Scope = "workspace" | "project";
export type DocOf<S extends Scope> = S extends "workspace" ? WorkspaceDoc : ProjectDoc;
export type AnyDoc = WorkspaceDoc | ProjectDoc;

/** What an op recipe may read besides its own document. Never a clock or a random source. */
export interface ReduceCtx {
  /** `commit.createdAt`: the only time source of a reducer */
  readonly now: Timestamp;
  readonly actorId: string | null;
  readonly source: "direct" | "agent" | "system";
  /** For project ops: reference checks only (the owner exists and isn't archived), never writes */
  readonly workspace: WorkspaceDoc;
  /** Another project's document (duplicateProject) */
  readonly readProject: (id: ProjectId) => ProjectDoc | null;
  /** Tasks and steps a person owns across every project (deletePerson, Q8) */
  readonly ownership: (id: PersonId) => number;
}

/* ------------------------------------------------------------------
   Rejections
   ------------------------------------------------------------------ */

/** Every way an op can be refused. The completeness test proves each one is produced by a unit test. */
export const REJECT_CODES = [
  "unknown_op",
  "invalid_payload",
  "wrong_scope",
  "not_found",
  "duplicate_id",
  "cycle",
  "self_dependency",
  "invalid_reference",
  "archived",
  "limit",
  "last_view",
  "protected_block",
  "stale_proposal",
  "owns_tasks",
  "invalid_state",
  "no_project",
  "invalid_result",
] as const;

export type RejectCode = (typeof REJECT_CODES)[number];

export interface Rejection {
  code: RejectCode;
  /** English, at most 140 characters, ready to follow "Couldn't apply that: " */
  message: string;
  meta?: Record<string, string>;
}

/**
 * Cuts a text to `max` characters (code points) with an ellipsis, so a caption part or a
 * rejection message never runs past its limit whatever the titles inside it.
 */
export function fitText(text: string, max: number = CAPTION_PART): string {
  if (text.length <= max) return text;
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

/** A rejection with a message of at most 140 characters */
export function reject(code: RejectCode, message: string, meta?: Record<string, string>): Rejection {
  return meta ? { code, message: fitText(message), meta } : { code, message: fitText(message) };
}

/** Whether a recipe's or helper's result is a rejection (domain transitions return the same shape) */
export function isRejection(value: unknown): value is Rejection {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Rejection).code === "string" &&
    typeof (value as Rejection).message === "string" &&
    !("id" in value)
  );
}

/* ------------------------------------------------------------------
   Captions
   ------------------------------------------------------------------ */

export interface CaptionPart {
  /** At most 140 characters */
  text: string;
  /** A later part with the same key replaces this one in place (plan §5.9) */
  key?: string;
  tone?: "done" | "proposal";
}

/**
 * What captions read of the plan. Planning (plan §6.8, steps 11–12) builds the real `ProjectPlan`,
 * `LaneLoad` and `FocusResult`; these are the structural subsets captions need, so the ops core
 * doesn't wait on the planning lane and the real types satisfy them when they are wired in
 * (`caption-env.ts`, `CaptionPlanning`).
 */
export interface CaptionPlan {
  readonly schedule: { readonly timings: ReadonlyMap<TaskId, { readonly kind: "scheduled" | "unknown" }> };
}
export interface CaptionLane {
  readonly personId: PersonId | null;
  readonly days: number;
  readonly capacity: number | null;
  readonly over: number | null;
  readonly free: number | null;
}
export interface CaptionFocus {
  readonly pick: {
    readonly taskId: TaskId;
    readonly chosenBy: "form" | "you";
    readonly reasons: readonly { readonly text: string }[];
  } | null;
}

/** Everything a caption may ask about the AFTER state; lazy and memoised (`caption-env.ts`) */
export interface CaptionEnv {
  viewLabel(v: ViewKind): string;
  /** The title in the after state, else the before state, else "that task" */
  taskTitle(id: TaskId): string;
  personName(id: PersonId): string;
  /** The active project after the command, or null */
  project(): ProjectDoc | null;
  workspace(): WorkspaceDoc;
  plan(): CaptionPlan | null;
  lanes(): readonly CaptionLane[];
  focus(): CaptionFocus | null;
  overloads(): { personId: PersonId; name: string; over: number }[];
  /** Open tasks the person owns, across projects */
  openTasksOwnedBy(id: PersonId): number;
}

export interface CaptionInput<S extends Scope, P> {
  op: P;
  before: DocOf<S>;
  after: DocOf<S>;
  env: CaptionEnv;
}

/* ------------------------------------------------------------------
   Fixtures, parser examples, palette entries and transport
   ------------------------------------------------------------------ */

/** The named fixture states samples, parser examples and palette phrases run on (`test/fixtures/v2/named.ts`) */
export const FIXTURE_NAMES = [
  "empty",
  "demo",
  "demoSelected",
  "demoProposal",
  "demoPlan",
  "demoMood3",
  "demoMoodShown",
  "demoNoTeam",
  "demoUnestimated",
  "generated60",
  "demoExtras",
] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];

/** One fixture state, with lookups that throw on a missing name so a sample never names nothing */
export interface FixtureDocs {
  readonly name: FixtureName;
  readonly workspace: WorkspaceDoc;
  /** The active project, or null in "empty" */
  readonly project: ProjectDoc | null;
  readonly projects: Readonly<Record<ProjectId, ProjectDoc>>;
  /** The local selection ("demoSelected": UI Design) */
  readonly selectedTaskId: TaskId | null;
  task(title: string): TaskId;
  person(name: string): PersonId;
}

/** The parser files of `interpret/fast` (plan §2, §8.4) */
export type ParserFamily = "control" | "view" | "brief" | "create" | "mood" | "team" | "task" | "layout";

export interface ParserExample {
  say: string;
  fixture: FixtureName;
  /** The selected task's title */
  selected?: string;
}

/** Palette groups in the v0 CAPABILITIES order */
export const PALETTE_GROUPS = ["Create", "Decide", "Add a view", "Layout", "Brief", "Team", "Moodboard", "Selected task"] as const;
export type PaletteGroup = (typeof PALETTE_GROUPS)[number];
export type PaletteNeeds = "none" | "project" | "selection";
export type Surface = "demo" | "app";

export interface PaletteEntry {
  group: PaletteGroup;
  /** At most 80 characters, unique across the registry and the local intents */
  phrase: string;
  /** Order inside the group (v0 order × 10) */
  rank: number;
  needs: PaletteNeeds;
  fixture: FixtureName;
  surfaces: readonly Surface[];
}

/** The §9.4 tool that carries an op; Phase 5 adds the converters */
export type TransportSpec = { tool: TransportTool; field?: string; action?: string };

/** A reasoned gap: no parser example, palette phrase or transport tool, possibly until a phase */
export interface Exempt {
  /** At least 10 characters */
  exempt: string;
  /** The phase that must remove it; the completeness test fails once FORM_PHASE reaches it */
  until?: number;
}

export function isExempt(value: unknown): value is Exempt {
  return typeof value === "object" && value !== null && typeof (value as Exempt).exempt === "string";
}

/* ------------------------------------------------------------------
   v0 names and stubs
   ------------------------------------------------------------------ */

/** The 35 v0 op names (frozen in `test/legacy/v0/lib/schema.ts`); `deprecates` lists name them */
export const V0_OP_NAMES = [
  "createProject",
  "renameTool",
  "setRepresentation",
  "removeView",
  "setView",
  "setFields",
  "updateTask",
  "addTask",
  "removeTask",
  "moveTask",
  "proposeSubtasks",
  "acceptProposal",
  "discardProposal",
  "addBlock",
  "removeBlock",
  "setStartDate",
  "addMoodItems",
  "updateMoodItem",
  "removeMoodItem",
  "arrangeMood",
  "clearMood",
  "addPerson",
  "updatePerson",
  "removePerson",
  "assignTask",
  "addSampleTeam",
  "proposeReassign",
  "acceptReassign",
  "discardReassign",
  "editBriefLine",
  "resetBriefLine",
  "addBriefLine",
  "updateBriefLine",
  "removeBriefLine",
  "resetBrief",
] as const;
export type V0OpName = (typeof V0_OP_NAMES)[number];

/** The step 10 sub-worktrees that fill the stubs (plan §11; `registry/README.md`) */
export type StubFamily = "10a" | "10b" | "10c" | "10d" | "10e";

/**
 * Step 9's mark for an op file that was still a stub. Step 16 removed the last one: the
 * completeness test now fails on any op that carries it. The type stays only so branches cut
 * before step 16 still type-check when they merge; it can go once Phase 1 is merged.
 */
export interface StubMark {
  family: StubFamily;
  until: number;
}

/* ------------------------------------------------------------------
   The op definition
   ------------------------------------------------------------------ */

/** What `sample` returns: the op name checked by TS, the rest by the schema at test time */
export type SamplePayload<N extends string> = { op: N; [key: string]: unknown };

export interface OpDef<N extends string, S extends Scope, P extends { op: N }> {
  /** Equals the file name */
  name: N;
  /** Equals the folder */
  scope: S;
  /** Strict object(s); field ops are a discriminated union on "field" */
  schema: z.ZodType<P>;
  /**
   * The Immer recipe: pure, total over schema-valid payloads, never mints ids, never reads a
   * clock, never imports another op, and writes only through the helpers so a same-value write
   * produces no patch. Returns a Rejection to refuse; any thrown error is a bug.
   */
  reduce(draft: Draft<DocOf<S>>, op: P, ctx: ReduceCtx): Rejection | void;
  /** createProject and duplicateProject only (Q9): the project document the command creates */
  spawn?(op: P, ctx: ReduceCtx): ProjectDoc;
  /** Pure English from before and after, never from the command text */
  caption(i: CaptionInput<S, P>): CaptionPart | CaptionPart[] | null;
  /** "Research is already done" */
  noopCaption(i: Omit<CaptionInput<S, P>, "after">): string | null;
  undoable: boolean;
  /** "hide" keeps it out of Activity (viewConfig, Q6) */
  activity: "show" | "hide";
  /** Applying the same payload twice makes the second a no-op */
  idempotent: boolean;
  /** v0 op names folded into this op */
  deprecates: readonly V0OpName[];
  parser: { family: ParserFamily; examples: readonly ParserExample[] } | Exempt;
  palette: readonly PaletteEntry[] | Exempt;
  transport: TransportSpec | Exempt;
  /**
   * A payload that applies on `sampleOn` (default "demo") with outcome "applied". Typed loosely on
   * purpose: while TS infers P from `schema` it widens the literals a context-sensitive member
   * returns ("status" → string), so the completeness test parses the sample with the schema instead.
   */
  sample(fx: FixtureDocs, mint: Minter): SamplePayload<N>;
  sampleOn?: FixtureName;
  stub?: StubMark;
}

export const defineOp = <const N extends string, S extends Scope, P extends { op: N }>(d: OpDef<N, S, P>) => d;

/** Any registry entry, as the reducer, the runner and the tests hold them. Payloads are parsed by the def's own schema first. */
export type AnyOpDef = OpDef<string, Scope, { op: string }>;
