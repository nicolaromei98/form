import { topoOrder } from "@/lib/domain/invariants/graph";
import { coherenceProblems, milestoneProblems } from "@/lib/domain/invariants/transitions";
import {
  CLOSURES_MAX,
  DOC_BYTES_MAX,
  MOOD_MAX,
  PEOPLE_MAX,
  PROJECTS_MAX,
  TASKS_MAX,
  TEMPLATES_MAX,
  TIME_OFF_MAX,
} from "@/lib/domain/limits";
import { compareKeys } from "@/lib/domain/order";
import type { PersonId, TaskId } from "@/lib/domain/schema/ids";
import { BLOCK_ORDER, type BlockKind, type Cents, type IsoDate } from "@/lib/domain/schema/primitives";
import type { ProjectDoc, Task } from "@/lib/domain/schema/project";
import type { TemplateTask } from "@/lib/domain/schema/template";
import type { Person, WorkspaceDoc } from "@/lib/domain/schema/workspace";

/**
 * The invariants (plan §3.8): the cross-field and size rules the strict schemas leave out. The
 * commit gate, the property suite, development asserts and the migration all run them after the
 * schema, so they assume a schema-valid document but never throw on a broken one. Violations come
 * in a fixed order that never depends on record key order.
 *
 * Across documents (Q7) nothing is checked: owner, lead and members resolve at read time.
 */

export type ViolationCode =
  /** A record stored under a key other than its id (P1, W1) */
  | "record_key"
  /** More entities than a limit allows (P1, W1) */
  | "too_many"
  /** Task or person order keys used twice (P2, W3) */
  | "duplicate_order"
  /** Mood item z keys used twice (P2) */
  | "duplicate_z"
  /** An id used twice where ids must be unique (P3) */
  | "duplicate_id"
  /** A proposal would create an id that already exists (P3) */
  | "id_taken"
  | "missing_dependency"
  | "duplicate_dependency"
  | "self_dependency"
  /** Dependencies loop (P4) */
  | "cycle"
  /** Status and progress disagree (P5) */
  | "status_progress"
  /** A malformed milestone (P6, W4) */
  | "milestone"
  /** A task estimated at 0 days: null (unknown) or at least half a day (P6, W4) */
  | "estimate"
  | "duplicate_view"
  | "duplicate_block"
  /** Blocks out of BLOCK_ORDER (P7) */
  | "block_order"
  /** Header or collection missing (P7) */
  | "missing_block"
  /** The focus pin names no task (P8) */
  | "focus_pin"
  /** A proposal targets a missing or wrong task (P9) */
  | "proposal_target"
  /** A mood item without its content, or past the board's right edge (P10) */
  | "mood_item"
  | "duplicate_member"
  | "duplicate_tag"
  /** startDate after the deadline (P12) */
  | "date_order"
  /** A range that ends before it starts (P12, W3) */
  | "range_order"
  /** Working days unsorted or repeated (P12, W3) */
  | "working_days"
  /** Over 1,000,000 bytes of JSON (P13, W5) */
  | "doc_size"
  /** Two active people with the same name (W2) */
  | "duplicate_name"
  /** Two people linked to one account (W2) */
  | "duplicate_user"
  /** A template task that depends on itself or a later task (W4) */
  | "template_dependency";

export interface Violation {
  code: ViolationCode;
  /** Where in the document, as a patch-style path */
  path: (string | number)[];
  /** English, for development asserts and test failures */
  message: string;
}

/** Records in code-unit key order: iteration never depends on how the record was built */
function entries<T>(record: Readonly<Record<string, T>>): [string, T][] {
  return Object.keys(record)
    .sort(compareKeys)
    .map((key) => [key, record[key]]);
}

const NONE: readonly number[] = Object.freeze([]);

/** Indices of values already seen earlier in the list. Short lists (most tags and dependencies) skip the Set. */
function repeats<T>(list: readonly T[]): readonly number[] {
  if (list.length < 2) return NONE;
  let out: number[] | null = null;
  if (list.length <= 8) {
    for (let i = 1; i < list.length; i++) {
      for (let j = 0; j < i; j++) {
        if (list[j] === list[i]) {
          (out ??= []).push(i);
          break;
        }
      }
    }
    return out ?? NONE;
  }
  const seen = new Set<T>();
  list.forEach((value, i) => {
    if (seen.has(value)) (out ??= []).push(i);
    seen.add(value);
  });
  return out ?? NONE;
}

