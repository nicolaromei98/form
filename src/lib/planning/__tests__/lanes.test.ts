// The Phase 1 Team lane (plan §6.5): the demo values week by week, the reassign preview, the
// standard week, unknown capacities, the unassigned row and the rows themselves.
import { describe, expect, it } from "vitest";
import { IsoDate, type PersonId, type ProjectDoc, type TaskId, type WorkspaceDoc } from "@/lib/domain/schema";
import { planProject } from "@/lib/planning";
import { laneLoads, type LaneLoad } from "@/lib/planning/lanes";
import { weeklyLoad } from "@/lib/planning/load";
import {
  activeProject,
  byId,
  DEMO_PEOPLE,
  demoState,
  FIXTURE_TODAY,
  type FixtureState,
  makePerson,
  makeProject,
  makeTask,
  taskByTitle,
  withProject,
} from "../../../../test/fixtures/v2/build";

const d = (s: string) => IsoDate.parse(s);

function lanesOf(state: FixtureState, overrides?: ReadonlyMap<TaskId, PersonId | null>): LaneLoad[] {
  const plans = Object.values(state.projects).map((p) => planProject(p, state.workspace, FIXTURE_TODAY));
  const plan = plans.find((p) => p.project.id === state.projectId)!;
  return laneLoads(plan, weeklyLoad(state.workspace, plans, overrides), state.workspace);
}

const laneOf = (lanes: LaneLoad[], id: PersonId | null) => lanes.find((l) => l.personId === id)!;

describe("the demo lanes", () => {
  const state = demoState();
  const project = activeProject(state);
  const lanes = lanesOf(state);

  it("has one row per member, in member order, then the unassigned row", () => {
    expect(lanes.map((l) => l.personId)).toEqual([DEMO_PEOPLE.marta, DEMO_PEOPLE.sara, DEMO_PEOPLE.luca, null]);
  });

  it("puts Marta 4 days over: W40 2, W41 5, W42 3 against 2 a week (10/6d)", () => {
    expect(laneOf(lanes, DEMO_PEOPLE.marta)).toEqual({
      personId: DEMO_PEOPLE.marta,
      taskIds: ["Visual Direction", "UI Design"].map((t) => taskByTitle(project, t).id),
      days: 10,
      unsized: 0,
      capacity: 6,
      over: 4,
      free: 0,
      otherProjectsDays: 0,
      weeks: ["2026-W40", "2026-W41", "2026-W42"],
    });
  });

  it("gives Sara, with nothing open here, one standard week (0/4d, 4d free)", () => {
    expect(laneOf(lanes, DEMO_PEOPLE.sara)).toMatchObject({ days: 0, capacity: 4, over: 0, free: 4, weeks: [], taskIds: [] });
  });

  it("gives Luca 7 days free: W42 2, W43 5, W44 1 against 5 a week (8/15d)", () => {
    expect(laneOf(lanes, DEMO_PEOPLE.luca)).toMatchObject({
      days: 8,
      capacity: 15,
      over: 0,
      free: 7,
      weeks: ["2026-W42", "2026-W43", "2026-W44"],
    });
  });

  it("leaves the unassigned row empty, without a verdict", () => {
    expect(laneOf(lanes, null)).toEqual({
      personId: null,
      taskIds: [],
      days: 0,
      unsized: 0,
      capacity: null,
      over: null,
      free: null,
      otherProjectsDays: 0,
      weeks: [],
    });
  });

  it("previews UI Design → Sara: Marta 4/4d, Sara 6/8d with 2d free", () => {
    const ui = taskByTitle(project, "UI Design").id;
    const after = lanesOf(state, new Map([[ui, DEMO_PEOPLE.sara]]));
    expect(laneOf(after, DEMO_PEOPLE.marta)).toMatchObject({ days: 4, capacity: 4, over: 0, free: 0, weeks: ["2026-W40", "2026-W41"] });
    expect(laneOf(after, DEMO_PEOPLE.sara)).toMatchObject({ days: 6, capacity: 8, over: 0, free: 2, weeks: ["2026-W41", "2026-W42"], taskIds: [ui] });
    expect(laneOf(after, DEMO_PEOPLE.luca)).toMatchObject({ days: 8, capacity: 15, free: 7 });
  });

  it("unassigns through a null override", () => {
    const ui = taskByTitle(project, "UI Design").id;
    const after = lanesOf(state, new Map([[ui, null]]));
    expect(laneOf(after, null)).toMatchObject({ taskIds: [ui], days: 6, capacity: null, weeks: ["2026-W41", "2026-W42"] });
    expect(laneOf(after, DEMO_PEOPLE.marta)).toMatchObject({ days: 4, over: 0 });
  });
});

