// The /demo seed (plan §8.3): the demo workspace, the website template as seeds, and the two
// expansions (create a demo project, add the sample team) applied through the real runner.
import { describe, expect, it } from "vitest";
import { SAMPLE_PERSON_IDS, SAMPLE_START } from "@/lib/demo/sample";
import { addSampleTeam, createDemoProject, DEMO_TASKS, demoDraft, demoSeeds, demoWorkspace } from "@/lib/demo/seed";
import { seededMinter } from "@/lib/domain/ids";
import { checkProject, checkWorkspace } from "@/lib/domain/invariants/check";
import { sortedByOrder } from "@/lib/domain/order";
import type { PersonId, ProjectDoc, WorkspaceDoc } from "@/lib/domain/schema";
import { ProjectDocSchema, ProjectDraftSchema, TaskSeedSchema, WorkspaceDocSchema } from "@/lib/domain/schema";
import { defaultLocalViewState } from "@/lib/domain/schema/local";
import { type DocsState, runCommand } from "@/lib/ops/command";
import type { Op } from "@/lib/ops/build";
import { FIXTURE_NOW, FIXTURE_TODAY } from "../../../../test/fixtures/v2/build";

const NOW = FIXTURE_NOW;

function apply(state: DocsState, projectId: ProjectDoc["id"] | null, ops: Op[]) {
  let n = 0;
  return runCommand(
    state,
    { ops, local: [], notes: [], notices: [], source: "direct", text: null },
    {
      now: NOW,
      actorId: null,
      projectId,
      local: defaultLocalViewState(projectId ? state.projects[projectId] : null),
      today: FIXTURE_TODAY,
      newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    },
  );
}

const fresh = (): DocsState => ({ workspace: demoWorkspace(NOW, "Europe/Rome"), projects: {} });
const req = { title: "New website", startAs: "timeline" as const, wantsMoodboard: false, replace: false };

describe("demoWorkspace", () => {
  it("is a valid workspace with the sample team at 2, 4 and 5 days a week, in Team row order", () => {
    const ws = demoWorkspace(NOW, "Europe/Rome");
    expect(WorkspaceDocSchema.safeParse(ws).success).toBe(true);
    expect(checkWorkspace(ws)).toEqual([]);
    expect(sortedByOrder(ws.people).map((p) => [p.id, p.name, p.role, p.capacityDaysPerWeek])).toEqual([
      [SAMPLE_PERSON_IDS.marta, "Marta", "Art director", 2],
      [SAMPLE_PERSON_IDS.sara, "Sara", "Designer", 4],
      [SAMPLE_PERSON_IDS.luca, "Luca", "Developer", 5],
    ]);
    expect(ws.id).toBe("wsp_demoworkspace");
    expect(ws.timezone).toBe("Europe/Rome");
  });
});

describe("the template", () => {
  it("is the v0 website: four seeds in a chain, owned by the sample team", () => {
    const seeds = demoSeeds(seededMinter(1));
    for (const s of seeds) expect(TaskSeedSchema.safeParse(s).success).toBe(true);
    expect(seeds.map((s) => [s.title, s.status, s.priority, s.progress, s.estimateDays])).toEqual(
      DEMO_TASKS.map((t) => [t.title, t.status, t.priority, t.progress, t.estimateDays]),
    );
    expect(seeds.map((s) => s.dependsOn)).toEqual([[], [seeds[0].taskId], [seeds[1].taskId], [seeds[2].taskId]]);
    expect(seeds.map((s) => s.ownerId)).toEqual([SAMPLE_PERSON_IDS.sara, SAMPLE_PERSON_IDS.marta, SAMPLE_PERSON_IDS.marta, SAMPLE_PERSON_IDS.luca]);
  });

  it("drafts a website on the unconfirmed sample start, in euros, born as one view", () => {
    const draft = demoDraft("New website", "board");
    expect(ProjectDraftSchema.safeParse(draft).success).toBe(true);
    expect(draft).toMatchObject({ kind: "website", startDate: SAMPLE_START, startConfirmed: false, currency: "EUR", autoChain: true, requireReview: false, startAs: "board" });
    expect(draft.memberIds).toEqual([SAMPLE_PERSON_IDS.marta, SAMPLE_PERSON_IDS.sara, SAMPLE_PERSON_IDS.luca]);
  });
});

