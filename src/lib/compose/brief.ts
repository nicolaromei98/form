import { plainText } from "@/lib/compose/brief-export";
import { resolveOwner } from "@/lib/domain/invariants/check";
import { SECTION_LABEL, SECTION_ORDER } from "@/lib/domain/labels";
import { sortedByOrder, sortedByZ } from "@/lib/domain/order";
import type { PersonId, TaskId } from "@/lib/domain/schema/ids";
import type { Audience, BriefSection as BriefSectionKey, IsoDate } from "@/lib/domain/schema/primitives";
import type { BriefLine as CustomLine, ProjectDoc, Task } from "@/lib/domain/schema/project";
import type { Person, WorkspaceDoc } from "@/lib/domain/schema/workspace";
import { FOCUS_WEIGHTS } from "@/lib/planning/focus.weights";
import { dateMode, fmtDate, fmtWorkingDays } from "@/lib/planning/format";
import type { ProjectPlan } from "@/lib/planning";
import type { LaneLoad } from "@/lib/planning/lanes";
import { taskRisk } from "@/lib/planning/risk";

/**
 * Status brief v2 (plan §6.9): the project as a short written update, composed only from the
 * documents and their plan. Nothing is invented: what FORM doesn't know (a sample or missing
 * start, missing durations, dates that wait on them, owners or costs) is listed as an open
 * question instead.
 *
 * It keeps v0's `Brief` type, section order, short-version rules and stable sentence ids, so the
 * user's rewrites, hides and added lines carry over:
 * - `head:status`, `head:focus`;
 * - `done:all | done:none`, `moving:<taskId> | moving:none`;
 * - `next:up | next:then | next:step | next:end`;
 * - `risks:deadline` (new), `risks:<taskId>`, `risks:load:<personId>`, `risks:none`;
 * - `questions:start | questions:unsized | questions:unknown (new) | questions:owners | questions:costs`.
 *
 * Every figure comes from the plan, so the brief never disagrees with another view (ED-5):
 * - `next:end` is the schedule's end on working days ("On the sample schedule, the last task
 *   ends 26 Oct.");
 * - risks use only risk phrases: urgent, late, due soon, a task planned past its due date, and
 *   the project deadline. A sample schedule is never late, so "UI Design is urgent.";
 * - load lines read the Team lane's `over` ("Marta is 4 days over capacity.");
 * - "starts after" names the unfinished task the next one waits on (its dependencies), not the
 *   task before it in workflow order.
 *
 * Every composed sentence has a stable id, so the user can rewrite, hide or add lines on top of
 * it. An edit keeps the composed wording it replaced (its basis): when the data moves on, the line
 * is flagged as stale instead of silently keeping an outdated claim.
 *
 * Cost: O(V log V) for the workflow sort, then O(V + E + S + L + M log M) with no nested scans
 * (V tasks, E dependencies, S steps, L lines and lanes, M mood items). People and tasks are
 * indexed once; the plan's stages are memoised by document identity.
 */

/* ------------------------------------------------------------------
   Types (v0's, with v2 ids)
   ------------------------------------------------------------------ */

export type { Audience, BriefSectionKey };
export type Run = string | { readonly task: TaskId } | { readonly person: PersonId };
export type Sentence = readonly Run[];

export interface BriefLine {
  /** Composed sentence id ("risks:tsk_…"), or the id of a line the user added */
  id: string;
  /** Where an edit to this line is stored: "<audience>:<id>" (composed) or the line id (custom) */
  key: string;
  kind: "composed" | "custom";
  /** The composed runs, with entity mentions (custom lines: their text) */
  runs: Sentence;
  /** The composed wording as plain text ("" for custom lines) */
  composed: string;
  /** The user's wording, when they rewrote a composed line */
  edited: string | null;
  /** FORM's composed wording changed since the user rewrote it */
  stale: boolean;
}

export interface BriefSection {
  key: BriefSectionKey;
  label: string;
  lines: BriefLine[];
}

export interface Brief {
  /** Eyebrow segments ("Status", date, audience, sample): rendered so they can wrap between segments */
  eyebrow: string[];
  headline: BriefLine[];
  progress: number;
  sections: BriefSection[];
  /** Moodboard colours, shown as a palette strip at the foot */
  palette: string[];
  /** The user's changes for this audience: rewritten, hidden and added lines */
  changes: number;
  /** Edit keys of the composed lines the user hid in this audience */
  hidden: string[];
}

