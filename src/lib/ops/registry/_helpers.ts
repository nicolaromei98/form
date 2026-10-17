import { type Draft, isDraft, original } from "immer";
import { civilFromDayNum, toDayNum } from "@/lib/domain/dates";
import { resolvePerson } from "@/lib/domain/invariants/check";
import { titleInMessage } from "@/lib/domain/invariants/transitions";
import { compareKeys, keyAfter, keyBefore, keyBetween, sortedByOrder } from "@/lib/domain/order";
import type { PersonId, StepId, TaskId } from "@/lib/domain/schema/ids";
import type { IsoDate, OrderKey, Place, ViewKind } from "@/lib/domain/schema/primitives";
import type { ProjectDoc, Step, Task } from "@/lib/domain/schema/project";
import type { Person, WorkspaceDoc } from "@/lib/domain/schema/workspace";
import { type AnyDoc, type CaptionPart, fitText, type Rejection, reject } from "@/lib/ops/registry/_contract";

/**
 * Helpers every op recipe writes through (plan §5.4). They keep recipes deterministic and their
 * no-ops exact: a same-value write is never assigned, so Immer emits no patch and the reducer
 * returns the input document by reference.
 */

/** Long titles inside captions and messages: cut at 60 characters with an ellipsis */
export const title = titleInMessage;

/** The committed document behind a draft (or the value itself outside a recipe) */
export function baseOf<T extends object>(value: T): T {
  return isDraft(value) ? (original(value as Draft<T>) as T) : value;
}

/** Structural equality over JSON values (plain objects, arrays, primitives); key order never matters */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if (!Object.hasOwn(b, k) || !deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/**
 * Assigns `obj[key] = value` only when the value differs (deep-equal for arrays and objects), so
 * a same-value write produces no patch. Returns whether it wrote.
 */
export function setIfChanged<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): boolean {
  if (deepEqual(obj[key], value)) return false;
  obj[key] = value;
  return true;
}

/** The list without repeats, first occurrence kept (dependsOn and tag lists are deduplicated on write) */
export function unique<T>(list: readonly T[]): T[] {
  return [...new Set(list)];
}

/* ------------------------------------------------------------------
   Lookups that reject
   ------------------------------------------------------------------ */

export const TASK_GONE = "That task isn't in this project anymore.";

/** The task, or `not_found` */
export function mustTask(d: ProjectDoc, id: TaskId): Task | Rejection {
  return Object.hasOwn(d.tasks, id) ? d.tasks[id] : reject("not_found", TASK_GONE);
}

/** The step of a task, or `not_found` */
export function mustStep(task: Task, stepId: StepId): Step | Rejection {
  return task.steps.find((s) => s.id === stepId) ?? reject("not_found", `That step isn't in ${title(task.title)} anymore.`);
}

/**
 * A person a project op may name as an owner: one who is in the workspace (`invalid_reference`
 * otherwise) and not archived (`archived`). Read from `ctx.workspace`, never written (Q7).
 */
export function mustActivePerson(ws: Pick<WorkspaceDoc, "people">, id: PersonId): Person | Rejection {
  const found = resolvePerson(id, ws);
  if (found === "missing") return reject("invalid_reference", "That person isn't in the workspace.");
  if (found === "archived") return reject("archived", `${title(ws.people[id].name)} has left the team.`);
  return found;
}

/* ------------------------------------------------------------------
   Fresh ids
   ------------------------------------------------------------------ */

const ID_INDEX = new WeakMap<object, ReadonlySet<string>>();

function projectIds(doc: ProjectDoc): Set<string> {
  const ids = new Set<string>([doc.id]);
  for (const [key, t] of Object.entries(doc.tasks)) {
    ids.add(key).add(t.id);
    for (const s of t.steps) ids.add(s.id);
    for (const l of t.links) ids.add(l.id);
  }
  for (const l of doc.links) ids.add(l.id);
  for (const key of Object.keys(doc.moodboard.items)) ids.add(key);
  for (const l of doc.brief.lines) ids.add(l.id);
  for (const s of doc.brief.sent) ids.add(s.snapshotId);
  for (const key of Object.keys(doc.calendarOverride?.closures ?? {})) ids.add(key);
  const p = doc.proposal;
  if (p) {
    ids.add(p.id);
    if (p.kind === "subtasks") for (const item of p.items) ids.add(item.stepId);
    if (p.kind === "plan") {
      for (const seed of p.tasks) {
        ids.add(seed.taskId);
        for (const s of seed.steps) ids.add(s.stepId);
      }
    }
  }
  return ids;
}

function workspaceIds(doc: WorkspaceDoc): Set<string> {
  const ids = new Set<string>([doc.id]);
  for (const [key, p] of Object.entries(doc.people)) {
    ids.add(key);
    for (const off of Object.keys(p.timeOff)) ids.add(off);
  }
  for (const key of Object.keys(doc.closures)) ids.add(key);
  for (const key of Object.keys(doc.templates)) ids.add(key);
  for (const key of Object.keys(doc.projects)) ids.add(key);
  return ids;
}

/**
 * Every id in a committed document: entities, steps, links, lines, the proposal and the ids a
 * pending proposal would create. Cached per document version (documents are immutable).
 */
export function idIndex(doc: AnyDoc): ReadonlySet<string> {
  let ids = ID_INDEX.get(doc);
  if (!ids) {
    ids = doc.docType === "project" ? projectIds(doc) : workspaceIds(doc);
    ID_INDEX.set(doc, ids);
  }
  return ids;
}

