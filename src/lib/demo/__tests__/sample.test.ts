// The /demo sample data (plan §8.3): fixed readable ids, weekly capacities 2/4/5, the sample start,
// and the same people, owners and start as the v2 demo fixture the planning tests run on.
import { describe, expect, it } from "vitest";
import { PersonId } from "@/lib/domain/schema";
import { isSamplePerson, SAMPLE_OWNER_BY_TITLE, SAMPLE_PEOPLE, SAMPLE_PERSON_IDS, SAMPLE_START, sampleForMigration } from "@/lib/demo/sample";
import { V0_SAMPLE_TEAM } from "@/lib/migrate/v0/schema";
import { activeProject, DEMO_PEOPLE, demoState, SAMPLE_START as FIXTURE_START } from "../../../../test/fixtures/v2/build";

describe("the sample team", () => {
  it("has the plan's fixed ids, roles and weekly capacities", () => {
    expect(SAMPLE_PEOPLE.map((p) => [p.id, p.v0Id, p.name, p.role, p.capacityDaysPerWeek])).toEqual([
      ["per_demomarta", "p-marta", "Marta", "Art director", 2],
      ["per_demosara", "p-sara", "Sara", "Designer", 4],
      ["per_demoluca", "p-luca", "Luca", "Developer", 5],
    ]);
    for (const p of SAMPLE_PEOPLE) expect(PersonId.safeParse(p.id).success).toBe(true);
    expect(SAMPLE_PERSON_IDS).toEqual(DEMO_PEOPLE);
    expect(Object.isFrozen(SAMPLE_PEOPLE) && SAMPLE_PEOPLE.every(Object.isFrozen)).toBe(true);
  });

  it("knows its own people only", () => {
    expect(SAMPLE_PEOPLE.every((p) => isSamplePerson(p.id))).toBe(true);
    for (const id of ["per_demogiulia", "p-marta", "", null, undefined]) expect(isSamplePerson(id)).toBe(false);
  });

  it("matches the v0 template's team, by id and name, for the migration", () => {
    expect(Object.fromEntries(SAMPLE_PEOPLE.map((p) => [p.v0Id, p.name]))).toEqual(V0_SAMPLE_TEAM);
    expect(sampleForMigration()).toEqual({
      ids: { "p-marta": "per_demomarta", "p-sara": "per_demosara", "p-luca": "per_demoluca" },
      capacities: { "p-marta": 2, "p-sara": 4, "p-luca": 5 },
    });
  });

  it("staffs and starts the template as the v2 demo fixture does", () => {
    expect(SAMPLE_START).toBe("2026-09-28");
    expect(SAMPLE_START).toBe(FIXTURE_START);
    const project = activeProject(demoState());
    expect(Object.fromEntries(Object.values(project.tasks).map((t) => [t.title, t.ownerId]))).toEqual(SAMPLE_OWNER_BY_TITLE);
  });
});