describe("createDemoProject", () => {
  it("creates the project alone when the sample team is there", () => {
    const ops = createDemoProject({ workspace: fresh().workspace, project: null }, req, seededMinter(3));
    expect(ops.map((o) => o.op)).toEqual(["createProject"]);
    const r = apply(fresh(), null, ops);
    const project = r.state.projects[r.projectId!];
    expect(ProjectDocSchema.safeParse(project).success).toBe(true);
    expect(checkProject(project)).toEqual([]);
    expect(project).toMatchObject({ title: "New website", kind: "website", status: "active", startDate: "2026-09-28", startConfirmed: false, views: ["timeline"] });
    expect(sortedByOrder(project.tasks).map((t) => t.title)).toEqual(["Research", "Visual Direction", "UI Design", "Development"]);
    expect(r.local.activeView).toBe("timeline");
    expect(r.caption?.text).toBe("Timeline created · 4 tasks");
  });

  it("replaces the open project, brings back missing and archived sample people, and adds the moodboard", () => {
    const first = apply(fresh(), null, createDemoProject({ workspace: fresh().workspace, project: null }, req, seededMinter(3)));
    const ws = first.state.workspace;
    // Luca has left, and Sara is gone from the workspace altogether
    const people: WorkspaceDoc["people"] = { ...ws.people, [SAMPLE_PERSON_IDS.luca]: { ...ws.people[SAMPLE_PERSON_IDS.luca], archived: true } };
    delete (people as Partial<typeof people>)[SAMPLE_PERSON_IDS.sara];
    const state: DocsState = { ...first.state, workspace: { ...ws, people } };
    const old = first.projectId!;
    const ops = createDemoProject({ workspace: state.workspace, project: state.projects[old] }, { ...req, startAs: "cards", wantsMoodboard: true, replace: true }, seededMinter(4));
    expect(ops.map((o) => o.op)).toEqual(["deleteProject", "addPerson", "restorePerson", "createProject", "addBlock"]);
    const r = apply(state, old, ops);
    expect(r.outcomes.filter((o) => o.result.kind === "rejected")).toEqual([]);
    expect(r.projectId).not.toBe(old);
    expect(r.state.workspace.projects[old].deletedAt).toBe(NOW);
    expect(r.state.projects[r.projectId!].blocks).toEqual(["header", "metrics", "collection", "moodboard"]);
  });

  it("lets an active namesake stand in for a sample person", () => {
    const ws = fresh().workspace;
    const giulia = "per_0000000000giulia" as PersonId;
    const people: WorkspaceDoc["people"] = { ...ws.people, [giulia]: { ...ws.people[SAMPLE_PERSON_IDS.marta], id: giulia, name: "marta" } };
    delete (people as Partial<typeof people>)[SAMPLE_PERSON_IDS.marta];
    const ops = createDemoProject({ workspace: { people }, project: null }, req, seededMinter(5));
    expect(ops.map((o) => o.op)).toEqual(["createProject"]);
    const create = ops[0] as Extract<Op, { op: "createProject" }>;
    expect(create.draft.memberIds[0]).toBe(giulia);
    expect(create.tasks.filter((t) => t.ownerId === giulia).map((t) => t.title)).toEqual(["Visual Direction", "UI Design"]);
  });
});

describe("addSampleTeam", () => {
  /** The demo project with no team: no members and no owners */
  function noTeam(): { state: DocsState; projectId: ProjectDoc["id"] } {
    const r = apply(fresh(), null, createDemoProject({ workspace: fresh().workspace, project: null }, req, seededMinter(3)));
    const p = r.state.projects[r.projectId!];
    const tasks = Object.fromEntries(Object.entries(p.tasks).map(([id, t]) => [id, { ...t, ownerId: null }])) as ProjectDoc["tasks"];
    return { state: { ...r.state, projects: { [p.id]: { ...p, memberIds: [], tasks } } }, projectId: p.id };
  }

  it("makes the sample people members and gives their template tasks back, in workflow order", () => {
    const { state, projectId } = noTeam();
    const ops = addSampleTeam(state.workspace, state.projects[projectId]);
    expect(ops.map((o) => o.op)).toEqual(["addMember", "addMember", "addMember", "assignTask", "assignTask", "assignTask", "assignTask"]);
    const r = apply(state, projectId, ops);
    const p = r.state.projects[projectId];
    expect(p.memberIds).toEqual([SAMPLE_PERSON_IDS.marta, SAMPLE_PERSON_IDS.sara, SAMPLE_PERSON_IDS.luca]);
    expect(sortedByOrder(p.tasks).map((t) => t.ownerId)).toEqual([SAMPLE_PERSON_IDS.sara, SAMPLE_PERSON_IDS.marta, SAMPLE_PERSON_IDS.marta, SAMPLE_PERSON_IDS.luca]);
    // Twice is nothing to do
    expect(addSampleTeam(r.state.workspace, p)).toEqual([]);
  });

  it("adds missing people first, and leaves tasks with an active owner alone", () => {
    const { state, projectId } = noTeam();
    const p = state.projects[projectId];
    const research = sortedByOrder(p.tasks)[0];
    const people = { ...state.workspace.people };
    delete (people as Partial<typeof people>)[SAMPLE_PERSON_IDS.sara];
    const ws = { ...state.workspace, people };
    const owned = { ...p, tasks: { ...p.tasks, [research.id]: { ...research, ownerId: SAMPLE_PERSON_IDS.luca } } };
    const ops = addSampleTeam(ws, owned);
    expect(ops.map((o) => o.op)).toEqual(["addPerson", "addMember", "addMember", "addMember", "assignTask", "assignTask", "assignTask"]);
    const r = apply({ workspace: ws, projects: { [projectId]: owned } }, projectId, ops);
    expect(r.outcomes.filter((o) => o.result.kind === "rejected")).toEqual([]);
    expect(r.state.projects[projectId].tasks[research.id].ownerId).toBe(SAMPLE_PERSON_IDS.luca);
  });

  it("brings the people in without a project", () => {
    const people = { ...fresh().workspace.people };
    delete (people as Partial<typeof people>)[SAMPLE_PERSON_IDS.marta];
    expect(addSampleTeam({ people }, null).map((o) => o.op)).toEqual(["addPerson"]);
  });
});