const isSortedUnique = (days: readonly number[]) => days.every((d, i) => i === 0 || days[i - 1] < d);
const backwards = (range: { from: IsoDate; to: IsoDate }) => range.from > range.to;

const UTF8 = new TextEncoder();

/**
 * UTF-8 byte length of a string. The native encoder is about ten times faster than counting code
 * units in JS (0.015 ms against 0.15 ms for a 150-task project), and validation runs after every op.
 */
export function utf8Length(s: string): number {
  return UTF8.encode(s).length;
}

/** A document's JSON byte length: the stored and synced size (DOC_BYTES_MAX) */
export function docBytes(doc: unknown): number {
  return utf8Length(JSON.stringify(doc));
}

class Report {
  readonly out: Violation[] = [];
  add(code: ViolationCode, path: (string | number)[], message: string): void {
    this.out.push({ code, path, message });
  }
}

/* ------------------------------------------------------------------
   Project
   ------------------------------------------------------------------ */

/** Every project invariant (plan §3.8, P1–P13); empty for a valid document */
export function checkProject(doc: ProjectDoc): Violation[] {
  const r = new Report();
  const tasks = entries(doc.tasks);
  const ids = new Set<string>(tasks.map(([, t]) => t.id));
  const items = entries(doc.moodboard.items);

  // P1: record keys equal ids; counts
  for (const [key, t] of tasks) if (key !== t.id) r.add("record_key", ["tasks", key, "id"], `Task ${t.id} is stored under ${key}.`);
  for (const [key, m] of items) {
    if (key !== m.id) r.add("record_key", ["moodboard", "items", key, "id"], `Mood item ${m.id} is stored under ${key}.`);
  }
  for (const [key, c] of entries(doc.calendarOverride?.closures ?? {})) {
    if (key !== c.id) r.add("record_key", ["calendarOverride", "closures", key, "id"], `Closure ${c.id} is stored under ${key}.`);
  }
  if (tasks.length > TASKS_MAX) r.add("too_many", ["tasks"], `${tasks.length} tasks: a project holds at most ${TASKS_MAX}.`);
  if (items.length > MOOD_MAX) {
    r.add("too_many", ["moodboard", "items"], `${items.length} mood items: a moodboard holds at most ${MOOD_MAX}.`);
  }

  // P2: unique order and z keys
  const orders = new Map<string, string>();
  for (const [key, t] of tasks) {
    const other = orders.get(t.order);
    if (other !== undefined) r.add("duplicate_order", ["tasks", key, "order"], `Order key ${t.order} is used by ${other} and ${t.id}.`);
    else orders.set(t.order, t.id);
  }
  const zs = new Map<string, string>();
  for (const [key, m] of items) {
    const other = zs.get(m.z);
    if (other !== undefined) r.add("duplicate_z", ["moodboard", "items", key, "z"], `z key ${m.z} is used by ${other} and ${m.id}.`);
    else zs.set(m.z, m.id);
  }

  // P3: unique ids (steps, brief lines, links, inside the proposal); proposals create fresh ids
  const stepIds = new Set<string>();
  for (const [key, t] of tasks) {
    t.steps.forEach((s, i) => {
      if (stepIds.has(s.id)) r.add("duplicate_id", ["tasks", key, "steps", i, "id"], `Step id ${s.id} is used twice.`);
      stepIds.add(s.id);
    });
  }
  for (const i of repeats(doc.brief.lines.map((l) => l.id))) {
    r.add("duplicate_id", ["brief", "lines", i, "id"], `Brief line id ${doc.brief.lines[i].id} is used twice.`);
  }
  const linkIds = new Set<string>();
  const checkLinks = (links: ProjectDoc["links"], path: (string | number)[]) =>
    links.forEach((l, i) => {
      if (linkIds.has(l.id)) r.add("duplicate_id", [...path, i, "id"], `Link id ${l.id} is used twice.`);
      linkIds.add(l.id);
    });
  checkLinks(doc.links, ["links"]);
  for (const [key, t] of tasks) checkLinks(t.links, ["tasks", key, "links"]);
  checkProposalIds(doc, ids, stepIds, r);

  // P4: dependencies exist, are unique, never the task itself, and never loop
  for (const [key, t] of tasks) {
    t.dependsOn.forEach((d, i) => {
      const path = ["tasks", key, "dependsOn", i];
      if (d === t.id) r.add("self_dependency", path, `${t.id} depends on itself.`);
      else if (!ids.has(d)) r.add("missing_dependency", path, `${t.id} depends on ${d}, which isn't in the project.`);
    });
    for (const i of repeats(t.dependsOn)) {
      r.add("duplicate_dependency", ["tasks", key, "dependsOn", i], `${t.id} depends on ${t.dependsOn[i]} twice.`);
    }
  }
  const { cyclic } = topoOrder(doc);
  if (cyclic.length > 0) {
    const named = cyclic.slice(0, 5).join(", ") + (cyclic.length > 5 ? ", …" : "");
    r.add("cycle", ["tasks", cyclic[0], "dependsOn"], `Dependencies loop: ${cyclic.length} tasks never become ready (${named}).`);
  }

  // P5: status and progress agree; P6: milestones and estimates
  for (const [key, t] of tasks) {
    for (const problem of coherenceProblems(t, doc.requireReview)) r.add("status_progress", ["tasks", key, "status"], `${t.id}: ${problem}`);
    for (const problem of milestoneProblems(t)) r.add("milestone", ["tasks", key], `${t.id}: ${problem}`);
    if (t.kind === "task" && t.estimateDays === 0) {
      r.add("estimate", ["tasks", key, "estimateDays"], `${t.id}: an estimate is null or at least half a day.`);
    }
  }

  // P7: views and blocks
  for (const i of repeats(doc.views)) r.add("duplicate_view", ["views", i], `The ${doc.views[i]} view is listed twice.`);
  const blockRepeats = repeats(doc.blocks);
  for (const i of blockRepeats) r.add("duplicate_block", ["blocks", i], `The ${doc.blocks[i]} block is listed twice.`);
  const rank = (b: BlockKind) => BLOCK_ORDER.indexOf(b);
  doc.blocks.forEach((b, i) => {
    if (i > 0 && !blockRepeats.includes(i) && rank(b) < rank(doc.blocks[i - 1])) {
      r.add("block_order", ["blocks", i], `The ${b} block comes after ${doc.blocks[i - 1]}, against BLOCK_ORDER.`);
    }
  });
  for (const b of ["header", "collection"] as const) {
    if (!doc.blocks.includes(b)) r.add("missing_block", ["blocks"], `The ${b} block is always shown.`);
  }

  // P8: the focus pin
  const pin = doc.viewConfig.focusPin;
  if (pin !== null && !ids.has(pin)) r.add("focus_pin", ["viewConfig", "focusPin"], `Focus is pinned to ${pin}, which isn't in the project.`);

  // P9: proposal targets
  checkProposalTargets(doc, ids, r);

  // P10: mood items
  for (const [key, m] of items) {
    const path = ["moodboard", "items", key];
    if (m.kind === "image" && m.assetId === null) r.add("mood_item", [...path, "assetId"], `Image ${m.id} has no asset.`);
    if (m.kind === "color" && m.hex === null) r.add("mood_item", [...path, "hex"], `Colour ${m.id} has no hex.`);
    if (m.kind === "note" && m.text === null) r.add("mood_item", [...path, "text"], `Note ${m.id} has no text.`);
    if (m.x + m.w > 1 + 1e-9) r.add("mood_item", [...path, "x"], `Mood item ${m.id} runs past the board's right edge.`);
  }

  // P11: no duplicate members or tags (dependsOn: P4)
  for (const i of repeats(doc.memberIds)) r.add("duplicate_member", ["memberIds", i], `${doc.memberIds[i]} is a member twice.`);
  for (const i of repeats(doc.tags)) r.add("duplicate_tag", ["tags", i], `The project is tagged ${doc.tags[i]} twice.`);
  for (const [key, t] of tasks) {
    for (const i of repeats(t.tags)) r.add("duplicate_tag", ["tasks", key, "tags", i], `${t.id} is tagged ${t.tags[i]} twice.`);
  }

  // P12: dates and the calendar override
  if (doc.startDate !== null && doc.deadline !== null && doc.startDate > doc.deadline) {
    r.add("date_order", ["deadline"], `The deadline ${doc.deadline} is before the start ${doc.startDate}.`);
  }
  const override = doc.calendarOverride;
  if (override?.workingDays && !isSortedUnique(override.workingDays)) {
    r.add("working_days", ["calendarOverride", "workingDays"], "Working days are listed in order, once each.");
  }
  for (const [key, c] of entries(override?.closures ?? {})) {
    if (backwards(c)) r.add("range_order", ["calendarOverride", "closures", key], `Closure ${c.id} ends before it starts.`);
  }

  // P13: size
  const bytes = docBytes(doc);
  if (bytes > DOC_BYTES_MAX) r.add("doc_size", [], `The project is ${bytes} bytes: a document holds at most ${DOC_BYTES_MAX}.`);

  return r.out;
}

