import { z } from "zod";
import { ID_BODY, ID_PREFIX, type IdKind } from "@/lib/domain/ids";

/**
 * Branded id schemas (plan §3.1): a kind prefix, an underscore and a `[0-9a-z]` body. They work
 * as `z.record` keys, so a record keyed by the wrong kind of id fails to parse.
 */
const idSchema = <B extends string>(kind: IdKind) =>
  z
    .string()
    .regex(new RegExp(`^${ID_PREFIX[kind]}_${ID_BODY}$`), `Not a ${kind} id`)
    .brand<B>();

export const WorkspaceId = idSchema<"WorkspaceId">("workspace");
export const ProjectId = idSchema<"ProjectId">("project");
export const TaskId = idSchema<"TaskId">("task");
export const StepId = idSchema<"StepId">("step");
export const PersonId = idSchema<"PersonId">("person");
export const AssetId = idSchema<"AssetId">("asset");
export const CommentId = idSchema<"CommentId">("comment");
export const TemplateId = idSchema<"TemplateId">("template");
export const ProposalId = idSchema<"ProposalId">("proposal");
export const MoodItemId = idSchema<"MoodItemId">("moodItem");
export const BriefLineId = idSchema<"BriefLineId">("briefLine");
export const TimeOffId = idSchema<"TimeOffId">("timeOff");
export const ClosureId = idSchema<"ClosureId">("closure");
export const LinkId = idSchema<"LinkId">("link");
export const SnapshotId = idSchema<"SnapshotId">("snapshot");

export type WorkspaceId = z.infer<typeof WorkspaceId>;
export type ProjectId = z.infer<typeof ProjectId>;
export type TaskId = z.infer<typeof TaskId>;
export type StepId = z.infer<typeof StepId>;
export type PersonId = z.infer<typeof PersonId>;
export type AssetId = z.infer<typeof AssetId>;
export type CommentId = z.infer<typeof CommentId>;
export type TemplateId = z.infer<typeof TemplateId>;
export type ProposalId = z.infer<typeof ProposalId>;
export type MoodItemId = z.infer<typeof MoodItemId>;
export type BriefLineId = z.infer<typeof BriefLineId>;
export type TimeOffId = z.infer<typeof TimeOffId>;
export type ClosureId = z.infer<typeof ClosureId>;
export type LinkId = z.infer<typeof LinkId>;
export type SnapshotId = z.infer<typeof SnapshotId>;

/** Each id kind's branded type */
export interface IdTypes {
  workspace: WorkspaceId;
  project: ProjectId;
  task: TaskId;
  step: StepId;
  person: PersonId;
  asset: AssetId;
  comment: CommentId;
  template: TemplateId;
  proposal: ProposalId;
  moodItem: MoodItemId;
  briefLine: BriefLineId;
  timeOff: TimeOffId;
  closure: ClosureId;
  link: LinkId;
  snapshot: SnapshotId;
}

/** The branded id type of a kind: `IdOf<"task">` is `TaskId` */
export type IdOf<K extends IdKind> = IdTypes[K];

/** Every kind's schema, for code that holds the kind as a value */
export const ID_SCHEMAS = {
  workspace: WorkspaceId,
  project: ProjectId,
  task: TaskId,
  step: StepId,
  person: PersonId,
  asset: AssetId,
  comment: CommentId,
  template: TemplateId,
  proposal: ProposalId,
  moodItem: MoodItemId,
  briefLine: BriefLineId,
  timeOff: TimeOffId,
  closure: ClosureId,
  link: LinkId,
  snapshot: SnapshotId,
} as const satisfies Record<IdKind, z.ZodType>;
