// Weekly load (plan §6.5): shares per ISO week, capacity with time off and closures, two
// projects, which projects count, the not-on-the-calendar list, overrides and the memo.
import { describe, expect, it } from "vitest";
import {
  type ClosureId,
  IsoDate,
  type Person,
  type PersonId,
  type ProjectDoc,
  type ProjectId,
  type TaskId,
  type TimeOffId,
  type WorkspaceDoc,
} from "@/lib/domain/schema";
import { loadFor, planProject, planWorkspace } from "@/lib/planning";
import { capacityInWeek, countsForLoad, roundLoad, weeklyLoad } from "@/lib/planning/load";
import {
  activeProject,
  byId,
  DEMO_PEOPLE,
  demoState,
  emptyWorkspace,
  FIXTURE_NOW,
  FIXTURE_TODAY,
  makePerson,
  makeProject,
  makeTask,
  taskByTitle,
} from "../../../../test/fixtures/v2/build";

const d = (s: string) => IsoDate.parse(s);
const PID = "prj_loadloadload1" as ProjectId;
const PID2 = "prj_loadloadload2" as ProjectId;
const ANNA = "per_annaannaanna" as PersonId;
const BRUNO = "per_brunobrunobru" as PersonId;

function person(o: Partial<Person> & Pick<Person, "id" | "name">): Person {
  return makePerson({ order: o.id === ANNA ? "a0" : "a1", capacityDaysPerWeek: 5, ...o });
}

function workspace(people: Person[], o: Partial<WorkspaceDoc> = {}): WorkspaceDoc {
  return emptyWorkspace({ people: byId(people), ...o });
}

/** A project of independent tasks starting on Monday 5 October 2026 (W41) unless told otherwise */
function project(id: ProjectId, tasks: { id: string; est: number | null; owner?: PersonId | null; alloc?: 1 | 0.5 | 0.75 | 0.25; pin?: string; status?: "todo" | "done" }[], o: Partial<ProjectDoc> = {}): ProjectDoc {
  return makeProject({
    id,
    workspaceId: emptyWorkspace().id,
    title: id,
    status: "active",
    startDate: d("2026-10-05"),
    startConfirmed: true,
    tasks: byId(
      tasks.map((t, i) =>
        makeTask({
          id: `tsk_${t.id.padEnd(12, "x")}` as TaskId,
          title: t.id,
          order: `a${i}`,
          estimateDays: t.est,
          ownerId: t.owner === undefined ? ANNA : t.owner,
          allocation: t.alloc ?? 1,
          pinnedStart: t.pin ? d(t.pin) : null,
          status: t.status ?? "todo",
          progress: t.status === "done" ? 100 : 0,
        }),
      ),
    ),
    ...o,
  });
}

const tid = (name: string) => `tsk_${name.padEnd(12, "x")}` as TaskId;

function reportOf(ws: WorkspaceDoc, projects: ProjectDoc[], overrides?: ReadonlyMap<TaskId, PersonId | null>) {
  return weeklyLoad(
    ws,
    projects.map((p) => planProject(p, ws, FIXTURE_TODAY)),
    overrides,
  );
}

const cellsOf = (report: ReturnType<typeof reportOf>, id: PersonId) =>
  Object.fromEntries([...(report.people.get(id) ?? new Map()).values()].map((c) => [c.week, { load: c.load, capacity: c.capacity }]));

