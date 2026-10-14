import { z } from "zod";
import { HEX_COLOUR } from "@/lib/domain/colours";
import {
  BRIEF_BASIS,
  BRIEF_EDIT_KEY,
  BRIEF_LINES_MAX,
  BRIEF_SENT_MAX,
  BRIEF_TEXT_MAX,
  CLIENT_NAME,
  COLUMNS_MAX,
  DEPS_MAX,
  EMAIL_LENGTH,
  ESTIMATE_MAX_DAYS,
  FILTER_OWNERS_MAX,
  LINKS_MAX,
  MEMBERS_MAX,
  MOOD_BOUNDS,
  MOOD_TEXT,
  PROJECT_GOAL,
  PROJECT_TITLE,
  STEP_TITLE,
  STEPS_MAX,
  TAGS_MAX,
  TASK_DESCRIPTION,
  TASK_TITLE,
  VIEWS_MAX,
} from "@/lib/domain/limits";
import {
  AssetId,
  BriefLineId,
  ClosureId,
  MoodItemId,
  PersonId,
  ProjectId,
  SnapshotId,
  StepId,
  TaskId,
  WorkspaceId,
} from "@/lib/domain/schema/ids";
import {
  Allocation,
  Audience,
  BirthView,
  BLOCK_ORDER,
  BlockKind,
  BriefSection,
  Cents,
  Currency,
  halfDays,
  IsoDate,
  Line,
  LinkSchema,
  MoodKind,
  OrderKey,
  Priority,
  ProjectKind,
  ProjectStatus,
  SortKey,
  Status,
  Tag,
  TaskKind,
  Text,
  Timestamp,
  ViewKind,
  WorkingDays,
} from "@/lib/domain/schema/primitives";
import { ProposalSchema } from "@/lib/domain/schema/proposal";
import { ClosureSchema } from "@/lib/domain/schema/workspace";

/**
 * The project document (plan §1.2, §3.4). Strict, with no defaults, transforms or object-level
 * refinements, so parse equals validate and `.pick()` works (plan §12 item 8: zod 4 throws on
 * `.pick()` over object-level refinements). Every cross-field rule lives in `invariants/check.ts`.
 */

/** One level of steps; array order is step order */
export const StepSchema = z
  .object({
    id: StepId,
    title: Line(STEP_TITLE),
    done: z.boolean(),
    ownerId: PersonId.nullable(),
    /** Q1: used only inside the parent's window */
    estimateDays: halfDays(0.5, ESTIMATE_MAX_DAYS).nullable(),
  })
  .strict();

export const TaskSchema = z
  .object({
    id: TaskId,
    title: Line(TASK_TITLE),
    kind: TaskKind,
    description: z.string().max(TASK_DESCRIPTION).nullable(),
    status: Status,
    priority: Priority,
    progress: z.int().min(0).max(100),
    /** Working days at 100%. A task has null (unknown) or at least 0.5; a milestone has 0. */
    estimateDays: halfDays(0, ESTIMATE_MAX_DAYS).nullable(),
    /** Duration = ceil(estimate / allocation) working days */
    allocation: Allocation,
    pinnedStart: IsoDate.nullable(),
    dueDate: IsoDate.nullable(),
    /** Finish-to-start; existing, unique, no self, acyclic (invariants) */
    dependsOn: z.array(TaskId).max(DEPS_MAX),
    /** Resolved against the workspace at read time (Q7) */
    ownerId: PersonId.nullable(),
    /** Manual cost only, in project.currency */
    costCents: Cents.nullable(),
    tags: z.array(Tag).max(TAGS_MAX),
    links: z.array(LinkSchema).max(LINKS_MAX),
    emphasis: z.boolean(),
    steps: z.array(StepSchema).max(STEPS_MAX),
    /** Workflow order; unique per project */
    order: OrderKey,
    createdAt: Timestamp,
    completedAt: Timestamp.nullable(),
  })
  .strict();

export const DueFilter = z.enum(["any", "thisWeek", "late"]);

