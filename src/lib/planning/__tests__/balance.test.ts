// Balance v2 (plan §6.6): exactly UI Design → Sara on the demo, the role preference, Review and
// Done never moving, the every-week rule, other projects' load, unowned work and the shift fallback.
import { describe, expect, it } from "vitest";
import {
  IsoDate,
  type Person,
  type PersonId,
  type ProjectDoc,
  type ProjectId,
  type Task,
  type TaskId,
  type TimeOffId,
  type WorkspaceDoc,
} from "@/lib/domain/schema";
import { planProject } from "@/lib/planning";
import { balance, type BalanceOptions } from "@/lib/planning/balance";
import {
  activeProject,
  byId,
  DEMO_PEOPLE,
  demoState,
  emptyWorkspace,
  FIXTURE_TODAY,
  type FixtureState,
  makePerson,
  makeProject,
  makeTask,
  taskByTitle,
  withProject,
} from "../../../../test/fixtures/v2/build";

const d = (s: string) => IsoDate.parse(s);

function run(state: FixtureState, opts?: BalanceOptions, scope: ProjectId = state.projectId!) {
  const plans = Object.values(state.projects).map((p) => planProject(p, state.workspace, FIXTURE_TODAY));
  return balance(state.workspace, plans, scope, opts);
}

/** The demo with its workspace and project edited */
function demoWith(edit: { people?: (ws: WorkspaceDoc) => WorkspaceDoc["people"]; tasks?: (p: ProjectDoc) => Partial<Record<string, Partial<Task>>> } = {}): FixtureState {
  const state = demoState();
  const p = activeProject(state);
  const people = edit.people ? edit.people(state.workspace) : state.workspace.people;
  const changes = edit.tasks ? edit.tasks(p) : {};
  const tasks = { ...p.tasks };
  for (const [title, change] of Object.entries(changes)) {
    const t = taskByTitle(p, title);
    tasks[t.id] = { ...t, ...change };
  }
  return { ...state, workspace: { ...state.workspace, people }, projects: { [p.id]: { ...p, tasks } } };
}

const PAOLA = "per_paolapaolapao" as PersonId;

describe("the demo", () => {
  it("proposes exactly one move: UI Design → Sara", () => {
    const state = demoState();
    const p = activeProject(state);
    const ui = taskByTitle(p, "UI Design");
    const expected = {
      moves: [{ type: "owner", taskId: ui.id, from: DEMO_PEOPLE.marta, to: DEMO_PEOPLE.sara, why: "Marta is 4d over capacity. Sara has room for its 6d." }],
      blocked: null,
    };
    expect(run(state)).toEqual(expected);
    // /demo shows owner moves only
    expect(run(state, { allowShift: false })).toEqual(expected);
  });

  it("returns nothing for a project it wasn't given", () => {
    expect(run(demoState(), {}, "prj_missingmissing" as ProjectId)).toEqual({ moves: [], blocked: null });
  });
});

describe("receivers", () => {
  it("prefer the giver's role over more room", () => {
    // Paola is an art director like Marta, with 3 days free a week against Sara's 4
    const state = demoWith({
      people: (ws) => ({
        ...ws.people,
        [PAOLA]: makePerson({ id: PAOLA, name: "Paola", role: "  art DIRECTOR ", capacityDaysPerWeek: 3, order: "a5" }),
      }),
    });
    const { moves } = run(state);
    expect(moves).toEqual([expect.objectContaining({ type: "owner", to: PAOLA, why: "Marta is 4d over capacity. Paola has room for its 6d." })]);
  });

  it("must have room in every week of the task, not just in total", () => {
    // Sara can do 5 a week but is off Mon 12 – Wed 14 Oct: 2 days in W42 for UI Design's 3.
    // Over W41–W42 she has 7 free, more than the 6 needed; Luca has 3 free in W42 and fits.
    const state = demoWith({
      people: (ws) => ({
        ...ws.people,
        [DEMO_PEOPLE.sara]: {
          ...ws.people[DEMO_PEOPLE.sara],
          capacityDaysPerWeek: 5,
          timeOff: byId([{ id: "tof_saraoffsaraof" as TimeOffId, from: d("2026-10-12"), to: d("2026-10-14"), label: null }]),
        },
      }),
    });
    const { moves } = run(state);
    expect(moves).toEqual([expect.objectContaining({ to: DEMO_PEOPLE.luca, why: "Marta is 4d over capacity. Luca has room for its 6d." })]);
  });

  it("count other projects' load in the same weeks", () => {
    const state = demoState();
    // Sara has 3 days in W41 on another project, so 1 left: Luca takes UI Design
    const other = makeProject({
      id: "prj_otherotherother" as ProjectId,
      workspaceId: state.workspace.id,
      title: "Other",
      status: "active",
      startDate: d("2026-10-05"),
      tasks: byId([makeTask({ id: "tsk_otherotherother" as TaskId, title: "Logo", order: "a0", estimateDays: 3, ownerId: DEMO_PEOPLE.sara })]),
    });
    const both = { ...withProject(state, other), projectId: state.projectId };
    expect(run(both).moves).toEqual([expect.objectContaining({ to: DEMO_PEOPLE.luca })]);
    // An archived project doesn't count
    const archived: FixtureState = {
      ...both,
      workspace: { ...both.workspace, projects: { ...both.workspace.projects, [other.id]: { ...both.workspace.projects[other.id], archivedAt: state.workspace.createdAt } } },
    };
    expect(run(archived).moves).toEqual([expect.objectContaining({ to: DEMO_PEOPLE.sara })]);
  });

  it("never include archived people or unknown capacities", () => {
    const state = demoWith({
      people: (ws) => ({
        ...ws.people,
        [DEMO_PEOPLE.sara]: { ...ws.people[DEMO_PEOPLE.sara], archived: true },
        [DEMO_PEOPLE.luca]: { ...ws.people[DEMO_PEOPLE.luca], capacityDaysPerWeek: null },
      }),
    });
    expect(run(state, { allowShift: false })).toEqual({ moves: [], blocked: { personId: DEMO_PEOPLE.marta, over: 4 } });
  });
});

