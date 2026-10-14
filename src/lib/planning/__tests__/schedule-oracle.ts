// Test helper (not a test file): random projects for the schedule, and a naive oracle it must
// match. The unit test and the property suite (test/property/schedule.property.test.ts) both use it.
//
// The oracle recomputes each figure from its definition (plan §6.3) by plain recursion over
// predecessors and successors, with none of the engine's typed arrays or single passes:
// - es = max(A, pin, every predecessor's finish), finish = es + ⌈estimate / allocation⌉;
// - unknown: no estimate, or any unknown predecessor (cause: the first one's cause in topo order);
// - lf = min(T, every successor's lf − its duration); float = lf − duration − es, or null when
//   anything downstream is unknown.
import fc from "fast-check";
import { expect } from "vitest";
import { addDays, fromDayNum, toDayNum } from "@/lib/domain/dates";
import { nKeys } from "@/lib/domain/order";
import { type Allocation, IsoDate, type ProjectDoc, StepId, type Task, TaskId, type TaskKind } from "@/lib/domain/schema";
import { makeCalendar, type WorkCalendar } from "@/lib/planning/calendar";
import { ordinalAfter, schedule, type Schedule } from "@/lib/planning/schedule";
import { byId, DEMO_WORKSPACE_ID, makeProject, makeTask, SAMPLE_START } from "../../../../test/fixtures/v2/build";

export const tid = (name: string) => TaskId.parse(`tsk_${name.toLowerCase().padEnd(8, "x")}`);
export const sid = (name: string) => StepId.parse(`stp_${name.toLowerCase().padEnd(8, "x")}`);

export interface TaskSpec {
  name: string;
  est?: number | null;
  kind?: TaskKind;
  deps?: string[];
  pin?: string;
  alloc?: Allocation;
  status?: Task["status"];
  steps?: (number | null)[];
}

/** A project from task specs, in workflow order, starting on the sample start (confirmed) unless told otherwise */
export function projectFrom(specs: TaskSpec[], p: Partial<ProjectDoc> = {}): ProjectDoc {
  const keys = nKeys(specs.length);
  const tasks = specs.map((s, i) =>
    makeTask({
      id: tid(s.name),
      title: s.name,
      order: keys[i],
      kind: s.kind ?? "task",
      estimateDays: s.kind === "milestone" ? 0 : s.est === undefined ? 1 : s.est,
      allocation: s.alloc ?? 1,
      dependsOn: (s.deps ?? []).map(tid),
      pinnedStart: s.pin ? IsoDate.parse(s.pin) : null,
      status: s.status ?? "todo",
      progress: s.status === "done" ? 100 : 0,
      steps: (s.steps ?? []).map((est, k) => ({ id: sid(`${s.name}s${k}`), title: `Step ${k + 1}`, done: false, ownerId: null, estimateDays: est })),
    }),
  );
  return makeProject({
    id: "prj_schedule0000" as ProjectDoc["id"],
    workspaceId: DEMO_WORKSPACE_ID,
    title: "Schedule",
    startDate: SAMPLE_START,
    startConfirmed: true,
    tasks: byId(tasks),
    ...p,
  });
}

/* ------------------------------------------------------------------
   Arbitrary
   ------------------------------------------------------------------ */

export interface ScheduleCase {
  project: ProjectDoc;
  cal: WorkCalendar;
}

/**
 * A random DAG of up to 24 tasks (milestones, unknown estimates, every allocation, pins, steps,
 * Done tasks) on a random calendar with closures, with or without a start and a deadline.
 */
