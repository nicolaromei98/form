import { sortedByOrder } from "@/lib/domain/order";
import type { TaskId } from "@/lib/domain/schema/ids";
import type { IsoDate } from "@/lib/domain/schema/primitives";
import type { ProjectDoc, Task } from "@/lib/domain/schema/project";
import type { WorkspaceDoc } from "@/lib/domain/schema/workspace";
import type { WorkCalendar } from "@/lib/planning/calendar";
import { metrics, type Metrics } from "@/lib/planning/metrics";
import { risks, type Risks } from "@/lib/planning/risk";
import { schedule, type Schedule } from "@/lib/planning/schedule";

/**
 * Memoisation by document identity (plan §6.8). Immer keeps unchanged subtrees and every committed
 * version is a new frozen object, so an object's identity stands for its version: a WeakMap keyed
 * by it never needs invalidating, and old versions are collected with their documents.
 *
 * Each stage is keyed on exactly what it reads, so an edit recomputes only what it affects:
 * - the schedule on `project.tasks`, the start, its confirmation, the deadline and the calendar
 *   (a viewConfig, brief or moodboard change never reschedules);
 * - risks on the schedule, today and the deadline kind;
 * - metrics on the schedule, `ws.people` (derived costs), the budget and the currency.
 */

/* ------------------------------------------------------------------
   Helpers
   ------------------------------------------------------------------ */

/** A one-argument function memoised by its argument's identity */
export function memoByRef<K extends object, V>(fn: (key: K) => V): (key: K) => V {
  const cache = new WeakMap<K, V>();
  return (key) => {
    if (cache.has(key)) return cache.get(key) as V;
    const value = fn(key);
    cache.set(key, value);
    return value;
  };
}

/**
 * Values keyed by an object's identity, then by a string of plain inputs (dates, flags, a calendar
 * key). Keeps the last `limit` strings per object, so a value that cycles (today, a toggled date)
 * can't grow the cache without bound.
 */
export class RefCache<K extends object, V> {
  private readonly byRef = new WeakMap<K, Map<string, V>>();

  constructor(private readonly limit = 8) {}

  get(ref: K, key: string, make: () => V): V {
    let byKey = this.byRef.get(ref);
    if (byKey === undefined) {
      byKey = new Map();
      this.byRef.set(ref, byKey);
    }
    const hit = byKey.get(key);
    if (hit !== undefined) return hit;
    const value = make();
    if (byKey.size >= this.limit) byKey.delete(byKey.keys().next().value as string);
    byKey.set(key, value);
    return value;
  }
}

/* ------------------------------------------------------------------
   Stage memos
   ------------------------------------------------------------------ */

const schedules = new RefCache<ProjectDoc["tasks"], Schedule>();

/** `schedule(project, cal)`, recomputed only when the tasks, the start, the deadline or the calendar change */
export function scheduleOf(project: ProjectDoc, cal: WorkCalendar): Schedule {
  const key = `${project.startDate}|${project.startConfirmed}|${project.deadline}|${cal.key}`;
  return schedules.get(project.tasks, key, () => schedule(project, cal));
}

// A schedule's identity already stands for the tasks, start, deadline and calendar it came from
const riskCache = new RefCache<Schedule, Risks>();

/** `risks(…)` for the project's current schedule */
export function risksOf(project: ProjectDoc, cal: WorkCalendar, today: IsoDate): Risks {
  const sched = scheduleOf(project, cal);
  return riskCache.get(sched, `${today}|${project.deadlineKind}`, () => risks(project, sched, cal, today));
}

const metricsCache = new WeakMap<Schedule, RefCache<WorkspaceDoc["people"], Metrics>>();

/** `metrics(…)` for the project's current schedule and the workspace's people */
export function metricsOf(project: ProjectDoc, ws: Pick<WorkspaceDoc, "people">, cal: WorkCalendar): Metrics {
  const sched = scheduleOf(project, cal);
  let byPeople = metricsCache.get(sched);
  if (byPeople === undefined) {
    byPeople = new RefCache(4);
    metricsCache.set(sched, byPeople);
  }
  return byPeople.get(ws.people, `${project.budgetCents}|${project.currency}`, () => metrics(project, sched, ws, cal));
}

/**
 * Workflow numbers ("01", "02" …): each task's position in workflow order, stable under any view
 * sort (v0 `taskNumber`). One map per tasks record.
 */
export const workflowNumbers = memoByRef((tasks: Readonly<Record<TaskId, Pick<Task, "id" | "order">>>): ReadonlyMap<TaskId, string> => {
  const numbers = new Map<TaskId, string>();
  sortedByOrder(tasks).forEach((t, i) => numbers.set(t.id, String(i + 1).padStart(2, "0")));
  return numbers;
});
