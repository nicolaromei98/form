import { z } from "zod";
import { isIanaZone, isStorableDate } from "@/lib/domain/dates";
import { CENTS_MAX, DATE_MAX, DATE_MIN, LINK_LABEL, ORDER_KEY_MAX, TAG, TIMEZONE_LENGTH, URL_LENGTH } from "@/lib/domain/limits";
import { isOrderKey } from "@/lib/domain/order";
import { LinkId, TaskId } from "@/lib/domain/schema/ids";

/**
 * Schema primitives (plan §3.2). Parse equals validate: no defaults, catches or transforms, and
 * only field-level refinements, so document schemas built from these still support `.pick()`.
 */

/** "YYYY-MM-DD", a real day between DATE_MIN and DATE_MAX, read in the workspace time zone */
export const IsoDate = z.iso
  .date()
  .refine(isStorableDate, `Use a date from ${DATE_MIN} to ${DATE_MAX}`)
  .brand<"IsoDate">();
/** UTC "…Z" with optional fractions; always `ctx.now`, never a reducer's clock */
export const Timestamp = z.iso.datetime().brand<"Timestamp">();
/** Integer hundredths of the major unit (`domain/money.ts`) */
export const Cents = z.int().min(0).max(CENTS_MAX);
/** ISO 4217 */
export const Currency = z.string().regex(/^[A-Z]{3}$/);
/** Day counts in half days */
export const halfDays = (min: number, max: number) => z.number().min(min).max(max).multipleOf(0.5);
/** A fractional-indexing key (`domain/order.ts`); unique per collection (invariant) */
export const OrderKey = z
  .string()
  .min(1)
  .max(ORDER_KEY_MAX)
  .regex(/^[0-9A-Za-z]+$/)
  .refine(isOrderKey, "Not an order key");

const trimmed = (s: string) => s === s.trim();
/** One trimmed line of 1–max characters */
export const Line = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((s) => trimmed(s) && !/[\r\n]/.test(s), "Use one trimmed line");
/** Trimmed text of 1–max characters; line breaks allowed */
export const Text = (max: number) => z.string().min(1).max(max).refine(trimmed, "Trim the text");
export const Tag = Line(TAG).refine((s) => !s.includes(","), "Tags can't contain commas");
export const Url = z.url({ protocol: /^https?$/ }).max(URL_LENGTH);
/** 1 = Monday … 7 = Sunday */
export const Weekday = z.int().min(1).max(7);
/** Sorted and unique: an invariant, not a schema rule */
export const WorkingDays = z.array(Weekday).min(1).max(7);
export const Timezone = z.string().min(1).max(TIMEZONE_LENGTH).refine(isIanaZone, "Unknown time zone");

/** To do · In progress · In review · Done */
export const Status = z.enum(["todo", "active", "review", "done"]);
export const Priority = z.enum(["low", "medium", "high", "urgent"]);
export const TaskKind = z.enum(["task", "milestone"]);
export const Allocation = z.union([z.literal(0.25), z.literal(0.5), z.literal(0.75), z.literal(1)]);
/** "cards" is labelled Tracker */
export const ViewKind = z.enum(["cards", "board", "timeline", "team", "focus", "brief"]);
export const BirthView = z.enum(["cards", "board", "timeline"]);
export const BlockKind = z.enum(["header", "metrics", "progress", "collection", "moodboard", "budget", "activity"]);
/** The canonical render order of blocks */
export const BLOCK_ORDER = BlockKind.options;
export const ProjectKind = z.enum(["website", "brand-identity", "campaign", "product", "other"]);
export const ProjectStatus = z.enum(["planning", "active", "on-hold", "done"]);
export const Audience = z.enum(["client", "team"]);
export const BriefSection = z.enum(["note", "done", "moving", "next", "risks", "questions"]);
export const SortKey = z.enum(["manual", "priority", "progress", "status", "title", "estimate", "due"]);
export const MoodKind = z.enum(["image", "color", "note"]);
export const MoodLayout = z.enum(["masonry", "grid", "collage"]);
export const LinkSchema = z.object({ id: LinkId, label: Line(LINK_LABEL), url: Url }).strict();
/** Where an op puts a task: anchor-based, so a replay keeps the intent (plan §1.2) */
export const Place = z.union([z.literal("start"), z.literal("end"), z.object({ after: TaskId }).strict()]);

export type IsoDate = z.infer<typeof IsoDate>;
export type Timestamp = z.infer<typeof Timestamp>;
export type Cents = z.infer<typeof Cents>;
export type Currency = z.infer<typeof Currency>;
export type OrderKey = z.infer<typeof OrderKey>;
export type Weekday = z.infer<typeof Weekday>;
export type Timezone = z.infer<typeof Timezone>;
export type Status = z.infer<typeof Status>;
export type Priority = z.infer<typeof Priority>;
export type TaskKind = z.infer<typeof TaskKind>;
export type Allocation = z.infer<typeof Allocation>;
export type ViewKind = z.infer<typeof ViewKind>;
export type BirthView = z.infer<typeof BirthView>;
export type BlockKind = z.infer<typeof BlockKind>;
export type ProjectKind = z.infer<typeof ProjectKind>;
export type ProjectStatus = z.infer<typeof ProjectStatus>;
export type Audience = z.infer<typeof Audience>;
export type BriefSection = z.infer<typeof BriefSection>;
export type SortKey = z.infer<typeof SortKey>;
export type MoodKind = z.infer<typeof MoodKind>;
export type MoodLayout = z.infer<typeof MoodLayout>;
export type Link = z.infer<typeof LinkSchema>;
export type Place = z.infer<typeof Place>;
