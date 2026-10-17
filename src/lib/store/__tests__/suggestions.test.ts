// The agent's suggestions (ported from v0 suggestionsFor): every phrase offered, in every kind of
// state, is one the fast parser routes, so a chip never lands on "unsupported".
import { describe, expect, it } from "vitest";
import { seededMinter } from "@/lib/domain/ids";
import { defaultLocalViewState, type LocalViewState } from "@/lib/domain/schema/local";
import type { ProjectDoc } from "@/lib/domain/schema/project";
import { fastParse } from "@/lib/interpret/fast";
import { parserContext } from "@/lib/store/engine";
import { CREATE_SUGGESTIONS, suggestionsFor } from "@/lib/store/suggestions";
import { activeProject, demoState, type FixtureState, FIXTURE_TODAY, taskByTitle } from "../../../../test/fixtures/v2/build";
import { emptyDemo } from "./support";

interface Case {
  name: string;
  state: FixtureState;
  local: (p: ProjectDoc) => Partial<LocalViewState>;
}

function editProject(state: FixtureState, edit: (p: ProjectDoc) => ProjectDoc): FixtureState {
  const p = activeProject(state);
  return { ...state, projects: { ...state.projects, [p.id]: edit(p) } };
}

const mint = seededMinter(3);
const ALL = ["cards", "board", "timeline", "team", "focus", "brief"] as const;

const CASES: Case[] = [
  { name: "the tracker", state: demoState(), local: () => ({}) },
  { name: "every view on the tracker", state: demoState({ views: [...ALL] }), local: () => ({}) },
  { name: "a selected task", state: demoState(), local: (p) => ({ selectedTaskId: taskByTitle(p, "UI Design").id }) },
  { name: "a done task selected", state: demoState(), local: (p) => ({ selectedTaskId: taskByTitle(p, "Research").id }) },
  { name: "a selection on the brief", state: demoState({ views: ["cards", "brief"] }), local: (p) => ({ activeView: "brief", selectedTaskId: taskByTitle(p, "Visual Direction").id }) },
  { name: "the brief", state: demoState({ views: ["cards", "brief"] }), local: () => ({ activeView: "brief" }) },
  { name: "focus", state: demoState({ views: ["cards", "focus"] }), local: () => ({ activeView: "focus" }) },
  { name: "the team", state: demoState({ views: ["cards", "team"] }), local: () => ({ activeView: "team" }) },
  {
    name: "a team without people",
    state: editProject(demoState({ views: ["cards", "team"] }), (p) => ({
      ...p,
      memberIds: [],
      tasks: Object.fromEntries(Object.entries(p.tasks).map(([id, t]) => [id, { ...t, ownerId: null }])),
    })),
    local: () => ({ activeView: "team" }),
  },
  {
    name: "a member whose capacity is unknown",
    state: (() => {
      const s = demoState({ views: ["cards", "team"] });
      const marta = s.workspace.people["per_demomarta" as never];
      return { ...s, workspace: { ...s.workspace, people: { ...s.workspace.people, [marta.id]: { ...marta, capacityDaysPerWeek: null } } } };
    })(),
    local: () => ({ activeView: "team" }),
  },
  {
    name: "a pending breakdown",
    state: editProject(demoState(), (p) => ({
      ...p,
      proposal: { id: mint("proposal"), createdAt: p.createdAt, source: "parser", kind: "subtasks", taskId: taskByTitle(p, "UI Design").id, items: [{ stepId: mint("step"), title: "Wireframes", estimateDays: null }] },
    })),
    local: () => ({}),
  },
  {
    name: "a pending plan",
    state: editProject(demoState(), (p) => ({
      ...p,
      proposal: {
        id: mint("proposal"),
        createdAt: p.createdAt,
        source: "parser",
        kind: "reassign",
        moves: [{ type: "owner", taskId: taskByTitle(p, "UI Design").id, from: "per_demomarta" as never, to: "per_demosara" as never, why: "Sara has room." }],
      },
    })),
    local: () => ({}),
  },
  {
    name: "a moodboard shown",
    state: editProject(demoState(), (p) => ({ ...p, blocks: ["header", "metrics", "collection", "moodboard"] })),
    local: () => ({}),
  },
];

describe("suggestions", () => {
  it("offer the three ways to start before any project", () => {
    const empty = emptyDemo();
    expect(suggestionsFor({ project: null, ws: empty.workspace, local: defaultLocalViewState(null) })).toEqual(CREATE_SUGGESTIONS);
  });

  it.each(CASES.map((c) => [c.name, c] as const))("are all understood: %s", (_name, c) => {
    const project = activeProject(c.state);
    const local = { ...defaultLocalViewState(project), ...c.local(project) };
    const phrases = suggestionsFor({ project, ws: c.state.workspace, local });
    expect(phrases.length).toBeGreaterThan(0);
    const docs = { workspace: c.state.workspace, projects: c.state.projects };
    for (const say of phrases) {
      const parsed = fastParse(say, parserContext({ docs, projectId: project.id, local, today: FIXTURE_TODAY, mint: seededMinter(1) }));
      expect(parsed.status, say).toBe("matched");
    }
  });

  it("ask for an unknown capacity first on the team (Q3)", () => {
    const c = CASES.find((x) => x.name === "a member whose capacity is unknown")!;
    const project = activeProject(c.state);
    const out = suggestionsFor({ project, ws: c.state.workspace, local: { ...defaultLocalViewState(project), activeView: "team" } });
    expect(out[0]).toBe("Set Marta's capacity to 4 days a week");
  });
});
