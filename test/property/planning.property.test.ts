// Property 10 (plan §10.3): planProject is total on every state the reducer can reach. Runs come
// from the same generators as the reducer properties (`runner.ts`). After every command that
// changes something, each project it touched is planned (its project commit, a spawned project,
// and the active project when the workspace changed: calendar, people), and at the end of the run
// every project and the workspace load. On each plan:
//   - every top-level task is scheduled or unknown; an unknown one names an existing root cause,
//     itself unknown for a reason of its own;
//   - a scheduled task starts at or after the anchor, every predecessor's finish and its pin, on
//     a working day, and runs its duration; its steps sit inside its window;
//   - critical ⊆ the scheduled tasks with a known float; a float is known only when every
//     successor's is (unknown propagation, §6.3);
//   - nothing is late without a confirmed start; metrics add up; FORM's focus pick is never
//     blocked or Done, and a pinned pick is the open pin;
//   - planning a jsonb-shaped copy (every object's keys in another order) gives the same plan.
// The schedule's own oracle and totality over random graphs are schedule.property.test.ts.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { TaskId } from "@/lib/domain/schema/ids";
import type { ProjectDoc } from "@/lib/domain/schema/project";
import type { WorkspaceDoc } from "@/lib/domain/schema/workspace";
import { planProject, planWorkspace, type ProjectPlan } from "@/lib/planning";
import { FIXTURE_TODAY } from "../fixtures/v2/build";
import { runArb } from "./arbitraries";
import { executeRun, type GenState, shuffledCopy, type StepRecord } from "./runner";

/** Checks one plan; returns it */
function checkPlan(project: ProjectDoc, ws: WorkspaceDoc): ProjectPlan {
  const plan = planProject(project, ws, FIXTURE_TODAY);
  const s = plan.schedule;
  const cal = plan.calendar;
  const tasks = Object.values(project.tasks);
  const dated = s.anchor.mode !== "relative";

  expect(s.timings.size).toBe(tasks.length);
  expect([...s.topo].sort()).toEqual(Object.keys(project.tasks).sort());

  const successors = new Map<TaskId, TaskId[]>();
  for (const t of tasks) for (const p of t.dependsOn) successors.set(p, [...(successors.get(p) ?? []), t.id]);

  for (const t of tasks) {
    const timing = s.timings.get(t.id)!;
    if (timing.kind === "unknown") {
      // An existing root cause, unknown for a reason of its own; valid documents have no loops
      expect(Object.hasOwn(project.tasks, timing.cause), t.title).toBe(true);
      const root = s.timings.get(timing.cause)!;
      expect(root.kind === "unknown" && root.reason !== "waitsOn", t.title).toBe(true);
      expect(timing.reason).not.toBe("cycle");
      if (timing.reason === "noEstimate") expect(t.kind === "task" && t.estimateDays === null, t.title).toBe(true);
      if (timing.reason === "waitsOn") expect(t.dependsOn.some((p) => s.timings.get(p)?.kind === "unknown"), t.title).toBe(true);
      continue;
    }
    expect(timing.es).toBeGreaterThanOrEqual(s.anchor.ordinal);
    for (const p of t.dependsOn) {
      const pt = s.timings.get(p)!;
      expect(pt.kind, `${t.title} waits on a scheduled task`).toBe("scheduled");
      if (pt.kind === "scheduled") expect(timing.es, t.title).toBeGreaterThanOrEqual(pt.finish);
    }
    if (t.pinnedStart !== null) expect(timing.es, t.title).toBeGreaterThanOrEqual(cal.ordinal(t.pinnedStart));
    expect(timing.finish - timing.es).toBe(timing.duration);
    expect(timing.duration === 0).toBe(t.kind === "milestone");
    if (dated) {
      expect(cal.isWorkingDay(timing.start!), t.title).toBe(true);
      expect(cal.isWorkingDay(timing.end!), t.title).toBe(true);
      expect(timing.end! >= timing.start!, t.title).toBe(true);
    } else expect([timing.start, timing.end]).toEqual([null, null]);
    // A float is known only when every successor's is
    const after = successors.get(t.id) ?? [];
    const knownAfter = after.every((id) => {
      const st = s.timings.get(id)!;
      return st.kind === "scheduled" && st.float !== null;
    });
    expect(timing.float !== null, t.title).toBe(knownAfter);
    expect(timing.critical).toBe(timing.float !== null && timing.float <= 0);
    // Steps sit inside their task's window
    for (const step of t.steps) {
      const slot = s.steps.get(step.id);
      expect(slot !== undefined, step.title).toBe(true);
      if (!slot) continue;
      if (timing.duration > 0) {
        expect(slot.es).toBeGreaterThanOrEqual(timing.es);
        expect(slot.finish).toBeLessThanOrEqual(timing.finish);
        expect(slot.finish).toBeGreaterThan(slot.es);
      }
    }
  }
  for (const id of s.critical) {
    const t = s.timings.get(id)!;
    expect(t.kind === "scheduled" && t.float !== null && t.float <= 0).toBe(true);
  }

  // Lateness needs a confirmed start (§1.3)
  if (s.anchor.mode !== "absolute") for (const r of plan.risks.byTask.values()) expect(r.late).toBeNull();

  // Metrics add up
  const m = plan.metrics;
  expect(m.count).toBe(tasks.length);
  expect(Object.values(m.byStatus).reduce((a, b) => a + b, 0)).toBe(tasks.length);
  expect(m.done).toBe(m.byStatus.done);
  expect(m.completePct).toBeGreaterThanOrEqual(0);
  expect(m.completePct).toBeLessThanOrEqual(100);

  // Focus: FORM never picks a blocked or Done task; a pin wins while it is open
  const f = plan.focus;
  const pin = project.viewConfig.focusPin;
  const open = (id: TaskId) => Object.hasOwn(project.tasks, id) && project.tasks[id].status !== "done";
  if (pin !== null && open(pin)) expect(f.pick).toMatchObject({ taskId: pin, chosenBy: "you" });
  else if (f.pick !== null) {
    expect(f.pick.chosenBy).toBe("form");
    expect(f.blocked.has(f.pick.taskId)).toBe(false);
    expect(open(f.pick.taskId)).toBe(true);
  }
  for (const c of f.ranked) {
    expect(f.blocked.has(c.taskId)).toBe(false);
    expect(open(c.taskId)).toBe(true);
  }
  return plan;
}

