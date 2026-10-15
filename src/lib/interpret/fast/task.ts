import { CENTS_MAX, ESTIMATE_MAX_DAYS, STEP_TITLE, TASK_TITLE } from "@/lib/domain/limits";
import type { Priority, Status } from "@/lib/domain/schema/primitives";
import type { ProjectDoc } from "@/lib/domain/schema/project";
import { clarify, type Collector, type FamilyResult, type FastContext } from "@/lib/interpret/fast/context";
import { type Command, lineOf, parseAmount, parseDays, type Target, targetTitle, toHalfDays } from "@/lib/interpret/fast/match";
import { showHome } from "@/lib/interpret/fast/view";
import { makeOp, type Op, updateTaskOp } from "@/lib/ops/build";

/**
 * Task edits (plan §8.4 step 13), ported from v0: the target is the longest task or step title
 * named, else the selected task unless the sentence is plural. A breakdown returns early; the
 * other edits accumulate (rename, status, priority, emphasis, estimate, progress, cost, a new
 * step, removal) and the workspace rules run after them.
 *
 * A v0 multi-field update becomes one op per field, in the plan §4.5 order: title, priority,
 * estimate, cost, emphasis, progress, status (status last, so it wins). A step takes its title,
 * done (status Done) and estimate; v0's other step fields don't exist in v2 and are dropped.
 */

export const PLURAL = /\b(ones|tasks|cards|items|all|everything|them|these|those|rows|bars)\b/;

const WANTS_BREAKDOWN = (s: string) =>
  (/\b(break|split|divide|decompose|chunk)\b/.test(s) && /\b(down|up|into|smaller|steps?|subtasks?|parts|pieces|chunks)\b/.test(s)) ||
  /\b(sub-?tasks|smaller steps|steps for)\b/.test(s);

/** "Break this task into smaller steps": the /demo library proposes steps that add up to its estimate */
export function breakdown(s: string, ctx: FastContext, project: ProjectDoc, target: Target | null, c: Collector): FamilyResult | null {
  if (!WANTS_BREAKDOWN(s)) return null;
  if (!target) return clarify("Select a task first — click its number badge — then ask again.");
  if (target.kind === "step") return clarify("Steps can't be nested further in this build.");
  const items = ctx.breakdown(target.task).map((step) => ({ stepId: ctx.mint("step"), title: lineOf(step.title, STEP_TITLE), estimateDays: step.estimateDays }));
  // The brief and the team view don't show proposals: bring the tasks back so the steps can be reviewed
  if (ctx.local.activeView === "brief" || ctx.local.activeView === "team") showHome(c, project);
  c.op(makeOp({ op: "proposeSubtasks", proposalId: ctx.mint("proposal"), taskId: target.task.id, items, source: "parser" }));
  return c.result("keyword");
}

/** What the entity rules did, for the workspace rules that follow */
export interface EntityOutcome {
  /** v0 `entityHandled`: an edit, a new step or a removal was found */
  handled: boolean;
  /** An early answer (the cost clarify) */
  early: FamilyResult | null;
}