describe("weeklyLoad", () => {
  it("splits the demo into ISO weeks per person", () => {
    const state = demoState();
    const report = reportOf(state.workspace, [activeProject(state)]);
    expect(cellsOf(report, DEMO_PEOPLE.marta)).toEqual({
      "2026-W40": { load: 2, capacity: 2 },
      "2026-W41": { load: 5, capacity: 2 },
      "2026-W42": { load: 3, capacity: 2 },
    });
    expect(cellsOf(report, DEMO_PEOPLE.luca)).toEqual({
      "2026-W42": { load: 2, capacity: 5 },
      "2026-W43": { load: 5, capacity: 5 },
      "2026-W44": { load: 1, capacity: 5 },
    });
    // Research is done: Sara carries nothing
    expect(report.people.has(DEMO_PEOPLE.sara)).toBe(false);
    expect(report.notOnCalendar.size).toBe(0);
  });

  it("adds the daily share estimate / duration, so the total equals the estimate (Q17)", () => {
    const ws = workspace([person({ id: ANNA, name: "Anna" })]);
    // 2.5 days at 100%: 3 working days of 5/6 each, Mon 5 – Wed 7 Oct. 3 days at 50%: 6 working days of 0.5.
    const p = project(PID, [
      { id: "half", est: 2.5 },
      { id: "alloc", est: 3, alloc: 0.5, pin: "2026-10-08" },
    ]);
    const report = reportOf(ws, [p]);
    // half: W41 2.5. alloc: Thu 8, Fri 9 in W41 (1), Mon 12 – Thu 15 in W42 (2).
    expect(cellsOf(report, ANNA)).toEqual({ "2026-W41": { load: 3.5, capacity: 5 }, "2026-W42": { load: 2, capacity: 5 } });
    const half = planProject(p, ws, FIXTURE_TODAY);
    expect(half.schedule.timings.get(tid("half"))).toMatchObject({ duration: 3 });
  });

  it("lowers capacity for time off and closures, and keeps tasks off closed days", () => {
    const anna = person({
      id: ANNA,
      name: "Anna",
      capacityDaysPerWeek: 4,
      timeOff: byId([{ id: "tof_annaoffanna" as TimeOffId, from: d("2026-10-06"), to: d("2026-10-07"), label: null }]),
    });
    const ws = workspace([anna], {
      closures: byId([{ id: "cls_closedclosed" as ClosureId, from: d("2026-10-12"), to: d("2026-10-13"), label: "Studio away" }]),
    });
    // W41: 5 working days, Anna off 2 → 4 × 3 / 5 = 2.4. W42: closed Mon–Tue → 4 × 3 / 5 = 2.4.
    expect(capacityInWeek(ws, anna, d("2026-10-05"))).toBe(2.4);
    expect(capacityInWeek(ws, anna, d("2026-10-14"))).toBe(2.4);
    expect(capacityInWeek(ws, anna, d("2026-10-19"))).toBe(4);
    expect(capacityInWeek(ws, { ...anna, capacityDaysPerWeek: null }, d("2026-10-19"))).toBeNull();

    // Time off doesn't move the task (scheduling runs on the project calendar); the closure does
    const p = project(PID, [{ id: "long", est: 7 }]);
    const report = reportOf(ws, [p]);
    // Mon 5 – Fri 9 (5 days), then Wed 14 and Thu 15 after the closure
    expect(cellsOf(report, ANNA)).toEqual({ "2026-W41": { load: 5, capacity: 2.4 }, "2026-W42": { load: 2, capacity: 2.4 } });
  });

  it("sums two projects in the same weeks, with the split by project", () => {
    const ws = workspace([person({ id: ANNA, name: "Anna" })]);
    const a = project(PID, [{ id: "one", est: 3 }]);
    const b = project(PID2, [{ id: "two", est: 4 }], { startDate: d("2026-10-07") });
    const report = reportOf(ws, [b, a]);
    const w41 = report.people.get(ANNA)!.get("2026-W41")!;
    // a: Mon–Wed (3); b: Wed–Fri (3), then Mon 12 (1)
    expect(w41.load).toBe(6);
    expect(Object.fromEntries(w41.byProject)).toEqual({ [PID]: 3, [PID2]: 3 });
    expect(report.people.get(ANNA)!.get("2026-W42")).toMatchObject({ load: 1, monday: "2026-10-12" });
  });

  it("counts only planning and active projects that are neither archived nor deleted", () => {
    const ws = workspace([person({ id: ANNA, name: "Anna" })]);
    const p = project(PID, [{ id: "one", est: 3 }]);
    const entry = { id: PID, createdAt: FIXTURE_NOW, archivedAt: null, deletedAt: null };
    expect(countsForLoad(ws, p)).toBe(true);
    expect(countsForLoad(ws, { ...p, status: "planning" })).toBe(true);
    expect(countsForLoad(ws, { ...p, status: "on-hold" })).toBe(false);
    expect(countsForLoad(ws, { ...p, status: "done" })).toBe(false);
    expect(countsForLoad({ projects: { [PID]: entry } }, p)).toBe(true);
    expect(countsForLoad({ projects: { [PID]: { ...entry, archivedAt: FIXTURE_NOW } } }, p)).toBe(false);
    expect(countsForLoad({ projects: { [PID]: { ...entry, deletedAt: FIXTURE_NOW } } }, p)).toBe(false);
    expect(reportOf(ws, [{ ...p, status: "on-hold" }]).people.size).toBe(0);
  });

  it("counts open work of active owners only, and lists what isn't on the calendar", () => {
    const ws = workspace([person({ id: ANNA, name: "Anna" }), person({ id: BRUNO, name: "Bruno", archived: true })]);
    const p = project(PID, [
      { id: "done", est: 2, status: "done" },
      { id: "nobody", est: 2, owner: null },
      { id: "archived", est: 2, owner: BRUNO },
      { id: "missing", est: 2, owner: "per_missingmissing" as PersonId },
      { id: "unsized", est: null },
      { id: "counted", est: 2 },
    ]);
    const report = reportOf(ws, [p]);
    expect(cellsOf(report, ANNA)).toEqual({ "2026-W41": { load: 2, capacity: 5 } });
    expect(report.people.has(BRUNO)).toBe(false);
    expect(report.notOnCalendar.get(ANNA)).toEqual([{ projectId: PID, taskId: tid("unsized") }]);
  });

  it("puts every task of a project with no date off the calendar", () => {
    const ws = workspace([person({ id: ANNA, name: "Anna" })]);
    const p = project(PID, [{ id: "one", est: 2 }, { id: "two", est: 1 }], { startDate: null });
    const report = reportOf(ws, [p]);
    expect(report.people.size).toBe(0);
    expect(report.notOnCalendar.get(ANNA)?.map((t) => t.taskId)).toEqual([tid("one"), tid("two")]);
  });

  it("applies owner overrides, and null unassigns", () => {
    const ws = workspace([person({ id: ANNA, name: "Anna" }), person({ id: BRUNO, name: "Bruno" })]);
    const p = project(PID, [{ id: "one", est: 2 }, { id: "two", est: 1 }]);
    const overrides = new Map<TaskId, PersonId | null>([
      [tid("one"), BRUNO],
      [tid("two"), null],
    ]);
    const report = reportOf(ws, [p], overrides);
    expect(cellsOf(report, BRUNO)).toEqual({ "2026-W41": { load: 2, capacity: 5 } });
    expect(report.people.has(ANNA)).toBe(false);
    expect(report.overrides).toBe(overrides);
  });

  it("never depends on the order of the plans or of record keys", () => {
    const ws = workspace([person({ id: ANNA, name: "Anna" })]);
    const a = project(PID, [{ id: "one", est: 2.5 }, { id: "two", est: 1.5, alloc: 0.75 }]);
    const b = project(PID2, [{ id: "three", est: 3.5, alloc: 0.25 }]);
    const shuffled: ProjectDoc = { ...a, tasks: Object.fromEntries(Object.entries(a.tasks).reverse()) };
    expect(reportOf(ws, [b, shuffled])).toEqual(reportOf(ws, [a, b]));
  });

  it("rounds figures to a millionth of a day", () => {
    expect(roundLoad(2 + 4e-16)).toBe(2);
    expect(roundLoad(0.8333333333)).toBe(0.833333);
  });
});

