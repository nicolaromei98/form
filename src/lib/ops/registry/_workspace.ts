import { civilFromDayNum, daysBetween, toDayNum } from "@/lib/domain/dates";
import { docBytes, utf8Length } from "@/lib/domain/invariants/check";
import { DOC_BYTES_MAX } from "@/lib/domain/limits";
import { compareKeys, keyAfter, sortedByOrder } from "@/lib/domain/order";
import type { PersonId, ProjectId } from "@/lib/domain/schema/ids";
import type { IsoDate, OrderKey } from "@/lib/domain/schema/primitives";
import type { Person, ProjectIndexEntry, WorkspaceDoc } from "@/lib/domain/schema/workspace";
import { type AnyDoc, type CaptionEnv, type Rejection, reject } from "@/lib/ops/registry/_contract";
import { baseOf, formatDays, shortDate } from "@/lib/ops/registry/_helpers";

/**
 * Helpers of the workspace family (step 10d: settings, the calendar, people, templates and the
 * project index). Only `registry/workspace/*` imports this file; ops never import each other.
 */

/* ------------------------------------------------------------------
   People
   ------------------------------------------------------------------ */

export const PERSON_GONE = "That person isn't in the workspace anymore.";

/** The person, or `not_found` (workspace ops edit people, so a missing one is not found) */
export function mustPerson(ws: Pick<WorkspaceDoc, "people">, id: PersonId): Person | Rejection {
  return Object.hasOwn(ws.people, id) ? ws.people[id] : reject("not_found", PERSON_GONE);
}

/** The name rule of the invariant (plan §3.8 W2): trimmed and case-insensitive */
export const nameKey = (name: string) => name.trim().toLowerCase();

/**
 * The active person already called `name`, other than `except`, or null. Ids are walked in code
 * unit order, so the answer never depends on record key order.
 */
export function activeNamed(ws: Pick<WorkspaceDoc, "people">, name: string, except?: PersonId): Person | null {
  const key = nameKey(name);
  for (const id of Object.keys(ws.people).sort(compareKeys)) {
    const p = ws.people[id as PersonId];
    if (!p.archived && p.id !== except && nameKey(p.name) === key) return p;
  }
  return null;
}

/** The order key of a person added below every Team row, from the committed people */
export function nextPersonOrder(ws: WorkspaceDoc): OrderKey {
  const rows = sortedByOrder(baseOf(ws).people);
  return keyAfter(rows.length ? rows[rows.length - 1].order : null);
}

/** "4 days a week", "1 day a week", "0.5 days a week" */
export function capacityText(days: number): string {
  return `${formatDays(days)} day${days === 1 ? "" : "s"} a week`;
}

/** "1 task", "3 tasks" */
export const tasksText = (n: number) => `${n} task${n === 1 ? "" : "s"}`;

/* ------------------------------------------------------------------
   Dates and the calendar
   ------------------------------------------------------------------ */

/** A range that runs backwards breaks the invariant (plan §3.8 W3): refused before it is written */
export function backwardsRange(range: { from: IsoDate; to: IsoDate }): Rejection | null {
  return range.from > range.to ? reject("invalid_payload", "A date range ends on or after the day it starts.") : null;
}

/**
 * "2–6 Nov", "24 Dec–6 Jan", "24 Dec": fixed English month names. Ranges of nearly a year or
 * more carry their years ("2 Nov 2026–6 Nov 2027"), so a long range never reads as a short one.
 */
export function rangeText(from: IsoDate, to: IsoDate): string {
  if (from === to) return shortDate(from);
  const a = civilFromDayNum(toDayNum(from));
  const b = civilFromDayNum(toDayNum(to));
  if (daysBetween(from, to) >= 330) return `${shortDate(from)} ${a.year}–${shortDate(to)} ${b.year}`;
  if (a.year === b.year && a.month === b.month) return `${a.day}–${shortDate(to)}`;
  return `${shortDate(from)}–${shortDate(to)}`;
}

const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Working days as one sorted list without repeats (plan §3.8 W3) */
export function normaliseDays(days: readonly number[]): number[] {
  return [...new Set(days)].sort((a, b) => a - b);
}

/** "Mon–Fri", "Mon, Wed, Fri", "Mon–Wed, Sat, Sun": runs of three or more days collapse */
export function weekdaysText(days: readonly number[]): string {
  const sorted = normaliseDays(days);
  const runs: number[][] = [];
  for (const d of sorted) {
    const run = runs[runs.length - 1];
    if (run && run[run.length - 1] === d - 1) run.push(d);
    else runs.push([d]);
  }
  return runs
    .flatMap((run) => (run.length >= 3 ? [`${WEEKDAY[run[0] - 1]}–${WEEKDAY[run[run.length - 1] - 1]}`] : run.map((d) => WEEKDAY[d - 1])))
    .join(", ");
}

/* ------------------------------------------------------------------
   Document size
   ------------------------------------------------------------------ */

const BYTES = new WeakMap<object, number>();

/** The JSON byte length of a committed document, cached per document version */
function committedBytes(doc: AnyDoc): number {
  let bytes = BYTES.get(doc);
  if (bytes === undefined) {
    bytes = docBytes(doc);
    BYTES.set(doc, bytes);
  }
  return bytes;
}

/** The JSON byte length of a value */
export function jsonBytes(value: unknown): number {
  return value === undefined ? 0 : utf8Length(JSON.stringify(value));
}

export const TOO_LARGE = "That would take the workspace past its 1 MB limit.";

/**
 * `limit` when growing the committed document by `added` bytes and shrinking it by `removed` would
 * pass DOC_BYTES_MAX, so a recipe refuses instead of failing the commit gate. `added` should count
 * a new record's key and separators too (`recordBytes`).
 */
export function fitsDoc(draft: AnyDoc, added: number, removed = 0): Rejection | null {
  return committedBytes(baseOf(draft)) - removed + added > DOC_BYTES_MAX ? reject("limit", TOO_LARGE) : null;
}

/** What a new record entry adds to its JSON: `"key":value,` */
export function recordBytes(key: string, value: unknown): number {
  return jsonBytes(key) + jsonBytes(value) + 2;
}

/* ------------------------------------------------------------------
   The project index (Q9)
   ------------------------------------------------------------------ */

export const PROJECT_GONE = "That project isn't in the workspace anymore.";

/** The index entry of a project that isn't deleted, or `not_found` */
export function mustIndexed(ws: Pick<WorkspaceDoc, "projects">, id: ProjectId): ProjectIndexEntry | Rejection {
  if (!Object.hasOwn(ws.projects, id) || ws.projects[id].deletedAt !== null) return reject("not_found", PROJECT_GONE);
  return ws.projects[id];
}

/**
 * A project's title for a caption, or null. CaptionEnv answers only for the active project after
 * the command, so other projects read "Project" until the env can look one up by id (reported in
 * step 10d).
 */
export function projectTitle(env: CaptionEnv, id: ProjectId): string | null {
  const p = env.project();
  return p !== null && p.id === id ? p.title : null;
}

/* ------------------------------------------------------------------
   Caption keys
   ------------------------------------------------------------------ */

/** A later part with the same key replaces the earlier one (plan §5.9): two edits of one field read once */
export const wsKey = {
  workspace: (field: string) => `workspace:${field}`,
  person: (id: PersonId, field: string) => `person:${id}:${field}`,
  template: (id: string, field: string) => `template:${id}:${field}`,
} as const;
