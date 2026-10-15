import { descendantBits, successorMap } from "@/lib/domain/invariants/graph";
import { compareKeys, sortedByOrder } from "@/lib/domain/order";
import type { PersonId, ProjectId, StepId, TaskId } from "@/lib/domain/schema/ids";
import type { IsoDate, Priority } from "@/lib/domain/schema/primitives";
import type { ProjectDoc } from "@/lib/domain/schema/project";
import type { WorkCalendar } from "@/lib/planning/calendar";
import { FOCUS_WEIGHTS, type FocusWeights } from "@/lib/planning/focus.weights";
import { fmtDate, fmtWorkingDays } from "@/lib/planning/format";
import { RefCache, risksOf } from "@/lib/planning/memo";
import type { Risks } from "@/lib/planning/risk";
import { ordinalAfter, type Schedule } from "@/lib/planning/schedule";

/**
 * Focus v2 (plan §6.7, FORM-v1 §7.6): which task to work on now, and why. Deterministic and
 * explainable: every point a task scores comes from one weight in `focus.weights.ts`, with the
 * sentence that justifies it.
 *
 * - **Candidates** are open tasks (not Done). A To-do task with an unfinished predecessor is
 *   **blocked** and never FORM's pick (DECISIONS Q15: work already started is never hidden).
 * - **Pin.** A task the user pinned wins while it is open, blocked or not: it is their choice
 *   (`chosenBy: "you"`, v0 parity). FORM's own pick (`chosenBy: "form"`) is never blocked or Done.
 * - **Ranking:** score, then workflow order, then project creation order ("My focus" spans projects).
 * - **Why** joins the two highest reasons that have a phrase, strongest first: two adjectives with
 *   " and " ("Urgent and on the critical path."), a clause with "; " ("Urgent; Development waits
 *   on it.").
 *
 * Scores are O(V + E) per project plus the descendant bitsets (O((V+E)·V/32)); the ranking is
 * O(V log V).
 */

/* ------------------------------------------------------------------
   Types
   ------------------------------------------------------------------ */

export type FocusReasonKey = "priority" | "late" | "dueSoon" | "active" | "review" | "critical" | "waiting" | "tightFloat";

/** The fixed order of reasons with equal points */
export const FOCUS_REASON_ORDER: readonly FocusReasonKey[] = ["priority", "late", "dueSoon", "active", "review", "critical", "waiting", "tightFloat"];

export interface FocusReason {
  readonly key: FocusReasonKey;
  readonly points: number;
  /** The reason on its own: "Urgent priority", "In progress · 30%" */
  readonly text: string;
  /** The same reason inside the why sentence ("urgent"), or null when it is context only */
  readonly phrase: string | null;
  /** The phrase is a clause ("Development waits on it"), joined with "; " rather than " and " */
  readonly clause: boolean;
  /** A risk, not just context: the signal-red dot */
  readonly risk: boolean;
}

export interface FocusCandidate {
  readonly taskId: TaskId;
  readonly projectId: ProjectId;
  /** Σ points */
  readonly score: number;
  /** Highest points first; equal points in `FOCUS_REASON_ORDER` */
  readonly reasons: readonly FocusReason[];
  /** One sentence: "Urgent and on the critical path." */
  readonly why: string;
  /** The first step not done, when the task has steps */
  readonly nextStepId: StepId | null;
}

export interface FocusResult {
  /** The pinned task while it is open, else FORM's best; null when nothing is open */
  readonly pick: (FocusCandidate & { readonly chosenBy: "form" | "you" }) | null;
  /** Open, unblocked tasks in scope, best first */
  readonly ranked: readonly FocusCandidate[];
  /** To-do tasks in scope with an unfinished predecessor */
  readonly blocked: ReadonlySet<TaskId>;
}

/** What focus reads of a plan: a `ProjectPlan` fits */
export interface FocusPlan {
  readonly project: ProjectDoc;
  readonly calendar: WorkCalendar;
  readonly schedule: Schedule;
  readonly today: IsoDate;
}

export interface FocusOptions {
  today: IsoDate;
  /** The pinned task (`viewConfig.focusPin`) */
  pin?: TaskId | null;
  /** "My focus": only tasks this person owns */
  ownerId?: PersonId | null;
  /** Defaults to FOCUS_WEIGHTS */
  weights?: FocusWeights;
}

/* ------------------------------------------------------------------
   Reasons
   ------------------------------------------------------------------ */