/** Q6: commits and undo, hidden from Activity */
export const ViewConfigSchema = z
  .object({
    density: z.enum(["comfortable", "compact"]),
    layout: z.enum(["grid", "list"]),
    /** null = automatic */
    columns: z.int().min(1).max(COLUMNS_MAX).nullable(),
    sort: SortKey,
    hideDone: z.boolean(),
    highlightUrgent: z.boolean(),
    fields: z
      .object({
        priority: z.boolean(),
        estimate: z.boolean(),
        progress: z.boolean(),
        owner: z.boolean(),
        due: z.boolean(),
        cost: z.boolean(),
      })
      .strict(),
    filters: z
      .object({
        ownerIds: z.array(z.union([PersonId, z.literal("none")])).max(FILTER_OWNERS_MAX),
        statuses: z.array(Status).max(Status.options.length),
        priorities: z.array(Priority).max(Priority.options.length),
        tags: z.array(Tag).max(TAGS_MAX),
        due: DueFilter,
      })
      .strict(),
    focusPin: TaskId.nullable(),
    brief: z.object({ audience: Audience, short: z.boolean() }).strict(),
  })
  .strict();

const bound = (b: { min: number; max: number }) => z.number().min(b.min).max(b.max);

/** Geometry in board-width units (1 = the board's width); `x + w ≤ 1` is an invariant */
export const MoodItemSchema = z
  .object({
    id: MoodItemId,
    kind: MoodKind,
    x: bound(MOOD_BOUNDS.x),
    y: bound(MOOD_BOUNDS.y),
    w: bound(MOOD_BOUNDS.w),
    h: bound(MOOD_BOUNDS.h),
    /** Rotation in degrees (collage) */
    r: bound(MOOD_BOUNDS.r),
    /** Stacking: "bring to front" is a new top key */
    z: OrderKey,
    /** image ⇒ set (invariant) */
    assetId: AssetId.nullable(),
    /** color ⇒ set (invariant); lowercase "#rrggbb" */
    hex: z.string().regex(HEX_COLOUR).nullable(),
    /** note ⇒ set (invariant); a colour's name otherwise */
    text: z.string().max(MOOD_TEXT).nullable(),
  })
  .strict();

/** "<audience>:<sentence id>", for example "client:risks:tsk_…" */
export const BriefEditKey = z
  .string()
  .max(BRIEF_EDIT_KEY)
  .regex(/^(client|team):[a-z]+(:[0-9a-z_]+)*$/);

export const BriefEditSchema = z
  .object({
    /** "" hides the sentence */
    text: z.string().max(BRIEF_TEXT_MAX),
    /** The composed wording it replaced, so a change in FORM's version shows */
    basis: z.string().max(BRIEF_BASIS),
  })
  .strict();

export const BriefLineSchema = z
  .object({ id: BriefLineId, audience: Audience, section: BriefSection, text: Text(BRIEF_TEXT_MAX) })
  .strict();

/** A sent brief: its body is a server row (Phase 4) */
export const SentBriefSchema = z.object({ snapshotId: SnapshotId, audience: Audience, sentAt: Timestamp }).strict();

export const BriefStateSchema = z
  .object({
    edits: z.record(BriefEditKey, BriefEditSchema),
    lines: z.array(BriefLineSchema).max(BRIEF_LINES_MAX),
    sent: z.array(SentBriefSchema).max(BRIEF_SENT_MAX),
    /** Share links are server rows (Phase 4) */
    sharing: z.object({ showBudgetToClient: z.boolean() }).strict(),
  })
  .strict();

export const ClientSchema = z
  .object({
    name: Line(CLIENT_NAME).nullable(),
    contactName: Line(CLIENT_NAME).nullable(),
    contactEmail: z.email().max(EMAIL_LENGTH).nullable(),
  })
  .strict();

/** Replaces the workspace calendar field by field; null fields inherit */
export const CalendarOverrideSchema = z
  .object({
    workingDays: WorkingDays.nullable(),
    closures: z.record(ClosureId, ClosureSchema).nullable(),
  })
  .strict();