/** What the composer reads of a plan: a `ProjectPlan` fits */
export type BriefPlan = Pick<ProjectPlan, "project" | "schedule" | "risks" | "metrics" | "focus">;

export interface BriefInput {
  /** The project's plan; null when there is no project (the brief is then null, as in v0) */
  plan: BriefPlan | null;
  /** Owners and mentions resolve against its people (Q7: archived people read as unassigned) */
  ws: Pick<WorkspaceDoc, "people">;
  audience: Audience;
  /** The short version (plan §6.9: v0's rules) */
  short: boolean;
  /** The plan's day, in the workspace time zone: the eyebrow's date and the due-date phrases */
  today: IsoDate;
  /** The project's Team lanes (`laneLoads`); the team version reads their `over` */
  lanes: readonly Pick<LaneLoad, "personId" | "over">[];
}

/* ------------------------------------------------------------------
   Wording helpers
   ------------------------------------------------------------------ */

const days = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} ${n === 1 ? "day" : "days"}`;
const mention = (t: Pick<Task, "id">): Run => ({ task: t.id });

/** "A", "A and B", "A, B and C" */
function list(tasks: readonly Pick<Task, "id">[]): Run[] {
  const out: Run[] = [];
  tasks.forEach((t, i) => {
    if (i > 0) out.push(i === tasks.length - 1 ? " and " : ", ");
    out.push(mention(t));
  });
  return out;
}
const verb = (items: readonly unknown[], one: string, many: string) => (items.length > 1 ? many : one);

type Draft = { id: string; runs: Run[] };

interface Drafted {
  headline: Draft[];
  sections: Partial<Record<BriefSectionKey, Draft[]>>;
  bar: number;
  sample: boolean;
}

/** A risk phrase of a task, with the points that rank it (FOCUS_WEIGHTS, as Focus ranks reasons) */
interface Phrase {
  points: number;
  text: string;
}

/* ------------------------------------------------------------------
   The draft: the brief as FORM composes it, before the user's edits
   ------------------------------------------------------------------ */

function draft(plan: BriefPlan, input: BriefInput): Drafted {
  const { ws, audience, today, lanes } = input;
  const project = plan.project;
  const tasks = project.tasks;
  const team = audience === "team";
  const sched = plan.schedule;
  const mode = dateMode(sched.anchor, "demo");
  const sample = mode === "sample";
  const w = FOCUS_WEIGHTS;

  // Workflow order, indexed once; every list below keeps it
  const all = sortedByOrder(tasks);
  const open: Task[] = [];
  const done: Task[] = [];
  const review: Task[] = [];
  const active: Task[] = [];
  const todo: Task[] = [];
  const position = new Map<TaskId, number>();
  all.forEach((t, i) => {
    position.set(t.id, i);
    if (t.status !== "done") open.push(t);
    if (t.status === "done") done.push(t);
    else if (t.status === "review") review.push(t);
    else if (t.status === "active") active.push(t);
    else todo.push(t);
  });

  /** The owner when they resolve to an active person (Q7) */
  const ownerOf = (t: Task): Person | null => {
    const owner = resolveOwner(t.ownerId, ws);
    return owner === null || typeof owner === "string" ? null : owner;
  };
  // The team version says who; the client version keeps names inside the studio
  const withOwner = (t: Task): Run[] => {
    const p = team ? ownerOf(t) : null;
    return p ? [", with ", { person: p.id }] : [];
  };

  /* Headline: where the whole project stands, then the one thing to look at.
     The wording follows the statuses; the number never claims 100% while work is open */
  const m = plan.metrics;
  const untouched = all.every((t) => t.status === "todo" && t.progress === 0);
  const pct = open.length ? Math.min(m.completePct, 99) : 100;
  // When nothing left open carries a duration, the weighted percentage can't see it: count tasks instead
  const unweighable = open.length > 0 && open.every((t) => t.kind === "milestone" || t.estimateDays === null);
  const first: Run[] = !all.length
    ? [`${project.title} has no tasks yet.`]
    : !open.length
      ? [`${project.title} is complete.`]
      : untouched
        ? [`${project.title} hasn't started yet.`]
        : unweighable
          ? [`${done.length} of ${all.length} tasks are done.`]
          : pct === 0
            ? [`${project.title} is under way.`]
            : [`${project.title} is ${pct}% done.`];

  const pick = plan.focus.pick;
  const picked = pick !== null && Object.hasOwn(tasks, pick.taskId) ? tasks[pick.taskId] : null;
  const firstTodo = todo[0] ?? null;
  const second: Run[] =
    pick === null || picked === null
      ? [all.length ? "Everything has been delivered." : "Add tasks to start the brief."]
      : pick.reasons.some((r) => r.risk)
        ? [mention(picked), " is the one to watch."]
        : picked.status === "active"
          ? [mention(picked), " is where the work is."]
          : picked.status === "review"
            ? [mention(picked), " is waiting on review."]
            : picked.id === firstTodo?.id
              ? [mention(picked), " is up next."]
              : [mention(picked), " is the priority."];

  const sections: Partial<Record<BriefSectionKey, Draft[]>> = {};

  sections.done = [
    done.length ? { id: "done:all", runs: [...list(done), verb(done, " is done.", " are done.")] } : { id: "done:none", runs: ["Nothing is finished yet."] },
  ];

  const moving: Draft[] = [
    ...review.map((t): Draft => ({ id: `moving:${t.id}`, runs: [mention(t), " is in review", ...withOwner(t), "."] })),
    ...active.map((t): Draft => ({ id: `moving:${t.id}`, runs: [mention(t), t.progress > 0 ? ` is ${t.progress}% in` : " has started", ...withOwner(t), "."] })),
  ];
  sections.moving = moving.length ? moving : [{ id: "moving:none", runs: ["Nothing is in progress right now."] }];

  const next: Draft[] = [];
  if (firstTodo !== null) {
    const up = firstTodo;
    const after = gateOf(up, project, plan, position);
    next.push({
      id: "next:up",
      runs: [
        mention(up),
        ...(after ? [" starts after ", mention(after)] : [" is next"]),
        ...(up.kind !== "milestone" && up.estimateDays !== null ? [`, about ${days(up.estimateDays)} of work`] : []),
        ...withOwner(up),
        ".",
      ],
    });
    if (todo.length > 1) next.push({ id: "next:then", runs: ["Then ", ...list(todo.slice(1)), "."] });
  }
  if (picked !== null && pick?.nextStepId) {
    const step = picked.steps.find((s) => s.id === pick.nextStepId);
    if (step) next.push({ id: "next:step", runs: ["Next step on ", mention(picked), `: ${step.title}.`] });
  }
  // The planned end, on working days (ED-5). Without a date (no start at all) there is nothing to state.
  const end = sched.end;
  let leftOut = 0;
  let leftOutUnsized = true;
  for (const t of open) {
    const timing = sched.timings.get(t.id);
    if (timing?.kind === "scheduled") continue;
    leftOut++;
    if (timing?.reason !== "noEstimate") leftOutUnsized = false;
  }
  if (end !== null && end.date !== null && leftOut < open.length) {
    const past = end.date < today;
    const where = sample ? "On the sample schedule, " : "";
    const what = leftOut > 0 ? "scheduled work" : "the last task";
    // v0's words while every task left out lacks a duration; tasks that wait on one have a duration but no dates
    const rest = leftOut === 0 ? "" : leftOutUnsized ? ", leaving out tasks with no duration" : ", leaving out tasks without dates";
    const line = `${where}${what} ${past ? "was planned to end" : "ends"} ${fmtDate(end.date)}${rest}.`;
    next.push({ id: "next:end", runs: [line.charAt(0).toUpperCase() + line.slice(1)] });
  }
  if (next.length) sections.next = next;

  const risks: Draft[] = [];
  const deadline = plan.risks.deadline;
  if (deadline !== null) risks.push({ id: "risks:deadline", runs: [deadline.sentence] });
  for (const t of open) {
    const phrases: Phrase[] = [];
    if (t.priority === "urgent") phrases.push({ points: w.priority.urgent, text: "urgent" });
    const risk = taskRisk(plan.risks, t.id);
    if (risk.late !== null) phrases.push({ points: w.late + Math.min(w.lateMax, w.latePerDay * risk.late), text: `late by ${fmtWorkingDays(risk.late)}` });
    if (risk.dueSoon && t.dueDate !== null) {
      const text = t.dueDate < today ? "past due" : t.dueDate === today ? "due today" : `due ${fmtDate(t.dueDate)}`;
      phrases.push({ points: w.dueSoon, text });
    }
    if (risk.dueRisk !== null) phrases.push({ points: 0, text: `planned to end ${fmtWorkingDays(risk.dueRisk)} after its due date` });
    if (!phrases.length) continue;
    // Strongest first; equal points keep the order above (Focus's reason order). Array sort is stable.
    phrases.sort((a, b) => b.points - a.points);
    const said = phrases.slice(0, 2).map((p) => p.text);
    risks.push({ id: `risks:${t.id}`, runs: [mention(t), ` is ${said.join(" and ")}.`] });
  }
  if (team) {
    for (const l of lanes) {
      if (l.personId === null || l.over === null || !(l.over > 0) || !Object.hasOwn(ws.people, l.personId)) continue;
      risks.push({ id: `risks:load:${l.personId}`, runs: [{ person: l.personId }, ` is ${days(l.over)} over capacity.`] });
    }
  }
  sections.risks = risks.length ? risks : [{ id: "risks:none", runs: ["No risks flagged."] }];

  // Gaps are stated, never filled in
  const questions: Draft[] = [];
  if (sched.anchor.mode !== "absolute") {
    const text = team
      ? project.startDate === null
        ? "There is no start date yet: set one to make the dates real."
        : "The start date is still the sample date: confirm it to make the dates real."
      : "Dates are indicative until the start date is confirmed.";
    questions.push({ id: "questions:start", runs: [text] });
  }
  const unsized = open.filter((t) => t.kind !== "milestone" && t.estimateDays === null);
  if (unsized.length) {
    questions.push({
      id: "questions:unsized",
      runs: [
        ...list(unsized),
        verb(unsized, " has no duration yet, so it isn't in the dates or the percentage.", " have no duration yet, so they aren't in the dates or the percentage."),
      ],
    });
  }
  // Open tasks with a duration that wait on a task without one (ED-1: "Needs UI Design's estimate")
  const waiting: Task[] = [];
  const roots = new Set<TaskId>();
  for (const t of open) {
    const timing = sched.timings.get(t.id);
    if (timing?.kind !== "unknown" || timing.reason !== "waitsOn") continue;
    const root = sched.timings.get(timing.cause);
    if (root?.kind !== "unknown" || root.reason !== "noEstimate" || !Object.hasOwn(tasks, timing.cause)) continue;
    waiting.push(t);
    roots.add(timing.cause);
  }
  if (waiting.length) {
    const causes = [...roots].map((id) => tasks[id]).sort((a, b) => position.get(a.id)! - position.get(b.id)!);
    questions.push({
      id: "questions:unknown",
      runs: [...list(waiting), verb(waiting, " has no dates until ", " have no dates until "), ...list(causes), verb(causes, " has a duration.", " have durations.")],
    });
  }
  if (team) {
    // v0 asks only once there is a team to give the work to
    const anyone = Object.values(ws.people).some((p) => !p.archived);
    const unowned = anyone ?open.filter((t) => t.kind !== "milestone" && ownerOf(t) === null) : [];
    if (unowned.length) questions.push({ id: "questions:owners", runs: [...list(unowned), verb(unowned, " has no owner.", " have no owner.")] });
    // Milestones carry no work, so no cost; a cost derived from the owner's day rate counts as known
    let workItems = 0;
    for (const t of all) if (t.kind !== "milestone") workItems++;
    const costed = workItems - m.budget.withoutCost.length;
    if (workItems && costed < workItems) {
      questions.push({
        id: "questions:costs",
        runs: [costed ? `Costs are known for ${costed} of ${workItems} ${workItems === 1 ? "task" : "tasks"}.` : "No costs have been estimated yet."],
      });
    }
  }
  if (questions.length) sections.questions = questions;

  const bar = !all.length || untouched ? 0 : !open.length ? 100 : unweighable ? Math.round((done.length / all.length) * 100) : pct;
  return { headline: [{ id: "head:status", runs: first }, { id: "head:focus", runs: second }], sections, bar, sample };
}

