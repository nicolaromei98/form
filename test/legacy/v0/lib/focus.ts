import { dayDiff, addDays, parseISODate, schedule, subtasksOf, topLevel } from "./selectors";
import type { Doc, Task } from "./schema";

export interface Reason {
  text: string;
  /** The same reason as a clause, for the one-sentence summary (null = context only) */
  phrase: string | null;
  weight: number;
  /** Signal-red dot: the reason is a risk, not just context */
  risk: boolean;
}

export interface FocusPick {
  task: Task;
  reasons: Reason[];
  chosenBy: "form" | "you";
  /** First open step, if the task has been broken down */
  next: Task | null;
}

const PRIORITY: Record<Task["priority"], Reason | null> = {
  urgent: { text: "Urgent priority", phrase: "urgent", weight: 40, risk: true },
  high: { text: "High priority", phrase: "high priority", weight: 25, risk: false },
  medium: null,
  low: null,
};

const fmt = (d: Date) => `${d.getDate()} ${d.toLocaleString("en-US", { month: "short" })}`;

/**
 * Deterministic, explainable prioritisation — no model involved.
 * Every point a task scores comes with the sentence that justifies it.
 */
export function reasonsFor(doc: Doc, task: Task, today = new Date()): Reason[] {
  const out: Reason[] = [];
  const p = PRIORITY[task.priority];
  if (p) out.push(p);
  else out.push({ text: `${task.priority === "medium" ? "Medium" : "Low"} priority`, phrase: null, weight: task.priority === "medium" ? 12 : 4, risk: false });

  if (task.status === "active") out.push({ text: `In progress · ${task.progress}%`, phrase: null, weight: 15, risk: false });
  if (task.status === "review") out.push({ text: "In review, close to done", phrase: null, weight: 10, risk: false });

  const tool = doc.tool;
  const slot = schedule(doc).slots[task.id];
  if (tool && slot) {
    const start = parseISODate(tool.startDate);
    const now = dayDiff(start, today) + 0.5;
    const label = tool.startDateIsSample ? "the sample schedule" : "the schedule";
    if (now >= slot.start + slot.days) {
      const ended = fmt(addDays(start, slot.start + slot.days - 1));
      out.push({ text: `Overdue on ${label} · ended ${ended}`, phrase: `overdue on ${label} since ${ended}`, weight: 35, risk: true });
    } else if (now >= slot.start) {
      const behind = (now - slot.start) / slot.days - task.progress / 100;
      const days = Math.round(behind * slot.days);
      if (days >= 1) out.push({ text: `${days}d behind ${label}`, phrase: `${days} ${days === 1 ? "day" : "days"} behind ${label}`, weight: 40 * behind, risk: true });
    }
  }

  // What can't start until this moves
  const after = doc.order.slice(doc.order.indexOf(task.id) + 1).map((id) => doc.tasks[id]).filter((t) => t && t.status === "todo");
  if (after.length) out.push({ text: `${after[0].title} waits on it`, phrase: `${after[0].title} waits on it`, weight: 5 * after.length, risk: false });

  return out.sort((a, b) => b.weight - a.weight);
}

export function focusPick(doc: Doc, today = new Date()): FocusPick | null {
  const open = topLevel(doc).filter((t) => t.status !== "done");
  if (!open.length) return null;

  const pinned = doc.view.focusId ? doc.tasks[doc.view.focusId] : null;
  const scored = open.map((t) => {
    const reasons = reasonsFor(doc, t, today);
    return { task: t, reasons, score: reasons.reduce((s, r) => s + r.weight, 0) };
  });
  const chosen = pinned && pinned.status !== "done" && !pinned.parentId ? scored.find((s) => s.task.id === pinned.id) ?? null : null;
  const best = chosen ?? scored.reduce((a, b) => (b.score > a.score ? b : a));

  return {
    task: best.task,
    reasons: best.reasons.slice(0, 3),
    chosenBy: chosen ? "you" : "form",
    next: subtasksOf(doc, best.task.id).find((s) => s.status !== "done") ?? null,
  };
}

/** The decision for a specific task — used to keep a leaving focus readable while it dissolves. */
export function pickFor(doc: Doc, id: string, chosenBy: FocusPick["chosenBy"], today = new Date()): FocusPick | null {
  const task = doc.tasks[id];
  if (!task) return null;
  return {
    task,
    reasons: reasonsFor(doc, task, today).slice(0, 3),
    chosenBy,
    next: subtasksOf(doc, id).find((s) => s.status !== "done") ?? null,
  };
}

/**
 * One sentence instead of a dashboard: where the task stands, then why it matters now.
 * `lead` is the quiet part, `point` the part the eye should land on.
 */
export function summaryOf(pick: FocusPick): { lead: string; point: string } {
  const t = pick.task;
  const days = t.estimate != null ? `${Number.isInteger(t.estimate) ? t.estimate : t.estimate.toFixed(1)} ${t.estimate === 1 ? "day" : "days"} of work` : "no duration yet";
  const lead =
    t.status === "active" ? `In progress, ${t.progress}% done.` : t.status === "review" ? `In review, ${days}.` : t.status === "done" ? "Done." : `Not started, ${days}.`;
  const phrases = pick.reasons.map((r) => r.phrase).filter((p): p is string => !!p).slice(0, 2);
  if (!phrases.length) return { lead, point: "Nothing is blocking it." };
  const joined = phrases.join(" and ");
  return { lead, point: joined.charAt(0).toUpperCase() + joined.slice(1) + "." };
}
