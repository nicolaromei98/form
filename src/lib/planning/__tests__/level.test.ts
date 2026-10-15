// Leveling (plan §6.6): serial schedule generation by precedence, then priority, then workflow
// order; Review and Done fixed; shares as in load; pins only where a clash delays a task.
import { describe, expect, it } from "vitest";
import { IsoDate, type Person, type PersonId, type ProjectDoc, type Task, type TaskId } from "@/lib/domain/schema";
import { planProject } from "@/lib/planning";
import { level } from "@/lib/planning/level";
import { activeProject, byId, demoState, emptyWorkspace, FIXTURE_TODAY, makePerson, makeProject, makeTask } from "../../../../test/fixtures/v2/build";

const d = (s: string) => IsoDate.parse(s);
const ANNA = "per_annaannaanna" as PersonId;
const BRUNO = "per_brunobrunobru" as PersonId;
const ws = emptyWorkspace({
  people: byId<Person>([
    makePerson({ id: ANNA, name: "Anna", capacityDaysPerWeek: 5, order: "a0" }),
    makePerson({ id: BRUNO, name: "Bruno", capacityDaysPerWeek: 5, order: "a1" }),
  ]),
});
const tid = (name: string) => `tsk_${name.toLowerCase().padEnd(12, "x")}` as TaskId;

type Spec = Partial<Task> & { name: string; deps?: string[] };

/** Tasks owned by Anna unless told otherwise, from a confirmed start on Monday 5 October 2026 */
function project(specs: Spec[], o: Partial<ProjectDoc> = {}): ProjectDoc {
  return makeProject({
    id: "prj_levellevellev" as ProjectDoc["id"],
    workspaceId: ws.id,
    title: "Level",
    status: "active",
    startDate: d("2026-10-05"),
    startConfirmed: true,
    tasks: byId(
      specs.map(({ name, deps, ...t }, i) =>
        makeTask({ id: tid(name), title: name, order: `a${i}`, estimateDays: 2, ownerId: ANNA, dependsOn: (deps ?? []).map(tid), ...t }),
      ),
    ),
    ...o,
  });
}

const levelOf = (p: ProjectDoc) => level(ws, planProject(p, ws, FIXTURE_TODAY));

/** The project with the moves applied as pins */
function applied(p: ProjectDoc): ProjectDoc {
  const tasks = { ...p.tasks };
  for (const m of levelOf(p)) tasks[m.taskId] = { ...tasks[m.taskId], pinnedStart: m.pinnedStart };
  return { ...p, tasks };
}