export const ProjectDocSchema = z
  .object({
    schemaVersion: z.literal(2),
    docType: z.literal("project"),
    id: ProjectId,
    workspaceId: WorkspaceId,
    title: Line(PROJECT_TITLE),
    client: ClientSchema.nullable(),
    kind: ProjectKind,
    goal: Text(PROJECT_GOAL).nullable(),
    status: ProjectStatus,
    startDate: IsoDate.nullable(),
    /** Unconfirmed → relative dates in /app (FORM-v1 §7.2) */
    startConfirmed: z.boolean(),
    deadline: IsoDate.nullable(),
    deadlineKind: z.enum(["hard", "soft"]),
    currency: Currency,
    budgetCents: Cents.nullable(),
    leadId: PersonId.nullable(),
    memberIds: z.array(PersonId).max(MEMBERS_MAX),
    requireReview: z.boolean(),
    /** A quick "Add task" depends on the last task (FORM-v1 §6.4) */
    autoChain: z.boolean(),
    calendarOverride: CalendarOverrideSchema.nullable(),
    links: z.array(LinkSchema).max(LINKS_MAX),
    tags: z.array(Tag).max(TAGS_MAX),
    /** Tab order = creation order */
    views: z.array(ViewKind).min(1).max(VIEWS_MAX),
    /** In BLOCK_ORDER; header and collection always present (invariants) */
    blocks: z.array(BlockKind).min(2).max(BLOCK_ORDER.length),
    viewConfig: ViewConfigSchema,
    tasks: z.record(TaskId, TaskSchema),
    moodboard: z.object({ items: z.record(MoodItemId, MoodItemSchema) }).strict(),
    brief: BriefStateSchema,
    proposal: ProposalSchema.nullable(),
    createdAt: Timestamp,
  })
  .strict();

/**
 * What the project form and `createProject` carry (plan §3.5). `pick` works because
 * ProjectDocSchema has no object-level refinement; a unit test imports this module to prove it.
 */
export const ProjectDraftSchema = ProjectDocSchema.pick({
  title: true,
  client: true,
  kind: true,
  goal: true,
  startDate: true,
  startConfirmed: true,
  deadline: true,
  deadlineKind: true,
  currency: true,
  budgetCents: true,
  leadId: true,
  memberIds: true,
  requireReview: true,
  autoChain: true,
  calendarOverride: true,
  links: true,
  tags: true,
})
  .extend({ startAs: BirthView })
  .strict();

export type Step = z.infer<typeof StepSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type DueFilter = z.infer<typeof DueFilter>;
export type ViewConfig = z.infer<typeof ViewConfigSchema>;
export type MoodItem = z.infer<typeof MoodItemSchema>;
export type BriefEditKey = z.infer<typeof BriefEditKey>;
export type BriefEdit = z.infer<typeof BriefEditSchema>;
export type BriefLine = z.infer<typeof BriefLineSchema>;
export type SentBrief = z.infer<typeof SentBriefSchema>;
export type BriefState = z.infer<typeof BriefStateSchema>;
export type Client = z.infer<typeof ClientSchema>;
export type CalendarOverride = z.infer<typeof CalendarOverrideSchema>;
export type ProjectDoc = z.infer<typeof ProjectDocSchema>;
export type ProjectDraft = z.infer<typeof ProjectDraftSchema>;

/* ------------------------------------------------------------------
   Defaults for a new project (plan §3.9)
   ------------------------------------------------------------------ */

/** A fresh default view config: comfortable grid, automatic columns, workflow order, no filters */
export function defaultViewConfig(): ViewConfig {
  return {
    density: "comfortable",
    layout: "grid",
    columns: null,
    sort: "manual",
    hideDone: false,
    highlightUrgent: false,
    fields: { priority: true, estimate: true, progress: true, owner: false, due: false, cost: false },
    filters: { ownerIds: [], statuses: [], priorities: [], tags: [], due: "any" },
    focusPin: null,
    brief: { audience: "client", short: false },
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

/**
 * The plan's `DEFAULT_VIEW_CONFIG`, deeply frozen so no caller can change the default for
 * everyone. Immer copies it on the first write; code that edits a config outside a draft starts
 * from `defaultViewConfig()`.
 */
export const DEFAULT_VIEW_CONFIG: ViewConfig = deepFreeze(defaultViewConfig());

/** The blocks a new project starts with, in BLOCK_ORDER */
export const DEFAULT_BLOCKS: readonly BlockKind[] = Object.freeze(["header", "metrics", "collection"]);

/** Blocks a project always shows (`removeBlock` rejects them with `protected_block`) */
export const PROTECTED_BLOCKS: readonly BlockKind[] = Object.freeze(["header", "collection"]);

/** An empty brief: no edits, lines or sent references; the budget stays private */
export function emptyBriefState(): BriefState {
  return { edits: {}, lines: [], sent: [], sharing: { showBudgetToClient: false } };
}
