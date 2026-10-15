// The named fixture states of the registry (plan §4.1 FixtureName, §10.5): op samples, parser
// examples and palette phrases each run on one of them. Built from build.ts, deterministic, fresh
// objects on every call.
//
// - empty: the demo workspace before any project
// - demo: the website template with the sample team
// - demoSelected: demo with UI Design selected (selection is local, so the documents equal demo)
// - demoProposal: demo with a subtasks proposal on UI Design (the v0 breakdown, 6d)
// - demoPlan: demo with a reassign proposal, UI Design → Sara (v0's "plan")
// - demoMood3: demo with the moodboard shown and three references, so arranging doesn't clarify
// - demoMoodShown: demo with the moodboard shown and empty
// - demoNoTeam: demo with no people, members or owners
// - demoUnestimated: demo with UI Design's estimate cleared
// - generated60: a generated 60-task project
// - demoExtras: demo after some use: brief lines and edits, a closure, time off, a user template,
//   Giulia (active, outside the project), Paolo (archived) and an archived project (build.ts)
import { seededMinter } from "@/lib/domain/ids";
import { frontZs, placeNew } from "@/lib/domain/mood-geometry";
import type { PersonId, ProjectDoc, TaskId } from "@/lib/domain/schema";
import type { FixtureDocs, FixtureName } from "@/lib/ops/registry/_contract";
import { activeProject, demoExtrasState, demoState, emptyState, FIXTURE_NOW, type FixtureState, generated, taskByTitle } from "./build";

export interface NamedFixture extends FixtureState {
  name: FixtureName;
  selectedTaskId: TaskId | null;
}

/** Replaces the active project with `edit(project)` */
function editProject(state: FixtureState, edit: (p: ProjectDoc) => ProjectDoc): FixtureState {
  const project = activeProject(state);
  return { ...state, projects: { ...state.projects, [project.id]: edit(project) } };
}

const mint = () => seededMinter(9090);

function demoProposal(): FixtureState {
  const m = mint();
  return editProject(demoState(), (p) => ({
    ...p,
    proposal: {
      id: m("proposal"),
      createdAt: FIXTURE_NOW,
      source: "parser",
      kind: "subtasks",
      taskId: taskByTitle(p, "UI Design").id,
      items: [
        { stepId: m("step"), title: "Wireframes & flows", estimateDays: 1.5 },
        { stepId: m("step"), title: "Key screens", estimateDays: 2 },
        { stepId: m("step"), title: "Component library", estimateDays: 1.5 },
        { stepId: m("step"), title: "Prototype & handoff", estimateDays: 1 },
      ],
    },
  }));
}

function demoPlan(): FixtureState {
  const state = demoState();
  const sara = Object.values(state.workspace.people).find((x) => x.name === "Sara")!.id;
  const m = mint();
  return editProject(state, (p) => {
    const ui = taskByTitle(p, "UI Design");
    return {
      ...p,
      proposal: {
        id: m("proposal"),
        createdAt: FIXTURE_NOW,
        source: "parser",
        kind: "reassign",
        moves: [{ type: "owner", taskId: ui.id, from: ui.ownerId, to: sara, why: "Marta is 4d over capacity. Sara has room for its 6d." }],
      },
    };
  });
}

function withMood(count: number): FixtureState {
  const m = mint();
  const kinds = ["color", "note", "color"] as const;
  const zs = frontZs([], count);
  const placed: ReturnType<typeof placeNew>[] = [];
  const items = Array.from({ length: count }, (_, i) => {
    const kind = kinds[i % kinds.length];
    const box = placeNew(kind, {}, placed);
    placed.push(box);
    return {
      id: m("moodItem"),
      kind,
      ...box,
      z: zs[i],
      assetId: null,
      hex: kind === "color" ? (i === 0 ? "#0c0c0c" : "#c65d3b") : null,
      text: kind === "note" ? "Warm, tactile, editorial" : null,
    };
  });
  return editProject(demoState(), (p) => ({
    ...p,
    blocks: ["header", "metrics", "collection", "moodboard"],
    moodboard: { items: Object.fromEntries(items.map((it) => [it.id, it])) },
  }));
}

function demoNoTeam(): FixtureState {
  const state = demoState();
  const tasks = Object.fromEntries(Object.entries(activeProject(state).tasks).map(([id, t]) => [id, { ...t, ownerId: null }]));
  return editProject({ ...state, workspace: { ...state.workspace, people: {} } }, (p) => ({ ...p, memberIds: [], tasks }));
}

function demoUnestimated(): FixtureState {
  return editProject(demoState(), (p) => {
    const ui = taskByTitle(p, "UI Design");
    return { ...p, tasks: { ...p.tasks, [ui.id]: { ...ui, estimateDays: null } } };
  });
}

const BUILD: Record<FixtureName, () => FixtureState> = {
  empty: emptyState,
  demo: () => demoState(),
  demoSelected: () => demoState(),
  demoProposal,
  demoPlan,
  demoMood3: () => withMood(3),
  demoMoodShown: () => withMood(0),
  demoNoTeam,
  demoUnestimated,
  generated60: () => generated(60),
  demoExtras: () => demoExtrasState(),
};

/** A named fixture state with its local selection */
export function namedFixture(name: FixtureName): NamedFixture {
  const state = BUILD[name]();
  const selectedTaskId = name === "demoSelected" ? taskByTitle(activeProject(state), "UI Design").id : null;
  return { ...state, name, selectedTaskId };
}

/** The registry's view of a fixture: documents plus lookups that throw on a missing name */
export function fixtureDocs(name: FixtureName): FixtureDocs {
  return docsOf(namedFixture(name));
}

export function docsOf(state: NamedFixture): FixtureDocs {
  const name = state.name;
  const project = state.projectId !== null ? state.projects[state.projectId] : null;
  return {
    name,
    workspace: state.workspace,
    project,
    projects: state.projects,
    selectedTaskId: state.selectedTaskId,
    task(title: string): TaskId {
      if (!project) throw new Error(`Fixture ${name} has no project, so no task "${title}"`);
      return taskByTitle(project, title).id;
    },
    person(personName: string): PersonId {
      const person = Object.values(state.workspace.people).find((p) => p.name === personName);
      if (!person) throw new Error(`Fixture ${name} has no person "${personName}"`);
      return person.id;
    },
  };
}