/** P3 for the pending proposal */
function checkProposalIds(doc: ProjectDoc, taskIds: ReadonlySet<string>, stepIds: ReadonlySet<string>, r: Report): void {
  const p = doc.proposal;
  if (!p) return;
  const unique = (values: readonly string[], path: (i: number) => (string | number)[], what: string) => {
    for (const i of repeats(values)) r.add("duplicate_id", path(i), `The proposal names ${what} ${values[i]} twice.`);
  };
  switch (p.kind) {
    case "subtasks":
      unique(
        p.items.map((s) => s.stepId),
        (i) => ["proposal", "items", i, "stepId"],
        "step",
      );
      p.items.forEach((s, i) => {
        if (stepIds.has(s.stepId)) r.add("id_taken", ["proposal", "items", i, "stepId"], `Step id ${s.stepId} already exists.`);
      });
      return;
    case "plan": {
      unique(
        p.tasks.map((t) => t.taskId),
        (i) => ["proposal", "tasks", i, "taskId"],
        "task",
      );
      const seedSteps = new Set<string>();
      p.tasks.forEach((t, i) => {
        if (taskIds.has(t.taskId)) r.add("id_taken", ["proposal", "tasks", i, "taskId"], `Task id ${t.taskId} already exists.`);
        t.steps.forEach((s, j) => {
          const path = ["proposal", "tasks", i, "steps", j, "stepId"];
          if (stepIds.has(s.stepId)) r.add("id_taken", path, `Step id ${s.stepId} already exists.`);
          else if (seedSteps.has(s.stepId)) r.add("duplicate_id", path, `The proposal names step ${s.stepId} twice.`);
          seedSteps.add(s.stepId);
        });
      });
      return;
    }
    case "reassign":
    case "leveling":
      unique(
        p.moves.map((m) => m.taskId),
        (i) => ["proposal", "moves", i, "taskId"],
        "task",
      );
      return;
    case "estimates":
      unique(
        p.items.map((m) => m.taskId),
        (i) => ["proposal", "items", i, "taskId"],
        "task",
      );
      return;
  }
}