describe("level", () => {
  it("leaves the demo alone: nobody is on two tasks at once", () => {
    const state = demoState();
    expect(level(state.workspace, planProject(activeProject(state), state.workspace, FIXTURE_TODAY))).toEqual([]);
  });

  it("puts one owner's parallel tasks one after the other, in workflow order", () => {
    const p = project([{ name: "Copy", estimateDays: 3 }, { name: "Layout" }]);
    expect(levelOf(p)).toEqual([{ taskId: tid("Layout"), pinnedStart: "2026-10-08", days: 3, why: "Anna is on Copy until 7 Oct, so this starts 8 Oct." }]);
  });

  it("places higher priority first", () => {
    const p = project([{ name: "Copy", estimateDays: 3 }, { name: "Layout", priority: "urgent" }]);
    expect(levelOf(p)).toEqual([{ taskId: tid("Copy"), pinnedStart: "2026-10-07", days: 2, why: "Anna is on Layout until 6 Oct, so this starts 7 Oct." }]);
  });

  it("lets successors follow their predecessors without a pin", () => {
    const p = project([{ name: "Copy", estimateDays: 3 }, { name: "Layout" }, { name: "Build", ownerId: BRUNO, deps: ["Layout"] }]);
    const moves = levelOf(p);
    expect(moves.map((m) => m.taskId)).toEqual([tid("Layout")]);
    const after = planProject(applied(p), ws, FIXTURE_TODAY).schedule;
    // Build now starts after Layout's new end (Fri 9 Oct): Monday 12
    expect(after.timings.get(tid("Build"))).toMatchObject({ start: "2026-10-12" });
    expect(after.timings.get(tid("Layout"))).toMatchObject({ start: "2026-10-08", end: "2026-10-09" });
  });

  it("never moves Review or Done work; Review holds its days, Done holds none", () => {
    const review = project([{ name: "Reviewed", status: "review", progress: 90, estimateDays: 3 }, { name: "Urgent", priority: "urgent" }]);
    expect(levelOf(review)).toEqual([{ taskId: tid("Urgent"), pinnedStart: "2026-10-08", days: 3, why: "Anna is on Reviewed until 7 Oct, so this starts 8 Oct." }]);
    const done = project([{ name: "Finished", status: "done", progress: 100, estimateDays: 3 }, { name: "Next" }]);
    expect(levelOf(done)).toEqual([]);
  });

  it("fits shares below a full day together", () => {
    // Two half-day tasks on the same day, and two 1-day tasks at 50% over two days
    expect(levelOf(project([{ name: "A", estimateDays: 0.5 }, { name: "B", estimateDays: 0.5 }]))).toEqual([]);
    expect(levelOf(project([{ name: "A", estimateDays: 1, allocation: 0.5 }, { name: "B", estimateDays: 1, allocation: 0.5 }]))).toEqual([]);
    // A third half-time task doesn't fit
    const three = project([
      { name: "A", estimateDays: 1, allocation: 0.5 },
      { name: "B", estimateDays: 1, allocation: 0.5 },
      { name: "C", estimateDays: 1, allocation: 0.5 },
    ]);
    expect(levelOf(three)).toEqual([expect.objectContaining({ taskId: tid("C"), pinnedStart: "2026-10-07", days: 2 })]);
  });

  it("delays a pinned task past a clash, and skips unowned work, milestones and unknown tasks", () => {
    const p = project([
      { name: "First", estimateDays: 3 },
      { name: "Pinned", pinnedStart: d("2026-10-06") },
      { name: "Nobody", ownerId: null },
      { name: "Gate", kind: "milestone", estimateDays: 0 },
      { name: "Unknown", estimateDays: null },
    ]);
    expect(levelOf(p)).toEqual([{ taskId: tid("Pinned"), pinnedStart: "2026-10-08", days: 2, why: "Anna is on First until 7 Oct, so this starts 8 Oct." }]);
  });

  it("leaves a project without a start date alone", () => {
    // No date at all: nothing to pin
    expect(levelOf(project([{ name: "Copy" }, { name: "Layout" }], { startDate: null }))).toEqual([]);
    // The start is the earliest pin: delaying that task would move the whole project
    expect(levelOf(project([{ name: "Copy", pinnedStart: d("2026-10-05") }, { name: "Layout", priority: "urgent" }], { startDate: null }))).toEqual([]);
  });

  it("reproduces the leveled schedule once the pins are applied, with no clash left", () => {
    const p = project([
      { name: "A", estimateDays: 3 },
      { name: "B", priority: "high" },
      { name: "C", deps: ["A"], estimateDays: 1.5 },
      { name: "D", ownerId: BRUNO, deps: ["B"] },
      { name: "E", priority: "urgent", deps: ["D"], estimateDays: 1 },
    ]);
    const leveled = applied(p);
    expect(levelOf(leveled)).toEqual([]);
    const sched = planProject(leveled, ws, FIXTURE_TODAY).schedule;
    const annaDays = new Map<number, number>();
    for (const t of Object.values(leveled.tasks)) {
      const timing = sched.timings.get(t.id);
      if (t.ownerId !== ANNA || timing?.kind !== "scheduled") continue;
      for (let j = timing.es; j < timing.finish; j++) annaDays.set(j, (annaDays.get(j) ?? 0) + t.estimateDays! / timing.duration);
    }
    expect(Math.max(...annaDays.values())).toBeLessThanOrEqual(1);
  });
});
