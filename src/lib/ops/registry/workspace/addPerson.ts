import { z } from "zod";
import { CAPACITY_MAX_DAYS, EMAIL_LENGTH, PEOPLE_MAX, PERSON_NAME, PERSON_ROLE } from "@/lib/domain/limits";
import { PersonId } from "@/lib/domain/schema/ids";
import { Cents, halfDays, Line } from "@/lib/domain/schema/primitives";
import type { Person } from "@/lib/domain/schema/workspace";
import { defineOp, reject } from "@/lib/ops/registry/_contract";
import { baseOf, captionKey, ensureFreshId, groupPart, title } from "@/lib/ops/registry/_helpers";
import { activeNamed, capacityText, fitsDoc, nextPersonOrder, recordBytes } from "@/lib/ops/registry/_workspace";

/**
 * Adds a person to the workspace (plan §4.4 row 5; v0 addPerson), below every Team row. Q3: the
 * capacity is nullable. The Team "Add person" button sends a visible 5; a command that names no
 * capacity sends null, and the caption says so, so FORM can ask for it. A name an active person
 * already has (trimmed, case-insensitive, the W2 rule) is a no-op: "Giulia is already in the team".
 * People added with the same capacity in one command are said once ("Giulia and Paolo added to
 * the team · capacity not set"), and their joining the project in that command goes without
 * saying (caption policy rules 1 and 2).
 */
export default defineOp({
  name: "addPerson",
  scope: "workspace",
  schema: z
    .object({
      op: z.literal("addPerson"),
      personId: PersonId,
      name: Line(PERSON_NAME),
      role: Line(PERSON_ROLE).nullable(),
      email: z.email().max(EMAIL_LENGTH).nullable(),
      capacityDaysPerWeek: halfDays(0, CAPACITY_MAX_DAYS).nullable(),
      dayRateCents: Cents.nullable(),
    })
    .strict(),

  reduce(d, op, ctx) {
    // Already in the team: nothing to add, whatever id the producer minted
    if (activeNamed(baseOf(d), op.name)) return;
    const fresh = ensureFreshId(d, op.personId);
    if (fresh) return fresh;
    if (Object.keys(d.people).length >= PEOPLE_MAX) return reject("limit", `A workspace holds at most ${PEOPLE_MAX} people.`);
    const person: Person = {
      id: op.personId,
      name: op.name,
      role: op.role,
      email: op.email,
      userId: null,
      capacityDaysPerWeek: op.capacityDaysPerWeek,
      dayRateCents: op.dayRateCents,
      timeOff: {},
      order: nextPersonOrder(d),
      archived: false,
      createdAt: ctx.now,
    };
    const tooLarge = fitsDoc(d, recordBytes(op.personId, person));
    if (tooLarge) return tooLarge;
    d.people[op.personId] = person;
  },

  caption({ op }) {
    const capacity = op.capacityDaysPerWeek === null ? "capacity not set" : capacityText(op.capacityDaysPerWeek);
    return groupPart(`{names} added to the team · ${capacity}`, title(op.name), { implies: [captionKey.member(op.personId)] });
  },
  noopCaption: ({ op, before }) => `${title(activeNamed(before, op.name)?.name ?? op.name)} is already in the team`,
  undoable: true,
  activity: "show",
  // The second time, the name is already in the team
  idempotent: true,
  deprecates: ["addPerson"],
  parser: { family: "team", examples: [{ say: "Add Giulia to the team as a designer", fixture: "demo" }] },
  palette: [
    { group: "Team", phrase: "Add Giulia and Paolo to the team", rank: 50, needs: "project", fixture: "demo", surfaces: ["demo", "app"] },
    // Sample people exist only in /demo (FORM-v1 §0 rule 7)
    { group: "Team", phrase: "Add a sample team", rank: 70, needs: "project", fixture: "demoNoTeam", surfaces: ["demo"] },
  ],
  transport: { tool: "person_edit" },
  sample: (_fx, mint) => ({
    op: "addPerson",
    personId: mint("person"),
    name: "Giulia",
    role: "Designer",
    email: null,
    capacityDaysPerWeek: null,
    dayRateCents: null,
  }),
});