describe("candidates", () => {
  it("never move Review or Done work: Marta stays blocked", () => {
    const state = demoWith({ tasks: () => ({ "UI Design": { status: "review", progress: 90 } }) });
    expect(run(state)).toEqual({ moves: [], blocked: { personId: DEMO_PEOPLE.marta, over: 4 } });
  });

  it("start with the task least under way", () => {
    // Marta also owns Research (to do, 0%) in W40: it moves first, then she is within capacity in W40 but not in W41–W42
    const state = demoWith({ tasks: () => ({ Research: { status: "todo", progress: 0, ownerId: DEMO_PEOPLE.marta } }) });
    const p = activeProject(state);
    const { moves } = run(state);
    expect(moves.map((m) => m.taskId)).toEqual([taskByTitle(p, "Research").id, taskByTitle(p, "UI Design").id]);
    // Research (W40 3 days, Marta 7 over): Luca has 5 free there against Sara's 4
    expect(moves[0]).toMatchObject({ to: DEMO_PEOPLE.luca, why: "Marta is 7d over capacity. Luca has room for its 3d." });
    expect(moves[1]).toMatchObject({ to: DEMO_PEOPLE.sara, why: "Marta is 4d over capacity. Sara has room for its 6d." });
  });

  it("stop at maxMoves", () => {
    const state = demoWith({ tasks: () => ({ Research: { status: "todo", progress: 0, ownerId: DEMO_PEOPLE.marta } }) });
    expect(run(state, { maxMoves: 1 }).moves).toHaveLength(1);
  });
});

describe("unowned work", () => {
  it("goes to whoever has the most room in every week, unless turned off", () => {
    const state = demoWith({ tasks: () => ({ Research: { status: "todo", progress: 0, ownerId: null, priority: "medium" } }) });
    const p = activeProject(state);
    const { moves } = run(state);
    // Research runs in W40: Luca 5 free, Sara 4
    expect(moves[0]).toEqual({ type: "owner", taskId: taskByTitle(p, "Research").id, from: null, to: DEMO_PEOPLE.luca, why: "Nobody owns it yet. Luca has room for its 3d." });
    expect(moves[1]).toMatchObject({ taskId: taskByTitle(p, "UI Design").id, to: DEMO_PEOPLE.sara });
    expect(run(state, { assignUnowned: false }).moves.map((m) => m.taskId)).toEqual([taskByTitle(p, "UI Design").id]);
  });
});

describe("the shift fallback", () => {
  const ANNA = "per_annaannaanna" as PersonId;
  const BRUNO = "per_brunobrunobru" as PersonId;
  const people: Person[] = [
    makePerson({ id: ANNA, name: "Anna", capacityDaysPerWeek: 5, order: "a0" }),
    makePerson({ id: BRUNO, name: "Bruno", capacityDaysPerWeek: 5, order: "a1" }),
  ];
  // Anna has Copywriting and Layout side by side, Mon 5 – Wed 7 Oct: 6 days in W41 against 5.
  // Bruno is full for two weeks with Build, which sets the end: both of Anna's tasks have 7 days of float.
  const tid = (n: string) => `tsk_${n.toLowerCase().padEnd(12, "x")}` as TaskId;
  const project = makeProject({
    id: "prj_shiftshiftshi" as ProjectId,
    workspaceId: emptyWorkspace().id,
    title: "Shift",
    status: "active",
    startDate: d("2026-10-05"),
    startConfirmed: true,
    tasks: byId([
      makeTask({ id: tid("Copywriting"), title: "Copywriting", order: "a0", estimateDays: 3, ownerId: ANNA }),
      makeTask({ id: tid("Layout"), title: "Layout", order: "a1", estimateDays: 3, ownerId: ANNA, status: "active", progress: 20 }),
      makeTask({ id: tid("Build"), title: "Build", order: "a2", estimateDays: 10, ownerId: BRUNO }),
    ]),
  });
  const state = withProject({ workspace: emptyWorkspace({ people: byId(people) }), projects: {}, projectId: null }, project);

  it("shifts the least started task by the smallest amount that clears the week", () => {
    // Copywriting moved 3 days starts Thu 8 Oct: 2 days in W41 (with Layout's 3: 5) and 1 in W42
    expect(run(state)).toEqual({
      moves: [{ type: "shift", taskId: tid("Copywriting"), days: 3, pinnedStart: "2026-10-08", why: "Shift Copywriting by 3 days: it has 7 days of float" }],
      blocked: null,
    });
  });

  it("reports the giver as blocked when shifts are off", () => {
    expect(run(state, { allowShift: false })).toEqual({ moves: [], blocked: { personId: ANNA, over: 1 } });
  });

  it("needs float: with none, the giver is blocked", () => {
    const tight: ProjectDoc = { ...project, deadline: d("2026-10-07") };
    expect(run({ ...state, projects: { [project.id]: tight } })).toEqual({ moves: [], blocked: { personId: ANNA, over: 1 } });
  });
});