/**
 * The unfinished task `up` waits on that ends last ("Development starts after UI Design"), or
 * null when nothing it depends on is open. A predecessor without dates ends last of all; equal
 * ends go to the later one in workflow order.
 */
function gateOf(up: Task, project: Pick<ProjectDoc, "tasks">, plan: BriefPlan, position: ReadonlyMap<TaskId, number>): Task | null {
  let gate: Task | null = null;
  let gateEnd = Number.NEGATIVE_INFINITY;
  let gateAt = -1;
  for (const id of up.dependsOn) {
    if (!Object.hasOwn(project.tasks, id)) continue;
    const p = project.tasks[id];
    if (p.status === "done") continue;
    const timing = plan.schedule.timings.get(id);
    const end = timing?.kind === "scheduled" ? timing.finish : Number.POSITIVE_INFINITY;
    const at = position.get(id) ?? -1;
    if (end > gateEnd || (end === gateEnd && at > gateAt)) {
      gate = p;
      gateEnd = end;
      gateAt = at;
    }
  }
  return gate;
}

/* ------------------------------------------------------------------
   The brief
   ------------------------------------------------------------------ */

/**
 * The status brief for one audience, with the user's edits on top: rewritten lines, hidden lines
 * and the lines they added. Null when there is no project.
 */
