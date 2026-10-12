import { z } from "zod";

/* ------------------------------------------------------------------
   Semantic entities
   ------------------------------------------------------------------ */

export const StatusSchema = z.enum(["todo", "active", "review", "done"]);
export const PrioritySchema = z.enum(["low", "medium", "high", "urgent"]);

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string().max(140),
  status: StatusSchema,
  priority: PrioritySchema,
  progress: z.number().min(0).max(100),
  /** Duration in days. `null` = unknown — never invented. */
  estimate: z.number().min(0.5).max(90).nullable(),
  /** Cost in EUR. `null` = unknown — never invented. */
  cost: z.number().min(0).nullable(),
  /** Relationship: subtasks point at their parent. */
  parentId: z.string().nullable(),
  /** "Make this more prominent" */
  emphasis: z.boolean(),
  origin: z.enum(["template", "user", "agent"]),
  /** Person responsible (Team view). Steps follow their parent. */
  owner: z.string().nullable().default(null),
});

/* ------------------------------------------------------------------
   Team — who does the work, and how many days they have for it
   ------------------------------------------------------------------ */

export const PersonSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(40),
  role: z.string().max(40).nullable(),
  /** Working days available for this project */
  capacity: z.number().min(0.5).max(90),
});

export const ReassignMoveSchema = z.object({ taskId: z.string(), to: z.string().nullable() });
/** A workload plan FORM proposes; nothing moves until it's accepted */
export const ReassignPlanSchema = z.object({ moves: z.array(ReassignMoveSchema).min(1).max(8) });

/* ------------------------------------------------------------------
   UI representation + layout preferences (structured config, not code)
   ------------------------------------------------------------------ */

export const RepresentationSchema = z.enum(["cards", "board", "timeline", "focus", "team"]);
export const DensitySchema = z.enum(["comfortable", "compact"]);
export const LayoutSchema = z.enum(["grid", "list"]);
export const SortSchema = z.enum(["manual", "priority", "progress", "status", "title", "estimate"]);
export const BlockTypeSchema = z.enum(["header", "metrics", "progress", "collection", "moodboard"]);

export const FieldsSchema = z.object({
  priority: z.boolean(),
  estimate: z.boolean(),
  progress: z.boolean(),
});

export const ViewSchema = z.object({
  representation: RepresentationSchema,
  density: DensitySchema,
  layout: LayoutSchema,
  /** `null` = automatic */
  columns: z.number().int().min(1).max(4).nullable(),
  sort: SortSchema,
  hideDone: z.boolean(),
  highlightUrgent: z.boolean(),
  fields: FieldsSchema,
  /** Focus representation: task the user pinned; null = FORM decides */
  focusId: z.string().nullable().optional(),
});

export const ToolSchema = z.object({
  id: z.string(),
  kind: z.literal("project"),
  template: z.literal("website"),
  title: z.string().max(80),
  /** ISO date (yyyy-mm-dd) the schedule starts from */
  startDate: z.string(),
  /** True while the start date is the demo's labelled sample date */
  startDateIsSample: z.boolean(),
  /** Registry blocks composing this tool, in render order */
  blocks: z.array(BlockTypeSchema),
});

/* ------------------------------------------------------------------
   Moodboard — a free canvas of references kept with the project.
   Geometry is in board-width units (1 = the board's width), so the
   arrangement scales with the viewport and survives resizes.
   ------------------------------------------------------------------ */

export const MoodKindSchema = z.enum(["image", "color", "note"]);
export const MoodLayoutSchema = z.enum(["masonry", "grid", "collage"]);

