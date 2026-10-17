import { z } from "zod";
import { CAPACITY_MAX_DAYS, EMAIL_LENGTH, PERSON_NAME, PERSON_ROLE, RANGE_LABEL, USER_ID, WORKSPACE_NAME } from "@/lib/domain/limits";
import { ClosureId, PersonId, ProjectId, TemplateId, TimeOffId, WorkspaceId } from "@/lib/domain/schema/ids";
import { Cents, Currency, halfDays, IsoDate, Line, OrderKey, Timestamp, Timezone, WorkingDays } from "@/lib/domain/schema/primitives";
import { TemplateSchema } from "@/lib/domain/schema/template";

/**
 * The workspace document (plan §1.2, §3.3): settings, the calendar, people, user templates and
 * the project index. Strict, with no defaults, transforms or object-level refinements: parse
 * equals validate, and cross-field rules live in `invariants/check.ts`.
 */

/** A person's days off; `from ≤ to` is an invariant */
export const TimeOffSchema = z
  .object({ id: TimeOffId, from: IsoDate, to: IsoDate, label: Line(RANGE_LABEL).nullable() })
  .strict();

/** A studio closure or holiday; `from ≤ to` is an invariant */
export const ClosureSchema = z.object({ id: ClosureId, from: IsoDate, to: IsoDate, label: Line(RANGE_LABEL) }).strict();

export const PersonSchema = z
  .object({
    id: PersonId,
    name: Line(PERSON_NAME),
    /** Free text; balance compares it trimmed and case-insensitive */
    role: Line(PERSON_ROLE).nullable(),
    email: z.email().max(EMAIL_LENGTH).nullable(),
    /** Set = "this is me" (Phase 2) */
    userId: z.string().min(1).max(USER_ID).nullable(),
    /** Q3: null = unknown, so load shows no over/under verdict */
    capacityDaysPerWeek: halfDays(0, CAPACITY_MAX_DAYS).nullable(),
    /** For derived costs only; never shown to the client */
    dayRateCents: Cents.nullable(),
    timeOff: z.record(TimeOffId, TimeOffSchema),
    /** Team row order: records have no order of their own */
    order: OrderKey,
    archived: z.boolean(),
    createdAt: Timestamp,
  })
  .strict();

/** One row of the project index (Q9). Archived and deleted state lives only here. */
export const ProjectIndexEntrySchema = z
  .object({
    id: ProjectId,
    createdAt: Timestamp,
    archivedAt: Timestamp.nullable(),
    deletedAt: Timestamp.nullable(),
  })
  .strict();

export const WorkspaceDocSchema = z
  .object({
    schemaVersion: z.literal(2),
    docType: z.literal("workspace"),
    id: WorkspaceId,
    name: Line(WORKSPACE_NAME),
    timezone: Timezone,
    defaultCurrency: Currency,
    workingDays: WorkingDays,
    closures: z.record(ClosureId, ClosureSchema),
    /** A country code ("IT"), or null */
    holidayPreset: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable(),
    people: z.record(PersonId, PersonSchema),
    /** User templates only; the starters are code */
    templates: z.record(TemplateId, TemplateSchema),
    /** The project index (Q9) */
    projects: z.record(ProjectId, ProjectIndexEntrySchema),
    improveFormOptIn: z.boolean(),
    createdAt: Timestamp,
  })
  .strict();

export type TimeOff = z.infer<typeof TimeOffSchema>;
export type Closure = z.infer<typeof ClosureSchema>;
export type Person = z.infer<typeof PersonSchema>;
export type ProjectIndexEntry = z.infer<typeof ProjectIndexEntrySchema>;
export type WorkspaceDoc = z.infer<typeof WorkspaceDocSchema>;