/** The accumulating task edits on a target (v0 lines 175–267) */
export function entityEdits(cmd: Command, ctx: FastContext, target: Target, named: boolean, c: Collector): EntityOutcome {
  const { clean, s } = cmd;
  const fields: {
    title?: string;
    status?: Status;
    priority?: Priority;
    emphasis?: boolean;
    estimateDays?: number;
    progress?: number;
    costCents?: number;
  } = {};

  // Rename
  const rename = clean.match(/\b(?:rename|retitle)\b.*?\bto\s+"?([^"]+?)"?$/i) ?? clean.match(/\bcall (?:it|this|that)\s+"?([^"]+?)"?$/i);
  if (rename) fields.title = lineOf(rename[1], target.kind === "task" ? TASK_TITLE : STEP_TITLE);

  // Status
  const statusVerb = /\b(mark|set|move|change|make|put|flag|is|it's)\b/.test(s) || /^(complete|finish|start|reopen)\b/.test(s);
  if (!rename && statusVerb) {
    if (/\b(done|complete(d)?|finished|closed)\b/.test(s) || /^(complete|finish)\b/.test(s)) fields.status = "done";
    else if (/\b(in review|review|for review)\b/.test(s)) fields.status = "review";
    else if (/\b(in progress|started|active|working on|doing|ongoing)\b/.test(s) || /^start\b/.test(s)) fields.status = "active";
    else if (/\b(to ?do|not started|backlog)\b/.test(s) || /^reopen\b/.test(s)) fields.status = "todo";
  }

  // Priority
  let priority: Priority | null = null;
  if (/\b(make|mark|set|flag)\b/.test(s) && /\b(urgent|critical|asap)\b/.test(s) && !/\bhighlight\b/.test(s)) priority = "urgent";
  const word = s.match(/\b(high|low|medium|normal)\s+priority\b/) ?? s.match(/\bpriority\s+(?:to\s+)?(high|low|medium|normal|urgent)\b/);
  if (word) priority = (word[1] === "normal" ? "medium" : word[1]) as Priority;
  if (priority) fields.priority = priority;

  // Emphasis
  if (/\b(less prominent|de-?emphasi[sz]e|unpin|remove (the )?(emphasis|prominence))\b/.test(s)) fields.emphasis = false;
  else if (/\b(prominent|stand out|emphasi[sz]e|bigger|larger|feature|spotlight|pin)\b/.test(s) || /\bhighlight (this|it|that)\b/.test(s)) fields.emphasis = true;

  // Estimate: "N weeks" is N × 5 working days (plan §1.3)
  const days = parseDays(s);
  if (days !== null && /\b(estimate|takes?|duration|will take|lasts?|long|set|make|change)\b/.test(s)) {
    fields.estimateDays = Math.min(ESTIMATE_MAX_DAYS, Math.max(0.5, toHalfDays(days)));
  }

  // Progress
  const pct = s.match(/\b(\d{1,3})\s*%/);
  if (pct && !/\bcost\b/.test(s)) fields.progress = Math.min(100, parseInt(pct[1], 10));
  else if (/\bhalf ?way\b/.test(s)) fields.progress = 50;

  // Cost — never invented
  if (/\b(cost|price|spend|budget)\b/.test(s)) {
    const amount = parseAmount(s);
    if (amount == null) {
      return { handled: false, early: clarify(`FORM won't invent a cost for ${targetTitle(target)}. Give an amount — e.g. 'set the cost to €2,400'.`) };
    }
    // The project's currency, in cents (plan §1.2)
    fields.costCents = Math.min(CENTS_MAX, amount * 100);
  }

  let handled = false;
  const edits: Op[] = [];
  if (target.kind === "task") {
    const id = target.task.id;
    if (fields.title !== undefined) edits.push(updateTaskOp(id, "title", fields.title));
    if (fields.priority !== undefined) edits.push(updateTaskOp(id, "priority", fields.priority));
    if (fields.estimateDays !== undefined) edits.push(updateTaskOp(id, "estimateDays", fields.estimateDays));
    if (fields.costCents !== undefined) edits.push(updateTaskOp(id, "costCents", fields.costCents));
    if (fields.emphasis !== undefined) edits.push(updateTaskOp(id, "emphasis", fields.emphasis));
    if (fields.progress !== undefined) edits.push(updateTaskOp(id, "progress", fields.progress));
    if (fields.status !== undefined) edits.push(updateTaskOp(id, "status", fields.status));
  } else {
    const ref = { op: "updateStep", taskId: target.task.id, stepId: target.step.id } as const;
    if (fields.title !== undefined) edits.push(makeOp({ ...ref, field: "title", value: fields.title }));
    if (fields.status !== undefined) edits.push(makeOp({ ...ref, field: "done", value: fields.status === "done" }));
    if (fields.estimateDays !== undefined) edits.push(makeOp({ ...ref, field: "estimateDays", value: fields.estimateDays }));
  }
  // v0 counted any field of the patch, the ones a step drops included
  if (Object.keys(fields).length) {
    c.op(...edits);
    handled = true;
  }

  // A new step
  const sub = clean.match(/\badd (?:a |an |another )?(?:sub-?task|step)\b(?:\s+(?:called|named|for))?\s*:?\s*"?([^"]*)"?$/i);
  if (sub && target.kind === "task") {
    c.op(makeOp({ op: "addStep", taskId: target.task.id, stepId: ctx.mint("step"), title: lineOf(sub[1] || "New step", STEP_TITLE), estimateDays: null, after: "end" }));
    handled = true;
  }

  // Remove
  if (/\b(delete|remove)\b/.test(s) && (/\b(this|it|task)\b/.test(s) || named) && !/\b(completed|done|highlight|emphasis|metrics|progress)\b/.test(s)) {
    c.op(target.kind === "task" ? makeOp({ op: "removeTask", taskId: target.task.id }) : makeOp({ op: "removeStep", taskId: target.task.id, stepId: target.step.id }));
    handled = true;
  }
  return { handled, early: null };
}

/** v0's "I understood you mean UI Design, but not the change" */
export function notUnderstood(target: Target | null, s: string): string {
  return target && /\b(this|it)\b/.test(s)
    ? `I understood you mean ${targetTitle(target)}, but not the change. Try 'break this into smaller steps', 'mark it done' or 'make this more prominent'.`
    : "Demo mode doesn't understand that yet. It handles views, layout, sorting, filtering and task edits.";
}
