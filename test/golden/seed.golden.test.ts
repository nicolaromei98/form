// The demo seed (plan §10.4): createDemoProject gives the project the migration makes of v0's
// websiteTemplate(), in canonical form (ids as titles and names, no timestamps or order keys),
// for each view a project can be born as. Capacities are the sample ones on both sides (2/4/5 days
// a week, plan §8.3). The one stated difference is outside the canonical form: createProject
// records Research's completion at creation, where the migration leaves it unknown.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDemoProject, demoWorkspace } from "@/lib/demo/seed";
import { seededMinter } from "@/lib/domain/ids";
import { defaultLocalViewState } from "@/lib/domain/schema/local";
import { FIXTURE_NOW } from "../fixtures/v2/build";
import { applyOperations } from "../legacy/v0/lib/ops";
import { emptyDoc } from "../legacy/v0/lib/seed";
import { canonical, run, twinOf } from "./parser-harness";

beforeAll(() => {
  // v0's createProject mints its tool id with Math.random
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});
afterAll(() => vi.restoreAllMocks());

/** Both sides of one birth view, built inside the tests (after Math.random is seeded) */
function sides(startAs: "cards" | "board" | "timeline") {
  const legacy = twinOf({ doc: applyOperations(emptyDoc(), [{ op: "createProject", title: "New website", template: "website", representation: startAs }]), selectedId: null });
  const docs = { workspace: demoWorkspace(FIXTURE_NOW, "Europe/Rome"), projects: {} };
  const created = run(
    { docs, projectId: null, local: defaultLocalViewState(null) },
    { ops: createDemoProject({ workspace: docs.workspace, project: null }, { title: "New website", startAs, wantsMoodboard: false, replace: false }, seededMinter(15)), local: [], notes: [], notices: [], source: "direct", text: null },
  );
  return { legacy, created, v2: { docs: created.state, projectId: created.projectId, local: created.local } };
}

describe.each(["cards", "board", "timeline"] as const)("a demo project born as %s", (startAs) => {
  it("equals the migrated v0 template in canonical form", () => {
    const { legacy, v2 } = sides(startAs);
    expect(canonical(v2)).toEqual(canonical(legacy));
  });

  it("differs outside it only where stated: Research's completion is recorded at creation", () => {
    const { legacy, created } = sides(startAs);
    const project = created.state.projects[created.projectId!];
    const twin = legacy.docs.projects[legacy.projectId!];
    const completed = (p: typeof project) => Object.values(p.tasks).map((t) => [t.title, t.completedAt]);
    expect(completed(project)).toContainEqual(["Research", FIXTURE_NOW]);
    expect(completed(twin)).toContainEqual(["Research", null]);
    expect(Object.values(project.tasks).filter((t) => t.title !== "Research").every((t) => t.completedAt === null)).toBe(true);
  });
});
