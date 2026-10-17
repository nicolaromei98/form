import { z } from "zod";
import { CAPACITY_MAX_DAYS, EMAIL_LENGTH, PERSON_NAME, PERSON_ROLE } from "@/lib/domain/limits";
import { formatMoney } from "@/lib/domain/money";
import { PersonId } from "@/lib/domain/schema/ids";
import { Cents, halfDays, Line } from "@/lib/domain/schema/primitives";
import type { Person, WorkspaceDoc } from "@/lib/domain/schema/workspace";
import { defineOp, isRejection, reject } from "@/lib/ops/registry/_contract";
import { baseOf, part, setIfChanged, title } from "@/lib/ops/registry/_helpers";
import { activeNamed, capacityText, fitsDoc, jsonBytes, mustPerson, wsKey } from "@/lib/ops/registry/_workspace";

/**
 * Changes one field of a person (plan §4.4 row 6; v0 updatePerson, one op per key). An active
 * person's new name can't be another active person's (W2). The capacity is days per week, 0–7 in
 * half days, or null for unknown (Q3); the range is checked in the recipe, so v0's "capacity to
 * 10 days" is refused with the plan §4.5 wording, "Capacity is days per week (0–7)."
 */

const field = <F extends string, V extends z.ZodType>(f: F, value: V) =>
  z.object({ op: z.literal("updatePerson"), personId: PersonId, field: z.literal(f), value }).strict();

const Capacity = halfDays(0, CAPACITY_MAX_DAYS);
const CAPACITY_RANGE = `Capacity is days per week (0–${CAPACITY_MAX_DAYS}).`;

type Field = "name" | "role" | "email" | "capacityDaysPerWeek" | "dayRateCents";

function applied(f: Field, was: Person, p: Person, ws: WorkspaceDoc): string {
  const name = title(p.name);
  switch (f) {
    case "name":
      return `${title(was.name)} renamed to ${name}`;
    case "role":
      return p.role === null ? `${name} · role cleared` : `${name} · ${title(p.role)}`;
    case "email":
      return p.email === null ? `${name} · email cleared` : `${name} · ${p.email}`;
    case "capacityDaysPerWeek":
      return p.capacityDaysPerWeek === null ? `${name} · capacity not set` : `${name} · ${capacityText(p.capacityDaysPerWeek)}`;
    case "dayRateCents":
      return p.dayRateCents === null ? `${name} · day rate cleared` : `${name} · day rate ${formatMoney(p.dayRateCents, ws.defaultCurrency)}`;
  }
}

function already(f: Field, p: Person, ws: WorkspaceDoc): string {
  const name = title(p.name);
  switch (f) {
    case "name":
      return `Already called ${name}`;
    case "role":
      return p.role === null ? `${name} has no role set` : `${name} is already ${title(p.role)}`;
    case "email":
      return p.email === null ? `${name} has no email` : `${name}'s email is already ${p.email}`;
    case "capacityDaysPerWeek":
      return p.capacityDaysPerWeek === null ? `${name}'s capacity isn't set` : `${name} already has ${capacityText(p.capacityDaysPerWeek)}`;
    case "dayRateCents":
      return p.dayRateCents === null ? `${name} has no day rate` : `${name}'s day rate is already ${formatMoney(p.dayRateCents, ws.defaultCurrency)}`;
  }
}

export default defineOp({
  name: "updatePerson",
  scope: "workspace",
  schema: z.discriminatedUnion("field", [
    field("name", Line(PERSON_NAME)),
    field("role", Line(PERSON_ROLE).nullable()),
    field("email", z.email().max(EMAIL_LENGTH).nullable()),
    // Any number reaches the recipe, which refuses out-of-range capacities in words
    field("capacityDaysPerWeek", z.number().nullable()),
    field("dayRateCents", Cents.nullable()),
  ]),

  reduce(d, op) {
    const found = mustPerson(baseOf(d), op.personId);
    if (isRejection(found)) return found;
    const p = d.people[op.personId];
    const tooLarge = fitsDoc(d, jsonBytes(op.value), jsonBytes(found[op.field]));
    if (tooLarge) return tooLarge;
    switch (op.field) {
      case "name": {
        const other = found.archived ? null : activeNamed(baseOf(d), op.value, op.personId);
        if (other) return reject("invalid_state", `There's already someone called ${title(other.name)} in the team.`);
        setIfChanged(p, "name", op.value);
        return;
      }
      case "role":
        setIfChanged(p, "role", op.value);
        return;
      case "email":
        setIfChanged(p, "email", op.value);
        return;
      case "capacityDaysPerWeek":
        if (op.value !== null && !Capacity.safeParse(op.value).success) return reject("invalid_payload", CAPACITY_RANGE);
        setIfChanged(p, "capacityDaysPerWeek", op.value);
        return;
      case "dayRateCents":
        setIfChanged(p, "dayRateCents", op.value);
        return;
    }
  },

  caption: ({ op, before, after }) =>
    part(applied(op.field, before.people[op.personId], after.people[op.personId], after), wsKey.person(op.personId, op.field)),
  noopCaption: ({ op, before }) => already(op.field, before.people[op.personId], before),
  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: ["updatePerson"],
  parser: { family: "team", examples: [{ say: "Sara has 3 days a week", fixture: "demo" }] },
  palette: [
    { group: "Team", phrase: "Set Marta's capacity to 4 days a week", rank: 60, needs: "project", fixture: "demo", surfaces: ["demo", "app"] },
  ],
  transport: { tool: "person_edit" },
  sample: (fx) => ({ op: "updatePerson", personId: fx.person("Marta"), field: "capacityDaysPerWeek", value: 4 }),
});
