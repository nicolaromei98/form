import { z } from "zod";
import {
  DEPS_MAX,
  ESTIMATE_MAX_DAYS,
  PERSON_ROLE,
  STEP_TITLE,
  STEPS_MAX,
  TASK_TITLE,
  TEMPLATE_NAME,
  TEMPLATE_TASKS_MAX,
} from "@/lib/domain/limits";
import { PersonId, StepId, TaskId, TemplateId } from "@/lib/domain/schema/ids";
import { halfDays, Line, Priority, ProjectKind, Status, TaskKind, Timestamp } from "@/lib/domain/schema/primitives";

/**
 * Templates and task seeds (plan §3.3, §3.5). Templates are structure that a user saved (the
 * built-in starters are code: `domain/starters.ts`). Seeds are fully minted, coherent tasks that
 * bulk creation passes in a payload: the demo seed, a template, an accepted plan.
 *
 * `ProjectDraftSchema` lives in `project.ts`, next to the schema it picks from: putting it here
 * would make template → project → proposal → template an import cycle.
 */

/** A template task. `dependsOn` holds indices of earlier tasks in the same template (invariant). */
export const TemplateTaskSchema = z
  .object({
    title: Line(TASK_TITLE),
    kind: TaskKind,
    /** null = unknown; a milestone has 0 (invariant) */
    estimateDays: halfDays(0, ESTIMATE_MAX_DAYS).nullable(),
    dependsOn: z.array(z.int().min(0)).max(DEPS_MAX),
    steps: z.array(Line(STEP_TITLE)).max(STEPS_MAX),
    /** Free text, compared with person roles by balance */
    roleHint: Line(PERSON_ROLE).nullable(),
  })
  .strict();

/** A user template (workspace document). Starters are never stored. */
export const TemplateSchema = z
  .object({
    id: TemplateId,
    name: Line(TEMPLATE_NAME),
    kind: ProjectKind,
    tasks: z.array(TemplateTaskSchema).min(1).max(TEMPLATE_TASKS_MAX),
    createdAt: Timestamp,
  })
  .strict();

/** A step created together with its task, or proposed for one: its id is minted by the producer */
export const StepSeedSchema = z
  .object({
    stepId: StepId,
    title: Line(STEP_TITLE),
    estimateDays: halfDays(0.5, ESTIMATE_MAX_DAYS).nullable(),
  })
  .strict();

/**
 * A task to create in bulk. Every id is minted; `dependsOn` names earlier seeds of the same list
 * or tasks that already exist. Milestones are normalised on write (estimate 0, allocation 1, no
 * steps), and `dependsOn` is deduplicated (plan §5.6).
 */
export const TaskSeedSchema = z
  .object({
    taskId: TaskId,
    title: Line(TASK_TITLE),
    kind: TaskKind,
    estimateDays: halfDays(0, ESTIMATE_MAX_DAYS).nullable(),
    dependsOn: z.array(TaskId).max(DEPS_MAX),
    status: Status,
    priority: Priority,
    progress: z.int().min(0).max(100),
    ownerId: PersonId.nullable(),
    emphasis: z.boolean(),
    steps: z.array(StepSeedSchema).max(STEPS_MAX),
  })
  .strict();

export type TemplateTask = z.infer<typeof TemplateTaskSchema>;
export type Template = z.infer<typeof TemplateSchema>;
export type StepSeed = z.infer<typeof StepSeedSchema>;
export type TaskSeed = z.infer<typeof TaskSeedSchema>;