/** P9: every proposal target exists; steps and estimates go only to tasks, never milestones */
function checkProposalTargets(doc: ProjectDoc, taskIds: ReadonlySet<string>, r: Report): void {
  const p = doc.proposal;
  if (!p) return;
  const task = (id: TaskId): Task | undefined => (Object.hasOwn(doc.tasks, id) ? doc.tasks[id] : undefined);
  const missing = (id: TaskId, path: (string | number)[]) => r.add("proposal_target", path, `The proposal targets ${id}, which isn't in the project.`);
  switch (p.kind) {
    case "subtasks": {
      const target = task(p.taskId);
      if (!target) missing(p.taskId, ["proposal", "taskId"]);
      else if (target.kind !== "task") r.add("proposal_target", ["proposal", "taskId"], `Steps are proposed for ${p.taskId}, a milestone.`);
      return;
    }
    case "reassign":
    case "leveling":
      p.moves.forEach((m, i) => {
        if (!task(m.taskId)) missing(m.taskId, ["proposal", "moves", i, "taskId"]);
      });
      return;
    case "estimates":
      p.items.forEach((item, i) => {
        const target = task(item.taskId);
        if (!target) missing(item.taskId, ["proposal", "items", i, "taskId"]);
        else if (target.kind !== "task") {
          r.add("proposal_target", ["proposal", "items", i, "taskId"], `An estimate is proposed for ${item.taskId}, a milestone.`);
        }
      });
      return;
    case "plan": {
      // A seed waits on an earlier seed of the same plan, or on a task that exists
      const earlier = new Set<string>();
      p.tasks.forEach((seed, i) => {
        seed.dependsOn.forEach((d, j) => {
          if (!earlier.has(d) && !taskIds.has(d)) {
            r.add("proposal_target", ["proposal", "tasks", i, "dependsOn", j], `Proposed task ${seed.taskId} waits on ${d}, which comes later or doesn't exist.`);
          }
        });
        earlier.add(seed.taskId);
      });
      return;
    }
  }
}