export function composeBrief(input: BriefInput): Brief | null {
  const { plan, ws, audience, short, today } = input;
  if (plan === null) return null;
  const project = plan.project;
  const d = draft(plan, input);
  const edits = project.brief.edits;
  const hidden: string[] = [];
  let applied = 0;

  // The composed sentence with the user's edit on top; null when they hid it
  const compose = (x: Draft): BriefLine | null => {
    const key = `${audience}:${x.id}`;
    const composed = plainText(x.runs, project, ws);
    const e = Object.hasOwn(edits, key) ? edits[key] : undefined;
    if (e && !e.text) {
      // A hide holds only while FORM would say the same thing: a new fact in that slot shows up
      if (e.basis !== composed) return { id: x.id, key, kind: "composed", runs: x.runs, composed, edited: null, stale: false };
      hidden.push(key);
      applied++;
      return null;
    }
    if (e) applied++;
    return { id: x.id, key, kind: "composed", runs: x.runs, composed, edited: e ? e.text : null, stale: !!e && e.basis !== composed };
  };

  // The user's own lines for this audience, by section
  const custom = new Map<BriefSectionKey, CustomLine[]>();
  let customCount = 0;
  for (const l of project.brief.lines) {
    if (l.audience !== audience) continue;
    customCount++;
    const bucket = custom.get(l.section);
    if (bucket) bucket.push(l);
    else custom.set(l.section, [l]);
  }

  const sections: BriefSection[] = [];
  for (const key of SECTION_ORDER) {
    // The short version keeps what's moving, what's next, what could go wrong and what isn't known —
    // never figures without the gaps behind them — plus everything the user wrote themselves
    const drafts = d.sections[key] ?? [];
    const composedLines = short && key === "done" ? [] : drafts.map(compose).filter((l): l is BriefLine => l !== null);
    const lines: BriefLine[] = [
      ...(short ? composedLines.slice(0, 2) : composedLines),
      ...(custom.get(key) ?? []).map((l): BriefLine => ({ id: l.id, key: l.id, kind: "custom", runs: [l.text], composed: "", edited: null, stale: false })),
    ];
    if (lines.length || (key !== "note" && !(short && key === "done") && drafts.length)) sections.push({ key, label: SECTION_LABEL[key], lines });
  }

  const headline = d.headline.map(compose).filter((l): l is BriefLine => l !== null);
  const eyebrow = ["Status", fmtDate(today), audience === "team" ? "For the team" : "For the client", ...(d.sample ? ["Sample schedule"] : [])];
  const palette: string[] = [];
  for (const item of sortedByZ(project.moodboard.items)) {
    if (palette.length === 8) break;
    if (item.kind === "color" && item.hex) palette.push(item.hex);
  }
  // Only what is on the page: edits to sentences FORM no longer writes stay dormant until they come back
  const changes = applied + customCount;

  return { eyebrow, headline, progress: d.bar, sections, palette, changes, hidden };
}
