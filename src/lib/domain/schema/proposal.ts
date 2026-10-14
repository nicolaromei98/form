import { z } from "zod";
import { ESTIMATE_MAX_DAYS, PROPOSAL_BULK_MAX, PROPOSAL_ITEMS_MAX, PROPOSAL_WHY } from "@/lib/domain/limits";
import { PersonId, ProposalId, TaskId } from "@/lib/domain/schema/ids";
import { halfDays, IsoDate, Timestamp } from "@/lib/domain/schema/primitives";
import { StepSeedSchema, TaskSeedSchema } from "@/lib/domain/schema/template";

/**
 * The pending proposal (plan §3.4): at most one per project; a new one replaces it. Targets must
 * exist, ids inside it are unique, and the ids it would create must be fresh (invariants).
 */

const base = {
  id: ProposalId,
  createdAt: Timestamp,
  source: z.enum(["parser", "agent", "direct"]),
};

const why = z.string().max(PROPOSAL_WHY);
/** Working days a start moves by */
const shiftDays = z.int().min(1).max(ESTIMATE_MAX_DAYS);

/** Steps for one task. Accepting keeps each `stepId`, so the proposal → step morph keeps its identity. */
export const SubtasksProposalSchema = z
  .object({
    ...base,
    kind: z.literal("subtasks"),
    taskId: TaskId,
    items: z.array(StepSeedSchema).min(1).max(PROPOSAL_ITEMS_MAX),
  })
  .strict();

export const OwnerMoveSchema = z
  .object({ type: z.literal("owner"), taskId: TaskId, from: PersonId.nullable(), to: PersonId, why })
  .strict();
export const ShiftMoveSchema = z
  .object({ type: z.literal("shift"), taskId: TaskId, pinnedStart: IsoDate, days: shiftDays, why })
  .strict();
export const ReassignMoveSchema = z.discriminatedUnion("type", [OwnerMoveSchema, ShiftMoveSchema]);

export const ReassignProposalSchema = z
  .object({
    ...base,
    kind: z.literal("reassign"),
    moves: z.array(ReassignMoveSchema).min(1).max(PROPOSAL_ITEMS_MAX),
  })
  .strict();

export const LevelingMoveSchema = z.object({ taskId: TaskId, pinnedStart: IsoDate, days: shiftDays, why }).strict();

export const LevelingProposalSchema = z
  .object({
    ...base,
    kind: z.literal("leveling"),
    moves: z.array(LevelingMoveSchema).min(1).max(PROPOSAL_BULK_MAX),
  })
  .strict();

/** Suggested estimates, shown as such until accepted */
export const EstimateItemSchema = z
  .object({ taskId: TaskId, estimateDays: halfDays(0.5, ESTIMATE_MAX_DAYS) })
  .strict();

export const EstimatesProposalSchema = z
  .object({
    ...base,
    kind: z.literal("estimates"),
    items: z.array(EstimateItemSchema).min(1).max(PROPOSAL_BULK_MAX),
  })
  .strict();

/** A suggested plan: new tasks, minted and coherent */
export const PlanProposalSchema = z
  .object({
    ...base,
    kind: z.literal("plan"),
    tasks: z.array(TaskSeedSchema).min(1).max(PROPOSAL_ITEMS_MAX),
  })
  .strict();

export const ProposalSchema = z.discriminatedUnion("kind", [
  SubtasksProposalSchema,
  ReassignProposalSchema,
  LevelingProposalSchema,
  EstimatesProposalSchema,
  PlanProposalSchema,
]);

export type SubtasksProposal = z.infer<typeof SubtasksProposalSchema>;
export type OwnerMove = z.infer<typeof OwnerMoveSchema>;
export type ShiftMove = z.infer<typeof ShiftMoveSchema>;
export type ReassignMove = z.infer<typeof ReassignMoveSchema>;
export type ReassignProposal = z.infer<typeof ReassignProposalSchema>;
export type LevelingMove = z.infer<typeof LevelingMoveSchema>;
export type LevelingProposal = z.infer<typeof LevelingProposalSchema>;
export type EstimateItem = z.infer<typeof EstimateItemSchema>;
export type EstimatesProposal = z.infer<typeof EstimatesProposalSchema>;
export type PlanProposal = z.infer<typeof PlanProposalSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;
export type ProposalKind = Proposal["kind"];
