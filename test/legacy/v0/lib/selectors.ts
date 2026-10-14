import { PRIORITY_RANK, STATUS_ORDER, type Doc, type Status, type Task } from "./schema";

export function topLevel(doc: Doc): Task[] {
  return doc.order.map((id) => doc.tasks[id]).filter(Boolean);
}

export function subtasksOf(doc: Doc, parentId: string): Task[] {
  return Object.values(doc.tasks).filter((t) => t.parentId === parentId);
}

/** Stable workflow number shown on each task (01, 02 …). Survives sorting. */
export function taskNumber(doc: Doc, id: string): string {
  const i = doc.order.indexOf(id);
  return String(i + 1).padStart(2, "0");
}

const STATUS_RANK: Record<Status, number> = { active: 0, review: 1, todo: 2, done: 3 };

/** Top-level tasks as the current view config wants them: filtered + sorted. */
export function visibleTasks(doc: Doc): Task[] {
  const base = topLevel(doc);
  const idx = new Map(doc.order.map((id, i) => [id, i]));
  const filtered = doc.view.hideDone ? base.filter((t) => t.status !== "done") : base;
  const by = doc.view.sort;
  const cmp = (a: Task, b: Task): number => {
    switch (by) {
      case "priority":
        return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      case "progress":
        return b.progress - a.progress;
      case "status":
        return STATUS_RANK[a.status] - STATUS_RANK[b.status];
      case "title":
        return a.title.localeCompare(b.title);
      case "estimate":
        return (b.estimate ?? -1) - (a.estimate ?? -1);
      default:
        return 0;
    }
  };
  return [...filtered].sort((a, b) => cmp(a, b) || idx.get(a.id)! - idx.get(b.id)!);
}

export function tasksByStatus(doc: Doc): Record<Status, Task[]> {
  const vis = visibleTasks(doc);
  const out = Object.fromEntries(STATUS_ORDER.map((s) => [s, [] as Task[]])) as Record<Status, Task[]>;
  for (const t of vis) out[t.status].push(t);
  return out;
}

export interface Metrics {
  count: number;
  done: number;
  byStatus: Record<Status, number>;
  totalEstimate: number;
  missingEstimates: number;
  progress: number;
  urgent: number;
  subtasks: number;
}

export function metrics(doc: Doc): Metrics {
  const list = topLevel(doc);
  const byStatus = { todo: 0, active: 0, review: 0, done: 0 } as Record<Status, number>;
  let totalEstimate = 0;
  let weighted = 0;
  let weight = 0;
  let missingEstimates = 0;
  let urgent = 0;
  for (const t of list) {
    byStatus[t.status]++;
    if (t.priority === "urgent" && t.status !== "done") urgent++;
    if (t.estimate != null) {
      totalEstimate += t.estimate;
      weighted += t.progress * t.estimate;
      weight += t.estimate;
    } else missingEstimates++;
  }
  // Progress weighted by duration; plain average when no estimates exist
  const progress = weight > 0 ? weighted / weight : list.length ? list.reduce((s, t) => s + t.progress, 0) / list.length : 0;
  return {
    count: list.length,
    done: byStatus.done,
    byStatus,
    totalEstimate,
    missingEstimates,
    progress: Math.round(progress),
    urgent,
    subtasks: Object.values(doc.tasks).filter((t) => t.parentId).length,
  };
}

/* ------------------------------------------------------------------
   Schedule — derived from the start date + estimates in workflow order.
   Nothing is invented: tasks without an estimate stay unscheduled.
   ------------------------------------------------------------------ */

export interface Slot {
  start: number; // day offset from tool.startDate
  days: number;
}

export interface Schedule {
  slots: Record<string, Slot>;
  unscheduled: string[];
  totalDays: number;
}

export function schedule(doc: Doc): Schedule {
  const slots: Record<string, Slot> = {};
  const unscheduled: string[] = [];
  let cursor = 0;
  for (const t of topLevel(doc)) {
    if (t.estimate == null) {
      unscheduled.push(t.id);
      continue;
    }
    slots[t.id] = { start: cursor, days: t.estimate };
    // Subtasks run sequentially inside their parent's window
    let sub = cursor;
    for (const s of subtasksOf(doc, t.id)) {
      if (s.estimate == null) continue;
      slots[s.id] = { start: sub, days: s.estimate };
      sub += s.estimate;
    }
    cursor += t.estimate;
  }
  return { slots, unscheduled, totalDays: cursor };
}

/* ------------------------------------------------------------------
   Dates
   ------------------------------------------------------------------ */

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toISODate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function dayDiff(a: Date, b: Date): number {
  const ms = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime() - new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  return Math.round(ms / 86400000);
}

export const fmtDay = (d: Date) => `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]}`;
export const fmtWeekday = (d: Date) => DAYS[d.getDay()];
export const fmtShort = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;

export function fmtDays(n: number | null): string {
  if (n == null) return "—";
  return `${Number.isInteger(n) ? n : n.toFixed(1)}d`;
}

export function fmtEuro(n: number | null): string {
  if (n == null) return "—";
  return `€${Math.round(n).toLocaleString("en-US")}`;
}
