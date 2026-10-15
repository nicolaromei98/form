import { z } from "zod";
import { MEMBERS_MAX } from "@/lib/domain/limits";
import { compareKeys } from "@/lib/domain/order";
import { type PersonId, type StepId, TaskId } from "@/lib/domain/schema/ids";
import type { Link } from "@/lib/domain/schema/primitives";
import type { ProjectDoc, Step, Task } from "@/lib/domain/schema/project";
import { isRejection, type Rejection, reject } from "@/lib/ops/registry/_contract";
import { mustTask, title } from "@/lib/ops/registry/_helpers";

/**
 * Helpers private to the step 10a ops (tasks, steps, dependencies, pins, assignment, links,
 * members, updateProject, rebalanceOrder; `registry/README.md`). Only those op files import this
 * module, and they never import each other.
 */

/* ------------------------------------------------------------------
   Members
   ------------------------------------------------------------------ */

/**
 * Puts a person in the project's members when they aren't there yet: whoever owns or leads work
 * in a project is part of it (FORM-v1 §3, "l'owner di un task entra automaticamente"). Refuses
 * with `limit` past MEMBERS_MAX. Writes nothing when the person is already a member.
 */
export function ensureMember(d: ProjectDoc, personId: PersonId): Rejection | void {
  if (d.memberIds.includes(personId)) return;
  if (d.memberIds.length >= MEMBERS_MAX) return reject("limit", `A project has at most ${MEMBERS_MAX} members.`);
  d.memberIds.push(personId);
}

/* ------------------------------------------------------------------
   Steps
   ------------------------------------------------------------------ */

export const stepGone = (task: Task) => `That step isn't in ${title(task.title)} anymore.`;

/** The index of a step in its task, or -1 */
export function stepIndex(task: Task, stepId: StepId): number {
  return task.steps.findIndex((s) => s.id === stepId);
}

/** The step a caption names, before or after the op */
export function stepOf(doc: ProjectDoc, taskId: TaskId, stepId: StepId): Step | undefined {
  return Object.hasOwn(doc.tasks, taskId) ? doc.tasks[taskId].steps.find((s) => s.id === stepId) : undefined;
}

/** A task and one of its steps, or `not_found` */
export function mustTaskAndStep(d: ProjectDoc, taskId: TaskId, stepId: StepId): { task: Task; index: number } | Rejection {
  const task = mustTask(d, taskId);
  if (isRejection(task)) return task;
  const index = stepIndex(task, stepId);
  return index < 0 ? reject("not_found", stepGone(task)) : { task, index };
}

/** Caption keys of step edits: a later edit of the same field replaces the earlier part */
export const stepKey = (stepId: StepId, field: string) => `step:${stepId}:${field}`;

/* ------------------------------------------------------------------
   Brief edits
   ------------------------------------------------------------------ */

/** Whether a brief edit key ("client:risks:tsk_…") names one of the ids in its sentence id */
const namesAny = (key: string, ids: ReadonlySet<string>) => key.split(":").slice(1).some((segment) => ids.has(segment));

/**
 * Deletes the brief edits keyed to an entity that is going away (removeStep), in key order, so the
 * patches never depend on how the record was built. Undo restores them with the op.
 */
export function dropBriefEdits(d: ProjectDoc, base: ProjectDoc, ids: ReadonlySet<string>): void {
  for (const key of Object.keys(base.brief.edits).sort(compareKeys)) {
    if (namesAny(key, ids)) delete d.brief.edits[key];
  }
}

/* ------------------------------------------------------------------
   Links
   ------------------------------------------------------------------ */

/** Where a link lives: on the project, or on one of its tasks */
export const LinkTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project") }).strict(),
  z.object({ kind: z.literal("task"), taskId: TaskId }).strict(),
]);
export type LinkTarget = z.infer<typeof LinkTarget>;

/** The object that holds the target's links (the project or the task), or `not_found` */
export function linkHolder(d: ProjectDoc, target: LinkTarget): { links: Link[] } | Rejection {
  return target.kind === "project" ? d : mustTask(d, target.taskId);
}

/** "the project" or the task's title, for captions and messages */
export function targetName(doc: ProjectDoc, target: LinkTarget): string {
  if (target.kind === "project") return "the project";
  return Object.hasOwn(doc.tasks, target.taskId) ? title(doc.tasks[target.taskId].title) : "that task";
}

/* ------------------------------------------------------------------
   Wording
   ------------------------------------------------------------------ */

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Working days as the calendar capsules read: runs of three or more as a range ("Mon–Fri"), the
 * rest listed ("Mon, Wed, Fri"; "Mon–Thu, Sat"). Days are 1 (Monday) to 7, sorted and unique.
 */
export function weekdaysText(days: readonly number[]): string {
  const runs: string[] = [];
  let i = 0;
  while (i < days.length) {
    let j = i;
    while (j + 1 < days.length && days[j + 1] === days[j] + 1) j++;
    if (j - i >= 2) runs.push(`${WEEKDAYS[days[i] - 1]}–${WEEKDAYS[days[j] - 1]}`);
    else for (let k = i; k <= j; k++) runs.push(WEEKDAYS[days[k] - 1]);
    i = j + 1;
  }
  return runs.join(", ");
}

/** "1 task", "2 tasks" */
export const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