export const scheduleCase: fc.Arbitrary<ScheduleCase> = fc
  .record({
    n: fc.integer({ min: 0, max: 24 }),
    weekdays: fc.uniqueArray(fc.integer({ min: 1, max: 7 }), { minLength: 1, maxLength: 7 }),
    closures: fc.array(fc.tuple(fc.integer({ min: -30, max: 200 }), fc.integer({ min: 0, max: 20 })), { maxLength: 3 }),
    start: fc.option(fc.integer({ min: -10, max: 30 }), { nil: null }),
    confirmed: fc.boolean(),
    deadline: fc.option(fc.integer({ min: 0, max: 120 }), { nil: null }),
  })
  .chain((c) =>
    fc.record({
      c: fc.constant(c),
      tasks: fc.array(
        fc.record({
          est: fc.option(fc.integer({ min: 1, max: 20 }).map((h) => h / 2), { nil: null, freq: 6 }),
          kind: fc.integer({ min: 0, max: 9 }).map((k): TaskKind => (k === 0 ? "milestone" : "task")),
          alloc: fc.constantFrom<Allocation>(1, 0.75, 0.5, 0.25),
          pin: fc.option(fc.integer({ min: -5, max: 60 }), { nil: null, freq: 5 }),
          preds: fc.array(fc.nat(), { maxLength: 3 }),
          done: fc.boolean(),
          steps: fc.array(fc.option(fc.integer({ min: 1, max: 6 }).map((h) => h / 2), { nil: null, freq: 3 }), { maxLength: 3 }),
        }),
        { minLength: c.n, maxLength: c.n },
      ),
    }),
  )
  .map(({ c, tasks }) => {
    const base = toDayNum(SAMPLE_START);
    const cal = makeCalendar({
      workingDays: [...c.weekdays].sort(),
      closures: c.closures.map(([from, len]) => ({ from: fromDayNum(base + from), to: fromDayNum(base + from + len) })),
    });
    const specs: TaskSpec[] = tasks.map((t, i) => ({
      name: `N${i}`,
      kind: t.kind,
      est: t.est,
      alloc: t.kind === "milestone" ? 1 : t.alloc,
      pin: t.pin === null ? undefined : addDays(SAMPLE_START, t.pin),
      // Edges point to earlier tasks only, so the graph is acyclic; the topological order still mixes them
      deps: i === 0 ? [] : [...new Set(t.preds.map((k) => k % i))].map((k) => `N${k}`),
      status: t.done ? "done" : "todo",
      steps: t.kind === "milestone" ? [] : t.steps,
    }));
    const project = projectFrom(specs, {
      startDate: c.start === null ? null : addDays(SAMPLE_START, c.start),
      startConfirmed: c.confirmed,
      deadline: c.deadline === null ? null : addDays(SAMPLE_START, c.deadline),
    });
    return { project, cal };
  });

/* ------------------------------------------------------------------
   Oracle
   ------------------------------------------------------------------ */