/**
 * `duplicate_id` when the base document already uses `id`. Producers mint ids; the reducer never
 * re-mints one, so a collision is refused and reported. Payloads that carry several ids check
 * them against each other in their schema.
 */
export function ensureFreshId(draft: AnyDoc, id: string): Rejection | void {
  if (idIndex(baseOf(draft)).has(id)) return reject("duplicate_id", "That id is already taken, so FORM didn't reuse it.");
}

/* ------------------------------------------------------------------
   Workflow order
   ------------------------------------------------------------------ */

const WORKFLOW = new WeakMap<object, readonly Task[]>();

/** The base document's tasks in workflow order (order key, then id), cached per tasks record */
export function workflowOf(doc: ProjectDoc): readonly Task[] {
  const tasks = baseOf(doc).tasks;
  let list = WORKFLOW.get(tasks);
  if (!list) {
    list = sortedByOrder(tasks);
    WORKFLOW.set(tasks, list);
  }
  return list;
}

/**
 * The order key for a `place`, computed from the base document's neighbours so a replay keeps the
 * intent (plan §1.2): "end" after the last task, "start" before the first, `{after: X}` between X
 * and its successor. `exclude` leaves the moving task out of the list (moveTask). A missing
 * anchor falls back to "end" (addTask) or is `not_found` (`missingAnchor: "reject"`, moveTask).
 */
export function keyForPlace(
  draft: ProjectDoc,
  place: Place,
  opts: { exclude?: TaskId; missingAnchor?: "end" | "reject" } = {},
): OrderKey | Rejection {
  const all = workflowOf(draft);
  const list = opts.exclude ? all.filter((t) => t.id !== opts.exclude) : all;
  const last = list.length ? list[list.length - 1].order : null;
  if (place === "end") return keyAfter(last);
  if (place === "start") return keyBefore(list.length ? list[0].order : null);
  const i = list.findIndex((t) => t.id === place.after);
  if (i < 0) return opts.missingAnchor === "reject" ? reject("not_found", TASK_GONE) : keyAfter(last);
  return keyBetween(list[i].order, i + 1 < list.length ? list[i + 1].order : null);
}

/** The longest order key among the tasks (the runner rebalances past ORDER_KEY_REBALANCE) */
export function longestOrderKey(doc: ProjectDoc): number {
  let longest = 0;
  for (const t of Object.values(doc.tasks)) if (t.order.length > longest) longest = t.order.length;
  return longest;
}

/** Task ids in workflow order */
export function idsInWorkflow(doc: ProjectDoc): TaskId[] {
  return workflowOf(doc).map((t) => t.id);
}

/** Code-unit order for ids, never locale order */
export const byId = (a: { id: string }, b: { id: string }) => compareKeys(a.id, b.id);

/* ------------------------------------------------------------------
   Caption wording
   ------------------------------------------------------------------ */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "16 Oct": fixed English month names, never the host locale */
export function shortDate(date: IsoDate): string {
  const { month, day } = civilFromDayNum(toDayNum(date));
  return `${day} ${MONTHS[month - 1]}`;
}

/** Days as v0 showed them: 4, 4.5 */
export function formatDays(days: number): string {
  return Number.isInteger(days) ? String(days) : String(Math.round(days * 10) / 10);
}

/** "A", "A and B", "A, B and C"; past `max` names, "A, B and 3 others" */
export function joinNames(names: readonly string[], max = 3): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= max) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const shown = names.slice(0, max - 1);
  const rest = names.length - shown.length;
  return `${shown.join(", ")} and ${rest} other${rest > 1 ? "s" : ""}`;
}

/** A caption part, cut to 140 characters */
export function part(text: string, key?: string, tone?: "done" | "proposal") {
  return { text: fitText(text), ...(key ? { key } : {}), ...(tone ? { tone } : {}) };
}

/** Puts names into a group template ("{names} added to the team") */
export function fillNames(template: string, names: string): string {
  return template.split("{names}").join(names);
}

/**
 * A caption part said about one entity that groups with the same template said about others in
 * the same command (caption policy rule 1): "Giulia added to the team · capacity not set" alone,
 * "Giulia and Paolo added to the team · capacity not set" together.
 */
export function groupPart(
  template: string,
  name: string,
  o: { plural?: string; key?: string; implies?: readonly string[] } = {},
): CaptionPart {
  return {
    ...part(fillNames(template, name), o.key),
    group: { template, name, ...(o.plural ? { plural: o.plural } : {}) },
    ...(o.implies?.length ? { implies: o.implies } : {}),
  };
}

/**
 * What a timeline says while its start is unconfirmed (plan §1.3: the sample schedule): its
 * dates are samples, sequenced from the estimates. The Timeline show caption and a timeline
 * birth say it (caption policy rule 6).
 */
export const SAMPLE_DATES = "sample dates, sequenced from estimates";

/**
 * Caption keys shared across ops and local intents (plan §5.9). A later part with the same key
 * replaces the earlier one in place:
 * - `taskState(id)`: status and progress of one task ("Mark it done at 40%" reads "UI Design → Done");
 * - `show(v)`: the local show caption, which also takes over the brief options of setView;
 * - `viewAdded(v)`: addView's part, which `announceView` folds into the show part;
 * - `member(id)`: addMember's part, implied by a person added to the team in the same command.
 */
export const captionKey = {
  taskState: (id: TaskId) => `task:${id}:state`,
  taskField: (id: TaskId, field: string) => `task:${id}:${field}`,
  show: (v: ViewKind) => `show:${v}`,
  viewAdded: (v: ViewKind) => `view:${v}:added`,
  viewOption: (option: string) => `view-option:${option}`,
  member: (id: PersonId) => `member:${id}`,
} as const;
