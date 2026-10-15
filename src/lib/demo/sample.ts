import { PersonId } from "@/lib/domain/schema/ids";
import { IsoDate } from "@/lib/domain/schema/primitives";

/**
 * The /demo sample data (plan §8.3; FORM-v1 §0.7 allows sample data only in /demo). The ids are
 * readable and fixed, so a migrated v0 team, a seeded project and "Use a sample team" all name
 * the same people. The weekly capacities keep the v0 story true under weekly load: Marta starts
 * over capacity, and balancing moves UI Design to Sara.
 *
 * Imported only by the store, its actions and the demo seed (lint-enforced).
 */

/** The ids the v0 template gave its sample team */
export type SampleV0Id = "p-marta" | "p-sara" | "p-luca";

export interface SamplePerson {
  readonly id: PersonId;
  /** The same person's id in a v0 document */
  readonly v0Id: SampleV0Id;
  readonly name: string;
  readonly role: string;
  readonly capacityDaysPerWeek: number;
}

const person = (body: string): PersonId => PersonId.parse(`per_${body}`);

export const SAMPLE_PERSON_IDS = {
  marta: person("demomarta"),
  sara: person("demosara"),
  luca: person("demoluca"),
} as const;

/** Marta 2, Sara 4 and Luca 5 days a week, in Team row order */
export const SAMPLE_PEOPLE: readonly SamplePerson[] = Object.freeze([
  Object.freeze({ id: SAMPLE_PERSON_IDS.marta, v0Id: "p-marta", name: "Marta", role: "Art director", capacityDaysPerWeek: 2 }),
  Object.freeze({ id: SAMPLE_PERSON_IDS.sara, v0Id: "p-sara", name: "Sara", role: "Designer", capacityDaysPerWeek: 4 }),
  Object.freeze({ id: SAMPLE_PERSON_IDS.luca, v0Id: "p-luca", name: "Luca", role: "Developer", capacityDaysPerWeek: 5 }),
] as const);

/** The sample schedule's start: Monday 28 September 2026, shown as a sample (never confirmed) */
export const SAMPLE_START: IsoDate = IsoDate.parse("2026-09-28");

/** Who owns each template task in the sample (v0 `SAMPLE_OWNERS`, keyed by title instead of template id) */
export const SAMPLE_OWNER_BY_TITLE: Readonly<Record<string, PersonId>> = Object.freeze({
  Research: SAMPLE_PERSON_IDS.sara,
  "Visual Direction": SAMPLE_PERSON_IDS.marta,
  "UI Design": SAMPLE_PERSON_IDS.marta,
  Development: SAMPLE_PERSON_IDS.luca,
});

const SAMPLE_IDS: ReadonlySet<string> = new Set(SAMPLE_PEOPLE.map((p) => p.id));

/** One of the sample team: the Team view labels them as sample data */
export function isSamplePerson(id: string | null | undefined): id is PersonId {
  return typeof id === "string" && SAMPLE_IDS.has(id);
}

/**
 * The `sample` option of `migrateV0` in demo mode (plan §7.1): the v0 sample ids map to these
 * people with their weekly capacities. Structural, so lib/demo never imports the migration.
 */
export function sampleForMigration(): { ids: Record<SampleV0Id, PersonId>; capacities: Record<SampleV0Id, number> } {
  const ids = {} as Record<SampleV0Id, PersonId>;
  const capacities = {} as Record<SampleV0Id, number>;
  for (const p of SAMPLE_PEOPLE) {
    ids[p.v0Id] = p.id;
    capacities[p.v0Id] = p.capacityDaysPerWeek;
  }
  return { ids, capacities };
}