/* ------------------------------------------------------------------
   Workspace
   ------------------------------------------------------------------ */

/** Every workspace invariant (plan §3.8, W1–W4, plus the document size); empty for a valid document */
export function checkWorkspace(doc: WorkspaceDoc): Violation[] {
  const r = new Report();
  const people = entries(doc.people);
  const templates = entries(doc.templates);
  const closures = entries(doc.closures);
  const projects = entries(doc.projects);

  // W1: record keys equal ids; counts
  const keyed = <T extends { id: string }>(list: [string, T][], path: (string | number)[], what: string) => {
    for (const [key, value] of list) {
      if (key !== value.id) r.add("record_key", [...path, key, "id"], `${what} ${value.id} is stored under ${key}.`);
    }
  };
  keyed(people, ["people"], "Person");
  keyed(templates, ["templates"], "Template");
  keyed(closures, ["closures"], "Closure");
  keyed(projects, ["projects"], "Project");
  for (const [key, p] of people) {
    const timeOff = entries(p.timeOff);
    keyed(timeOff, ["people", key, "timeOff"], "Time off");
    if (timeOff.length > TIME_OFF_MAX) {
      r.add("too_many", ["people", key, "timeOff"], `${p.id} has ${timeOff.length} time-off entries: at most ${TIME_OFF_MAX}.`);
    }
  }
  const limit = (count: number, max: number, path: string, what: string) => {
    if (count > max) r.add("too_many", [path], `${count} ${what}: a workspace holds at most ${max}.`);
  };
  limit(people.length, PEOPLE_MAX, "people", "people");
  limit(templates.length, TEMPLATES_MAX, "templates", "templates");
  limit(closures.length, CLOSURES_MAX, "closures", "closures");
  limit(projects.length, PROJECTS_MAX, "projects", "projects");

  // W2: active names unique (case-insensitive); one person per account
  const names = new Map<string, string>();
  const users = new Map<string, string>();
  for (const [key, p] of people) {
    if (!p.archived) {
      const name = p.name.trim().toLowerCase();
      const other = names.get(name);
      if (other !== undefined) r.add("duplicate_name", ["people", key, "name"], `${other} and ${p.id} are both called ${p.name}.`);
      else names.set(name, p.id);
    }
    if (p.userId !== null) {
      const other = users.get(p.userId);
      if (other !== undefined) r.add("duplicate_user", ["people", key, "userId"], `${other} and ${p.id} are linked to the same account.`);
      else users.set(p.userId, p.id);
    }
  }

  // W3: unique person order keys; working days in order; ranges forwards
  const orders = new Map<string, string>();
  for (const [key, p] of people) {
    const other = orders.get(p.order);
    if (other !== undefined) r.add("duplicate_order", ["people", key, "order"], `Order key ${p.order} is used by ${other} and ${p.id}.`);
    else orders.set(p.order, p.id);
  }
  if (!isSortedUnique(doc.workingDays)) r.add("working_days", ["workingDays"], "Working days are listed in order, once each.");
  for (const [key, c] of closures) if (backwards(c)) r.add("range_order", ["closures", key], `Closure ${c.id} ends before it starts.`);
  for (const [key, p] of people) {
    for (const [offKey, off] of entries(p.timeOff)) {
      if (backwards(off)) r.add("range_order", ["people", key, "timeOff", offKey], `Time off ${off.id} ends before it starts.`);
    }
  }

  // W4: templates
  for (const [key, t] of templates) checkTemplate(t, ["templates", key], r);

  // Every document stays within the size limit (plan §1.2)
  const bytes = docBytes(doc);
  if (bytes > DOC_BYTES_MAX) r.add("doc_size", [], `The workspace is ${bytes} bytes: a document holds at most ${DOC_BYTES_MAX}.`);

  return r.out;
}

