// The v2 fixture builders (test/fixtures/v2/build.ts) produce valid documents: both strict
// schemas parse them and every invariant holds (plan §11 step 7).
import { describe, expect, it } from "vitest";
import { topoOrder } from "@/lib/domain/invariants/graph";
import { checkProject, checkWorkspace, docBytes } from "@/lib/domain/invariants/check";
import { DOC_BYTES_MAX } from "@/lib/domain/limits";
import { sortedByOrder } from "@/lib/domain/order";
import { ProjectDocSchema, WorkspaceDocSchema } from "@/lib/domain/schema";
import {
  activeProject,
  DEMO_PEOPLE,
  DEMO_WORKSPACE_ID,
  demoState,
  emptyProjectState,
  emptyState,
  type FixtureState,
  generated,
  multiProject,
  SAMPLE_START,
  taskByTitle,
} from "../../../../test/fixtures/v2/build";

function expectValid(state: FixtureState) {
  const ws = WorkspaceDocSchema.safeParse(state.workspace);
  expect(ws.success, ws.error?.message).toBe(true);
  expect(checkWorkspace(state.workspace)).toEqual([]);
  for (const [id, project] of Object.entries(state.projects)) {
    const parsed = ProjectDocSchema.safeParse(project);
    expect(parsed.success, parsed.error?.message).toBe(true);
    expect(checkProject(project)).toEqual([]);
    expect(project.id).toBe(id);
    expect(project.workspaceId).toBe(state.workspace.id);
    expect(state.workspace.projects[project.id]).toMatchObject({ id: project.id, archivedAt: null, deletedAt: null });
  }
  if (state.projectId !== null) expect(state.projects[state.projectId]).toBeDefined();
}

describe("fixture builders", () => {
  it("build a valid empty workspace, with and without a project", () => {
    const empty = emptyState();
    expectValid(empty);
    expect(empty.projectId).toBeNull();
    expect(empty.workspace.id).toBe(DEMO_WORKSPACE_ID);

    const withProject = emptyProjectState();
    expectValid(withProject);
    expect(Object.keys(activeProject(withProject).tasks)).toHaveLength(0);
  });

  it("build the v0 template in v2 (plan §8.3)", () => {
    const state = demoState();
    expectValid(state);
    const project = activeProject(state);
    expect(project).toMatchObject({
      title: "New website",
      kind: "website",
      status: "active",
      startDate: SAMPLE_START,
      startConfirmed: false,
      currency: "EUR",
      autoChain: true,
      requireReview: false,
      views: ["cards"],
      blocks: ["header", "metrics", "collection"],
      memberIds: [DEMO_PEOPLE.marta, DEMO_PEOPLE.sara, DEMO_PEOPLE.luca],
    });
    const rows = sortedByOrder(project.tasks).map((t) => [t.title, t.status, t.priority, t.progress, t.estimateDays, t.ownerId]);
    expect(rows).toEqual([
      ["Research", "done", "low", 100, 3, DEMO_PEOPLE.sara],
      ["Visual Direction", "review", "high", 85, 4, DEMO_PEOPLE.marta],
      ["UI Design", "active", "urgent", 30, 6, DEMO_PEOPLE.marta],
      ["Development", "todo", "medium", 0, 8, DEMO_PEOPLE.luca],
    ]);
    // A chain in workflow order; Research's completion time is unknown for a sample
    expect(topoOrder(project).order.map((id) => project.tasks[id].title)).toEqual(["Research", "Visual Direction", "UI Design", "Development"]);
    expect(taskByTitle(project, "Development").dependsOn).toEqual([taskByTitle(project, "UI Design").id]);
    expect(taskByTitle(project, "Research").completedAt).toBeNull();

    const people = Object.values(state.workspace.people).map((p) => [p.id, p.name, p.role, p.capacityDaysPerWeek]);
    expect(people).toEqual([
      [DEMO_PEOPLE.marta, "Marta", "Art director", 2],
      [DEMO_PEOPLE.sara, "Sara", "Designer", 4],
      [DEMO_PEOPLE.luca, "Luca", "Developer", 5],
    ]);
  });

  it("build the demo with other views and blocks", () => {
    const state = demoState({ views: ["cards", "timeline", "team"], blocks: ["header", "metrics", "collection", "moodboard"] });
    expectValid(state);
    expect(activeProject(state).views).toEqual(["cards", "timeline", "team"]);
  });

  it.each([60, 150, 300])("build a valid %i-task project", (n) => {
    const state = generated(n, { stepsPerTask: 3, predsMean: 1.5, people: 8 });
    expectValid(state);
    const project = activeProject(state);
    const tasks = Object.values(project.tasks);
    expect(tasks).toHaveLength(n);
    expect(Object.keys(state.workspace.people)).toHaveLength(8);
    // Rich enough to exercise planning: milestones, unknown estimates, every status, a DAG
    expect(tasks.some((t) => t.kind === "milestone")).toBe(true);
    expect(tasks.some((t) => t.kind === "task" && t.estimateDays === null)).toBe(true);
    expect(new Set(tasks.map((t) => t.status))).toEqual(new Set(["todo", "active", "review", "done"]));
    expect(tasks.filter((t) => t.kind === "task").every((t) => t.steps.length === 3)).toBe(true);
    const edges = tasks.reduce((s, t) => s + t.dependsOn.length, 0);
    expect(edges / n).toBeGreaterThan(1.1);
    expect(edges / n).toBeLessThan(1.7);
    expect(topoOrder(project).cyclic).toEqual([]);
  });

  it("build a valid 500-task project within the size limit", () => {
    const state = generated(500, { stepsPerTask: 2, moodItems: 200, briefLines: 80 });
    expectValid(state);
    expect(docBytes(activeProject(state))).toBeLessThan(DOC_BYTES_MAX);
  });

  it("build mood items and brief lines on request", () => {
    const state = generated(20, { moodItems: 30, briefLines: 6 });
    expectValid(state);
    const project = activeProject(state);
    expect(Object.keys(project.moodboard.items)).toHaveLength(30);
    expect(project.brief.lines).toHaveLength(6);
    expect(project.blocks).toContain("moodboard");
  });

  it("build several projects on one team", () => {
    const small = multiProject();
    expectValid(small);
    expect(Object.keys(small.projects)).toHaveLength(3);
    expect(Object.values(small.projects).reduce((s, p) => s + Object.keys(p.tasks).length, 0)).toBe(150);

    const large = multiProject({ projects: 10, tasksPerProject: 150 });
    expectValid(large);
    expect(Object.keys(large.workspace.projects)).toHaveLength(10);
    // Every owner is a person of the shared team
    for (const project of Object.values(large.projects)) {
      for (const task of Object.values(project.tasks)) {
        if (task.ownerId !== null) expect(large.workspace.people[task.ownerId]).toBeDefined();
      }
    }
  });

  it("are deterministic, and the seed changes the result", () => {
    expect(generated(60)).toEqual(generated(60));
    expect(demoState()).toEqual(demoState());
    expect(multiProject()).toEqual(multiProject());
    expect(generated(60, { seed: 1 })).not.toEqual(generated(60, { seed: 2 }));
  });

  it("return fresh objects on every call", () => {
    const a = demoState();
    const b = demoState();
    activeProject(a).views.push("board");
    expect(activeProject(b).views).toEqual(["cards"]);
  });
});