/** Checks a schedule against the naive definitions; throws an assertion error on the first difference */
export function agreesWithOracle({ project, cal }: ScheduleCase): Schedule {
  const s = schedule(project, cal);
  const tasks = Object.values(project.tasks);
  const A = s.anchor.ordinal;
  const topoIndex = new Map(s.topo.map((id, i) => [id, i]));

  type Naive = { unknown: true; cause: TaskId } | { unknown: false; es: number; finish: number; d: number };
  const memo = new Map<TaskId, Naive>();
  const forward = (id: TaskId): Naive => {
    const hit = memo.get(id);
    if (hit) return hit;
    const t = project.tasks[id];
    let result: Naive;
    if (t.kind !== "milestone" && t.estimateDays === null) result = { unknown: true, cause: id };
    else {
      const preds = t.dependsOn.map((p) => ({ p, r: forward(p) }));
      const blocked = preds.filter((x) => x.r.unknown).sort((a, b) => topoIndex.get(a.p)! - topoIndex.get(b.p)!);
      if (blocked.length > 0) result = { unknown: true, cause: (blocked[0].r as { cause: TaskId }).cause };
      else {
        const d = t.kind === "milestone" ? 0 : Math.ceil(t.estimateDays! / t.allocation);
        const es = Math.max(A, t.pinnedStart ? cal.ordinal(t.pinnedStart) : A, ...preds.map((x) => (x.r as { finish: number }).finish));
        result = { unknown: false, es, finish: es + d, d };
      }
    }
    memo.set(id, result);
    return result;
  };

  const successors = (id: TaskId) => tasks.filter((t) => t.dependsOn.includes(id)).map((t) => t.id);
  const after = new Map<TaskId, boolean>();
  const anyUnknownAfter = (id: TaskId): boolean => {
    if (!after.has(id)) after.set(id, successors(id).some((sId) => forward(sId).unknown || anyUnknownAfter(sId)));
    return after.get(id)!;
  };
  const known = tasks.map((t) => forward(t.id)).filter((r): r is Extract<Naive, { unknown: false }> => !r.unknown);
  const maxFinish = Math.max(...known.map((r) => r.finish));
  const T = s.anchor.mode !== "relative" && project.deadline !== null ? ordinalAfter(cal, project.deadline) : maxFinish;
  const latest = new Map<TaskId, number>();
  const lf = (id: TaskId): number => {
    if (!latest.has(id)) latest.set(id, Math.min(T, ...successors(id).map((sId) => lf(sId) - (forward(sId) as { d: number }).d)));
    return latest.get(id)!;
  };

  for (const t of tasks) {
    const naive = forward(t.id);
    const timing = s.timings.get(t.id)!;
    if (naive.unknown) {
      expect(timing.kind, t.title).toBe("unknown");
      if (timing.kind === "unknown") expect(timing.cause, t.title).toBe(naive.cause);
      continue;
    }
    expect(timing.kind, t.title).toBe("scheduled");
    if (timing.kind !== "scheduled") continue;
    expect([timing.es, timing.finish, timing.duration], t.title).toEqual([naive.es, naive.finish, naive.d]);
    const float = anyUnknownAfter(t.id) ? null : lf(t.id) - naive.d - naive.es;
    expect(timing.float, t.title).toBe(float);
    expect(timing.critical, t.title).toBe(float !== null && float <= 0);
    if (s.anchor.mode === "relative") {
      expect([timing.start, timing.end]).toEqual([null, null]);
    } else {
      expect(cal.isWorkingDay(timing.start!)).toBe(true);
      expect(cal.isWorkingDay(timing.end!)).toBe(true);
      expect(cal.ordinal(timing.end!)).toBe(timing.last);
      expect(timing.end! >= timing.start!).toBe(true);
      if (timing.duration > 0) {
        expect(cal.ordinal(timing.start!)).toBe(timing.es);
        expect(timing.last).toBe(timing.finish - 1);
      }
    }
  }
  expect(s.end?.finish ?? null).toBe(known.length > 0 ? maxFinish : null);
  return s;
}

/** The checks of plan §10.3 item 10, which hold for any document (valid or not) */
export function isTotal({ project, cal }: ScheduleCase): void {
  const s = schedule(project, cal);
  expect(s.timings.size).toBe(Object.keys(project.tasks).length);
  expect(new Set(s.topo)).toEqual(new Set(Object.keys(project.tasks)));
  for (const task of Object.values(project.tasks)) {
    const t = s.timings.get(task.id)!;
    if (t.kind === "unknown") {
      expect(Object.hasOwn(project.tasks, t.cause)).toBe(true);
      continue;
    }
    for (const pred of task.dependsOn) {
      const pt = s.timings.get(pred);
      if (pt?.kind === "scheduled") expect(t.es).toBeGreaterThanOrEqual(pt.finish);
    }
    if (task.pinnedStart !== null) expect(t.es).toBeGreaterThanOrEqual(cal.ordinal(task.pinnedStart));
    if (t.start !== null) expect(cal.isWorkingDay(t.start)).toBe(true);
  }
  for (const id of s.critical) {
    const t = s.timings.get(id);
    expect(t?.kind === "scheduled" && t.float !== null && t.float <= 0).toBe(true);
  }
}