/**
 * W4: each task depends only on earlier tasks, once each; a milestone has estimate 0 and no
 * steps; a task's estimate is null or at least half a day. The template's tasks become seeds, so
 * they follow the same rules as the tasks they create.
 */
function checkTemplate(template: { readonly tasks: readonly TemplateTask[] }, path: (string | number)[], r: Report): void {
  template.tasks.forEach((t, i) => {
    t.dependsOn.forEach((d, j) => {
      if (d >= i) {
        r.add("template_dependency", [...path, "tasks", i, "dependsOn", j], `Template task ${i} depends on task ${d}: only earlier tasks.`);
      }
    });
    for (const j of repeats(t.dependsOn)) {
      r.add("duplicate_dependency", [...path, "tasks", i, "dependsOn", j], `Template task ${i} depends on task ${t.dependsOn[j]} twice.`);
    }
    if (t.kind === "milestone" && (t.estimateDays !== 0 || t.steps.length > 0)) {
      r.add("milestone", [...path, "tasks", i], `Template task ${i} is a milestone: estimate 0 and no steps.`);
    }
    if (t.kind === "task" && t.estimateDays === 0) {
      r.add("estimate", [...path, "tasks", i, "estimateDays"], `Template task ${i}: an estimate is null or at least half a day.`);
    }
  });
}

/** The template rules alone (W4), for templates that are code: the built-in starters */
export function checkTemplateTasks(template: { readonly tasks: readonly TemplateTask[] }): Violation[] {
  const r = new Report();
  checkTemplate(template, [], r);
  return r.out;
}

/* ------------------------------------------------------------------
   Across documents, at read time (Q7)
   ------------------------------------------------------------------ */

/** A person named by a project: the person, or why they don't count */
export type Resolved = Person | "archived" | "missing";

/** Resolves a person id against the workspace. Archived people are shown as unassigned (Q7). */
export function resolvePerson(id: PersonId, ws: Pick<WorkspaceDoc, "people">): Resolved {
  if (!Object.hasOwn(ws.people, id)) return "missing";
  const person = ws.people[id];
  return person.archived ? "archived" : person;
}

/** A task's owner (null when unassigned); lead and members resolve the same way through `resolvePerson` */
export function resolveOwner(ownerId: PersonId | null, ws: Pick<WorkspaceDoc, "people">): Resolved | null {
  return ownerId === null ? null : resolvePerson(ownerId, ws);
}

/**
 * The cost derived from the owner's day rate, in project cents: estimate × day rate, rounded to
 * the cent. Null when the task has a manual cost (manual is never overwritten), no estimate, or
 * no owner with a day rate (missing and archived owners count as none).
 */
export function derivedCost(
  task: Pick<Task, "costCents" | "estimateDays" | "ownerId">,
  ws: Pick<WorkspaceDoc, "people">,
): Cents | null {
  if (task.costCents !== null || task.estimateDays === null) return null;
  const owner = resolveOwner(task.ownerId, ws);
  if (owner === null || typeof owner === "string" || owner.dayRateCents === null) return null;
  return Math.round(task.estimateDays * owner.dayRateCents);
}