describe("lanes", () => {
  it("shows the days but no verdict for an unknown capacity (Q3)", () => {
    const state = demoState();
    const marta = state.workspace.people[DEMO_PEOPLE.marta];
    const ws: WorkspaceDoc = { ...state.workspace, people: { ...state.workspace.people, [marta.id]: { ...marta, capacityDaysPerWeek: null } } };
    const lanes = lanesOf({ ...state, workspace: ws });
    expect(laneOf(lanes, DEMO_PEOPLE.marta)).toMatchObject({ days: 10, capacity: null, over: null, free: null });
    const sara = ws.people[DEMO_PEOPLE.sara];
    const both = lanesOf({ ...state, workspace: { ...ws, people: { ...ws.people, [sara.id]: { ...sara, capacityDaysPerWeek: null } } } });
    expect(laneOf(both, DEMO_PEOPLE.sara)).toMatchObject({ days: 0, capacity: null, over: null, free: null });
  });

  it("counts open tasks without dates as unsized, in the lane and in the report", () => {
    const state = demoState();
    const project = activeProject(state);
    const ui = taskByTitle(project, "UI Design");
    const edited: ProjectDoc = { ...project, tasks: { ...project.tasks, [ui.id]: { ...ui, estimateDays: null } } };
    const next = { ...state, projects: { [project.id]: edited } };
    const lanes = lanesOf(next);
    // UI Design has no estimate and Development waits on it: neither is on the calendar
    expect(laneOf(lanes, DEMO_PEOPLE.marta)).toMatchObject({ days: 4, unsized: 1, weeks: ["2026-W40", "2026-W41"] });
    expect(laneOf(lanes, DEMO_PEOPLE.luca)).toMatchObject({ days: 0, unsized: 1, capacity: 5, free: 5, weeks: [] });
    const plan = planProject(edited, state.workspace, FIXTURE_TODAY);
    const report = weeklyLoad(state.workspace, [plan]);
    expect(report.notOnCalendar.get(DEMO_PEOPLE.marta)).toEqual([{ projectId: project.id, taskId: ui.id }]);
    expect(report.notOnCalendar.get(DEMO_PEOPLE.luca)).toEqual([{ projectId: project.id, taskId: taskByTitle(project, "Development").id }]);
  });

  it("adds an active owner who isn't a member, and leaves archived members out", () => {
    const state = demoState();
    const project = activeProject(state);
    const giulia = makePerson({ id: "per_giuliagiulia" as PersonId, name: "Giulia", order: "a5", capacityDaysPerWeek: 3 });
    const marta = state.workspace.people[DEMO_PEOPLE.marta];
    const ws: WorkspaceDoc = { ...state.workspace, people: { ...state.workspace.people, [giulia.id]: giulia, [marta.id]: { ...marta, archived: true } } };
    const dev = taskByTitle(project, "Development");
    const edited: ProjectDoc = { ...project, tasks: { ...project.tasks, [dev.id]: { ...dev, ownerId: giulia.id } } };
    const lanes = lanesOf({ workspace: ws, projects: { [project.id]: edited }, projectId: project.id });
    expect(lanes.map((l) => l.personId)).toEqual([DEMO_PEOPLE.sara, DEMO_PEOPLE.luca, giulia.id, null]);
    // Marta is archived: her two tasks are unassigned (Q7)
    expect(laneOf(lanes, null)).toMatchObject({ days: 10, taskIds: ["Visual Direction", "UI Design"].map((t) => taskByTitle(project, t).id) });
    // W42 2, W43 5, W44 1 against 3 a week: W43's overload isn't hidden by the slack around it
    expect(laneOf(lanes, giulia.id)).toMatchObject({ days: 8, capacity: 9, over: 2, free: 3 });
  });

  it("draws other projects' load in the same weeks, and keeps its own project when it is on hold", () => {
    const state = demoState();
    const project = activeProject(state);
    // A second project gives Luca 3 days in W43 (Mon 19 – Wed 21 Oct)
    const other = makeProject({
      id: "prj_otherotherother" as ProjectDoc["id"],
      workspaceId: state.workspace.id,
      title: "Other",
      status: "active",
      startDate: d("2026-10-19"),
      memberIds: [DEMO_PEOPLE.luca],
      tasks: byId([makeTask({ id: "tsk_otherotherother" as TaskId, title: "Spike", order: "a0", estimateDays: 3, ownerId: DEMO_PEOPLE.luca })]),
    });
    const both = withProject(state, other);
    const lanes = lanesOf({ ...both, projectId: project.id });
    // W43: 5 here + 3 there against 5: 3 over; W42 and W44 keep 3 + 4 free
    expect(laneOf(lanes, DEMO_PEOPLE.luca)).toMatchObject({ days: 8, otherProjectsDays: 3, capacity: 15, over: 3, free: 7 });

    const onHold: ProjectDoc = { ...project, status: "on-hold" };
    const held = lanesOf({ ...both, projects: { ...both.projects, [project.id]: onHold }, projectId: project.id });
    expect(laneOf(held, DEMO_PEOPLE.luca)).toMatchObject({ days: 8, otherProjectsDays: 3, over: 3 });
  });
});
