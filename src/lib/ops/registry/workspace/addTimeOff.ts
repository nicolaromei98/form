import { z } from "zod";
import { RANGE_LABEL, TIME_OFF_MAX } from "@/lib/domain/limits";
import { PersonId, TimeOffId } from "@/lib/domain/schema/ids";
import { IsoDate, Line } from "@/lib/domain/schema/primitives";
import type { TimeOff } from "@/lib/domain/schema/workspace";
import { defineOp, isRejection, reject } from "@/lib/ops/registry/_contract";
import { baseOf, ensureFreshId, part, title } from "@/lib/ops/registry/_helpers";
import { backwardsRange, fitsDoc, mustPerson, rangeText, recordBytes } from "@/lib/ops/registry/_workspace";

/**
 * Adds days off for a person (plan §4.4 row 11): their capacity drops on those days in every
 * project. The producer mints the id; a range that ends before it starts is refused, and an
 * archived person takes no time off.
 */
export default defineOp({
  name: "addTimeOff",
  scope: "workspace",
  schema: z
    .object({
      op: z.literal("addTimeOff"),
      personId: PersonId,
      timeOff: z.object({ timeOffId: TimeOffId, from: IsoDate, to: IsoDate, label: Line(RANGE_LABEL).nullable() }).strict(),
    })
    .strict(),

  reduce(d, op) {
    const found = mustPerson(baseOf(d), op.personId);
    if (isRejection(found)) return found;
    if (found.archived) return reject("archived", `${title(found.name)} has left the team.`);
    const { timeOffId, from, to, label } = op.timeOff;
    const fresh = ensureFreshId(d, timeOffId);
    if (fresh) return fresh;
    const backwards = backwardsRange(op.timeOff);
    if (backwards) return backwards;
    if (Object.keys(found.timeOff).length >= TIME_OFF_MAX) {
      return reject("limit", `A person holds at most ${TIME_OFF_MAX} time-off entries.`);
    }
    const entry: TimeOff = { id: timeOffId, from, to, label };
    const tooLarge = fitsDoc(d, recordBytes(timeOffId, entry));
    if (tooLarge) return tooLarge;
    d.people[op.personId].timeOff[timeOffId] = entry;
  },

  caption: ({ op, after }) => part(`${title(after.people[op.personId].name)} is off ${rangeText(op.timeOff.from, op.timeOff.to)}`),
  // A fresh id is either added or refused
  noopCaption: () => null,
  undoable: true,
  activity: "show",
  idempotent: false,
  deprecates: [],
  parser: { exempt: "Time off is entered in Team and Settings; a command for it arrives with the Phase 5 parser.", until: 5 },
  palette: { exempt: "Time off is entered in Team and Settings; a palette phrase arrives with the Phase 5 parser.", until: 5 },
  transport: { tool: "person_edit", field: "timeOff" },
  sample: (fx, mint) => ({
    op: "addTimeOff",
    personId: fx.person("Marta"),
    timeOff: { timeOffId: mint("timeOff"), from: "2026-11-02", to: "2026-11-06", label: null },
  }),
});