describe("planWorkspace and the load memo", () => {
  it("returns the same report for the same documents, and a new one when a project changes", () => {
    const state = demoState();
    const project = activeProject(state);
    const first = planWorkspace(state.workspace, [project], FIXTURE_TODAY);
    const again = planWorkspace(state.workspace, [project], FIXTURE_TODAY);
    expect(again.load).toBe(first.load);
    expect(again.plans[0]).toBe(first.plans[0]);
    // Another day: new plans, same load
    expect(planWorkspace(state.workspace, [project], d("2026-10-15")).load).toBe(first.load);

    const ui = taskByTitle(project, "UI Design");
    const edited: ProjectDoc = { ...project, tasks: { ...project.tasks, [ui.id]: { ...ui, ownerId: DEMO_PEOPLE.sara } } };
    const after = planWorkspace(state.workspace, [edited], FIXTURE_TODAY);
    expect(after.load).not.toBe(first.load);
    expect(after.load.people.get(DEMO_PEOPLE.sara)?.get("2026-W41")?.load).toBe(3);
  });

  it("keys the report on the overrides too", () => {
    const state = demoState();
    const plans = planWorkspace(state.workspace, [activeProject(state)], FIXTURE_TODAY).plans;
    const overrides = new Map<TaskId, PersonId | null>();
    const preview = loadFor(state.workspace, plans, overrides);
    expect(loadFor(state.workspace, plans, overrides)).toBe(preview);
    expect(loadFor(state.workspace, plans)).not.toBe(preview);
  });
});