export const MoodItemSchema = z.object({
  id: z.string(),
  kind: MoodKindSchema,
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(20),
  w: z.number().min(0.04).max(1),
  h: z.number().min(0.03).max(3),
  /** Rotation in degrees (collage) */
  r: z.number().min(-15).max(15),
  /** Image: id of the downscaled file in this browser's asset store (IndexedDB) */
  asset: z.string().nullable(),
  /** Color: #rrggbb */
  hex: z.string().regex(/^#[0-9a-f]{6}$/i).nullable(),
  /** Note text, or a color's name */
  text: z.string().max(400).nullable(),
});

/** What a command (or a drop) adds; the reducer assigns ids, defaults and a free spot. */
export const MoodInputSchema = MoodItemSchema.omit({ id: true, r: true }).partial().extend({ kind: MoodKindSchema });

export const ProposalItemSchema = z.object({
  id: z.string(),
  title: z.string().max(140),
  estimate: z.number().min(0.5).max(90).nullable(),
});

export const ProposalSchema = z.object({
  parentId: z.string(),
  items: z.array(ProposalItemSchema).min(1).max(8),
});

export const DocSchema = z.object({
  tool: ToolSchema.nullable(),
  tasks: z.record(z.string(), TaskSchema),
  /** Manual (workflow) order of top-level tasks */
  order: z.array(z.string()),
  view: ViewSchema,
  proposal: ProposalSchema.nullable(),
  /** Moodboard items, in stacking order (last on top). Kept when the block is hidden. */
  mood: z.array(MoodItemSchema).max(200).default([]),
  people: z.array(PersonSchema).max(20).default([]),
  /** Proposed reassignments, shown as a preview on the Team view */
  plan: ReassignPlanSchema.nullable().default(null),
});

/* ------------------------------------------------------------------
   Operations — the only way the intelligence layer can change the UI
   ------------------------------------------------------------------ */

const TaskPatchSchema = TaskSchema.pick({
  title: true,
  status: true,
  priority: true,
  progress: true,
  estimate: true,
  cost: true,
  emphasis: true,
}).partial();

const ViewPatchSchema = ViewSchema.omit({ representation: true, fields: true }).partial();

export const OperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("createProject"), title: z.string().min(1).max(80), template: z.literal("website") }),
  z.object({ op: z.literal("renameTool"), title: z.string().min(1).max(80) }),
  z.object({ op: z.literal("setRepresentation"), representation: RepresentationSchema }),
  z.object({ op: z.literal("setView"), patch: ViewPatchSchema }),
  z.object({ op: z.literal("setFields"), patch: FieldsSchema.partial() }),
  z.object({ op: z.literal("updateTask"), id: z.string(), patch: TaskPatchSchema }),
  z.object({
    op: z.literal("addTask"),
    title: z.string().min(1).max(140),
    parentId: z.string().nullable(),
    estimate: z.number().min(0.5).max(90).nullable(),
    priority: PrioritySchema.optional(),
  }),
  z.object({ op: z.literal("removeTask"), id: z.string() }),
  z.object({ op: z.literal("moveTask"), id: z.string(), toIndex: z.number().int().min(0) }),
  z.object({ op: z.literal("proposeSubtasks"), parentId: z.string(), items: z.array(ProposalItemSchema).min(1).max(8) }),
  z.object({ op: z.literal("acceptProposal") }),
  z.object({ op: z.literal("discardProposal") }),
  z.object({ op: z.literal("addBlock"), block: BlockTypeSchema }),
  z.object({ op: z.literal("removeBlock"), block: BlockTypeSchema }),
  z.object({ op: z.literal("setStartDate"), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ op: z.literal("addMoodItems"), items: z.array(MoodInputSchema).min(1).max(24) }),
  z.object({
    op: z.literal("updateMoodItem"),
    id: z.string(),
    patch: MoodItemSchema.pick({ x: true, y: true, w: true, h: true, r: true, hex: true, text: true }).partial(),
    /** Bring it to the top of the stack */
    raise: z.boolean().optional(),
  }),
  z.object({ op: z.literal("removeMoodItem"), id: z.string() }),
  z.object({ op: z.literal("arrangeMood"), layout: MoodLayoutSchema }),
  z.object({ op: z.literal("clearMood") }),
  z.object({ op: z.literal("addPerson"), name: z.string().min(1).max(40), role: z.string().max(40).nullable().optional(), capacity: z.number().min(0.5).max(90).optional() }),
  z.object({ op: z.literal("updatePerson"), id: z.string(), patch: PersonSchema.pick({ name: true, role: true, capacity: true }).partial() }),
  z.object({ op: z.literal("removePerson"), id: z.string() }),
  /** Steps can't be assigned on their own: they follow their parent */
  z.object({ op: z.literal("assignTask"), taskId: z.string(), personId: z.string().nullable() }),
  z.object({ op: z.literal("addSampleTeam") }),
  z.object({ op: z.literal("proposeReassign"), moves: z.array(ReassignMoveSchema).min(1).max(8) }),
  z.object({ op: z.literal("acceptReassign") }),
  z.object({ op: z.literal("discardReassign") }),
]);

export const OperationListSchema = z.array(OperationSchema).max(12);

export const InterpretationSchema = z.object({
  ops: OperationListSchema,
  /** Short caption describing what changed. Not a chat reply. */
  message: z.string().max(280),
  tone: z.enum(["done", "proposal", "unsupported", "clarify"]),
  control: z.enum(["undo", "redo", "reset"]).optional(),
  /** Entity the command was resolved against, if any */
  target: z.string().nullable().optional(),
});

export type Status = z.infer<typeof StatusSchema>;
export type Priority = z.infer<typeof PrioritySchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Representation = z.infer<typeof RepresentationSchema>;
export type Density = z.infer<typeof DensitySchema>;
export type Layout = z.infer<typeof LayoutSchema>;
export type Sort = z.infer<typeof SortSchema>;
export type BlockType = z.infer<typeof BlockTypeSchema>;
export type Fields = z.infer<typeof FieldsSchema>;
export type View = z.infer<typeof ViewSchema>;
export type Tool = z.infer<typeof ToolSchema>;
export type ProposalItem = z.infer<typeof ProposalItemSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;
export type Person = z.infer<typeof PersonSchema>;
export type ReassignMove = z.infer<typeof ReassignMoveSchema>;
export type ReassignPlan = z.infer<typeof ReassignPlanSchema>;
export type MoodKind = z.infer<typeof MoodKindSchema>;
export type MoodLayout = z.infer<typeof MoodLayoutSchema>;
export type MoodItem = z.infer<typeof MoodItemSchema>;
export type MoodInput = z.infer<typeof MoodInputSchema>;
export type Doc = z.infer<typeof DocSchema>;
export type Operation = z.infer<typeof OperationSchema>;
export type Interpretation = z.infer<typeof InterpretationSchema>;

export const STATUS_LABEL: Record<Status, string> = {
  todo: "To do",
  active: "In progress",
  review: "In review",
  done: "Done",
};
export const STATUS_ORDER: Status[] = ["todo", "active", "review", "done"];

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};
export const PRIORITY_ORDER: Priority[] = ["low", "medium", "high", "urgent"];
export const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export const REPRESENTATION_LABEL: Record<Representation, string> = {
  cards: "Tracker",
  board: "Board",
  timeline: "Timeline",
  focus: "Focus",
  team: "Team",
};

export const SORT_LABEL: Record<Sort, string> = {
  manual: "Workflow",
  priority: "Priority",
  progress: "Progress",
  status: "Status",
  title: "Name",
  estimate: "Duration",
};