const PRIORITY_TEXT: Readonly<Record<Priority, string>> = { urgent: "Urgent", high: "High", medium: "Medium", low: "Low" };
const PRIORITY_PHRASE: Readonly<Record<Priority, string | null>> = { urgent: "urgent", high: "high priority", medium: null, low: null };

const reason = (key: FocusReasonKey, points: number, text: string, phrase: string | null, clause = false, risk = false): FocusReason =>
  Object.freeze({ key, points, text, phrase, clause, risk });

const rankOf = (key: FocusReasonKey) => FOCUS_REASON_ORDER.indexOf(key);

function byPoints(a: FocusReason, b: FocusReason): number {
  return b.points - a.points || rankOf(a.key) - rankOf(b.key);
}

/** "1 day of float", "2 days of float", "No float" (none left, or behind a deadline) */
function floatText(float: number): string {
  if (float <= 0) return "No float";
  return `${float} ${float === 1 ? "day" : "days"} of float`;
}

/**
 * The why: the two highest reasons with a phrase, in the order given (strongest first). Two
 * adjectives join with " and "; a clause joins with "; ". No phrase at all: "Nothing is blocking it."
 */
export function whyOf(reasons: readonly FocusReason[]): string {
  const [a, b] = reasons.filter((r) => r.phrase !== null);
  if (a === undefined) return "Nothing is blocking it.";
  const sentence = b === undefined ? a.phrase! : `${a.phrase}${!a.clause && !b.clause ? " and " : "; "}${b.phrase}`;
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

/* ------------------------------------------------------------------
   Scoring one project
   ------------------------------------------------------------------ */

interface Scored extends FocusCandidate {
  readonly order: string;
  readonly projectCreatedAt: string;
  readonly blocked: boolean;
  /** Owned by the "My focus" person, or no owner filter */
  readonly inScope: boolean;
}

/** Population count of a 32-bit word */
function popcount(word: number): number {
  let v = word - ((word >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}

/** The open tasks of one plan in scope, scored, plus its blocked set */
function scoreProject(plan: FocusPlan, opts: FocusOptions, w: FocusWeights, blocked: Set<TaskId>): Scored[] {
  const { project, schedule, calendar } = plan;
  const tasks = project.tasks;
  const today = opts.today;
  const ownerId = opts.ownerId ?? null;
  const pin = opts.pin ?? null;
  const risks: Risks = risksOf(project, calendar, today);
  const throughToday = ordinalAfter(calendar, today);

  // Open tasks waiting on each task, directly or not: descendant bitsets ANDed with the open ones
  const topo = schedule.topo;
  const bits = descendantBits(topo, successorMap(project));
  const words = Math.ceil(topo.length / 32);
  const open = new Uint32Array(words);
  topo.forEach((id, j) => {
    if (Object.hasOwn(tasks, id) && tasks[id].status !== "done") open[j >>> 5] |= 1 << (j & 31);
  });

  const out: Scored[] = [];
  for (const task of sortedByOrder(tasks)) {
    if (task.status === "done") continue;
    const inScope = ownerId === null || task.ownerId === ownerId;
    if (!inScope && task.id !== pin) continue;

    const waitsOn = task.status === "todo" ? task.dependsOn.filter((id) => Object.hasOwn(tasks, id) && tasks[id].status !== "done") : [];
    const isBlocked = waitsOn.length > 0;
    if (isBlocked && inScope) blocked.add(task.id);
    // A blocked task is scored only when it is the pin
    if (isBlocked && task.id !== pin) continue;

    const reasons: FocusReason[] = [];
    reasons.push(reason("priority", w.priority[task.priority], `${PRIORITY_TEXT[task.priority]} priority`, PRIORITY_PHRASE[task.priority], false, task.priority === "urgent"));

    const late = risks.byTask.get(task.id)?.late ?? null;
    if (late !== null) {
      reasons.push(reason("late", w.late + Math.min(w.lateMax, w.latePerDay * late), `Late · ${fmtWorkingDays(late)}`, `late by ${fmtWorkingDays(late)}`, true, true));
    }

    if (task.dueDate !== null) {
      // Working days after today up to the due date: none or negative when it's today or past
      const ahead = ordinalAfter(calendar, task.dueDate) - throughToday;
      if (ahead <= w.dueSoonDays) {
        const past = task.dueDate < today;
        const text = past ? `Past due · ${fmtDate(task.dueDate)}` : task.dueDate === today ? "Due today" : `Due ${fmtDate(task.dueDate)}`;
        const phrase = past ? "past due" : task.dueDate === today ? "due today" : `due ${fmtDate(task.dueDate)}`;
        reasons.push(reason("dueSoon", w.dueSoon, text, phrase, false, true));
      }
    }

    if (task.status === "active") reasons.push(reason("active", w.active, `In progress · ${task.progress}%`, null));
    if (task.status === "review") reasons.push(reason("review", w.review, "In review, close to done", null));

    const timing = schedule.timings.get(task.id);
    if (timing !== undefined && timing.kind === "scheduled") {
      if (timing.critical) reasons.push(reason("critical", w.critical, "On the critical path", "on the critical path"));
      if (timing.float !== null && timing.float <= w.tightFloatDays) reasons.push(reason("tightFloat", w.tightFloat, floatText(timing.float), null));
    }

    const i = bits.index.get(task.id);
    if (i !== undefined) {
      const own = bits.bits[i];
      let waiting = 0;
      let only = -1;
      for (let k = 0; k < words; k++) {
        const word = own[k] & open[k];
        if (word === 0) continue;
        const count = popcount(word);
        if (waiting === 0 && count === 1) only = k * 32 + (31 - Math.clz32(word));
        waiting += count;
      }
      if (waiting > 0) {
        const text = waiting === 1 ? `${tasks[topo[only]].title} waits on it` : `${waiting} tasks wait for it`;
        reasons.push(reason("waiting", Math.min(w.waitingMax, w.waitingEach * waiting), text, text, true));
      }
    }

    reasons.sort(byPoints);
    let score = 0;
    for (const r of reasons) score += r.points;
    const why = isBlocked ? `Waits on ${tasks[waitsOn[0]].title}.` : whyOf(reasons);
    out.push({
      taskId: task.id,
      projectId: project.id,
      score,
      reasons: Object.freeze(reasons),
      why,
      nextStepId: task.steps.find((s) => !s.done)?.id ?? null,
      order: task.order,
      projectCreatedAt: project.createdAt,
      blocked: isBlocked,
      inScope,
    });
  }
  return out;
}

function byRank(a: Scored, b: Scored): number {
  return (
    b.score - a.score ||
    compareKeys(a.order, b.order) ||
    compareKeys(a.projectCreatedAt, b.projectCreatedAt) ||
    compareKeys(a.projectId, b.projectId) ||
    compareKeys(a.taskId, b.taskId)
  );
}

function candidate(s: Scored): FocusCandidate {
  return Object.freeze({ taskId: s.taskId, projectId: s.projectId, score: s.score, reasons: s.reasons, why: s.why, nextStepId: s.nextStepId });
}

/* ------------------------------------------------------------------
   Focus
   ------------------------------------------------------------------ */

/**
 * The focus over one or more plans: one project's ("what should I work on now?"), or every
 * project's tasks owned by one person ("My focus", `ownerId`).
 */
export function focus(plans: readonly FocusPlan[], opts: FocusOptions): FocusResult {
  const w = opts.weights ?? FOCUS_WEIGHTS;
  const pin = opts.pin ?? null;
  const blocked = new Set<TaskId>();
  const scored: Scored[] = [];
  for (const plan of plans) scored.push(...scoreProject(plan, opts, w, blocked));

  const pinned = pin === null ? null : (scored.find((s) => s.taskId === pin) ?? null);
  const ranked = scored.filter((s) => s.inScope && !s.blocked).sort(byRank);
  const best = pinned ?? ranked[0] ?? null;
  return Object.freeze({
    pick: best === null ? null : Object.freeze({ ...candidate(best), chosenBy: pinned !== null ? ("you" as const) : ("form" as const) }),
    ranked: Object.freeze(ranked.map(candidate)),
    blocked,
  });
}

/** Focus results by the risks they read (which stand for the tasks, schedule, calendar and day), then pin */
const projectFocusCache = new RefCache<Risks, FocusResult>(4);

/**
 * One project's focus with its pin (the Plan's `focus` getter). Memoised by the project's risks
 * and its pin, so a viewConfig change other than the pin never rescores.
 */
export function projectFocus(plan: FocusPlan): FocusResult {
  const pin = plan.project.viewConfig.focusPin;
  const risks = risksOf(plan.project, plan.calendar, plan.today);
  return projectFocusCache.get(risks, `${plan.project.id}|${pin}`, () => focus([plan], { today: plan.today, pin }));
}