/** The same plan on jsonb-shaped copies: key order never changes a figure, an order or a pick */
function checkShuffled(plan: ProjectPlan, salt: number): void {
  const copy = planProject(shuffledCopy(plan.project, salt), shuffledCopy(plan.workspace, salt + 1), FIXTURE_TODAY);
  expect(Object.fromEntries(copy.schedule.timings)).toEqual(Object.fromEntries(plan.schedule.timings));
  expect(Object.fromEntries(copy.schedule.steps)).toEqual(Object.fromEntries(plan.schedule.steps));
  expect(copy.schedule.topo).toEqual(plan.schedule.topo);
  expect(copy.schedule.critical).toEqual(plan.schedule.critical);
  expect(copy.schedule.end).toEqual(plan.schedule.end);
  expect([...copy.risks.byTask]).toEqual([...plan.risks.byTask]);
  expect(copy.metrics).toEqual(plan.metrics);
  expect(copy.focus.pick).toEqual(plan.focus.pick);
  expect(copy.focus.ranked.map((c) => c.taskId)).toEqual(plan.focus.ranked.map((c) => c.taskId));
}

/** The projects a command touched, as they are after it */
function touched({ result, after }: StepRecord): ProjectDoc[] {
  const out = new Map<string, ProjectDoc>();
  for (const c of result.commits) if (c.result.doc.docType === "project") out.set(c.docId, after.projects[c.docId as keyof GenState["projects"]]);
  for (const p of result.spawned) out.set(p.id, p);
  const workspaceChanged = result.commits.some((c) => c.result.doc.docType === "workspace");
  if (workspaceChanged && after.projectId !== null && Object.hasOwn(after.projects, after.projectId)) {
    out.set(after.projectId, after.projects[after.projectId]);
  }
  return [...out.values()];
}

describe("planning on reducer states", () => {
  it("is total after every command, and deterministic under any key order", () => {
    fc.assert(
      fc.property(runArb, (run) => {
        const { final } = executeRun(run, (record) => {
          if (!record.result.changed) return;
          for (const project of touched(record)) checkShuffled(checkPlan(project, record.after.workspace), record.step.picks[1]);
        });
        // Every project at the end, and the workspace load across the live ones
        const plans = Object.values(final.projects).map((p) => checkPlan(p, final.workspace));
        const live = plans.filter((p) => {
          const entry = final.workspace.projects[p.project.id];
          return !entry || (entry.archivedAt === null && entry.deletedAt === null);
        });
        const { load } = planWorkspace(
          final.workspace,
          live.map((p) => p.project),
          FIXTURE_TODAY,
        );
        for (const [personId, weeks] of load.people) {
          expect(Object.hasOwn(final.workspace.people, personId) && !final.workspace.people[personId].archived).toBe(true);
          for (const cell of weeks.values()) {
            expect(Number.isFinite(cell.load) && cell.load >= 0).toBe(true);
            if (cell.capacity !== null) expect(cell.capacity).toBeGreaterThanOrEqual(0);
          }
        }
      }),
    );
  });
});
