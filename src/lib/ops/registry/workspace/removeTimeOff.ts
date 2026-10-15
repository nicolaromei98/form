import { z } from "zod";
import { compareKeys } from "@/lib/domain/order";
import { PersonId, TimeOffId } from "@/lib/domain/schema/ids";
import { defineOp, isRejection, reject } from "@/lib/ops/registry/_contract";
import { baseOf, part } from "@/lib/ops/registry/_helpers";
import { mustPerson } from "@/lib/ops/registry/_workspace";

/** Removes one of a person's time-off entries (plan §4.4 row 12): those days count as working again. */
export default defineOp({
  name: "removeTimeOff",
  scope: "workspace",
  schema: z.object({ op: z.literal("removeTimeOff"), personId: PersonId, timeOffId: TimeOffId }).strict(),

  reduce(d, op) {
    const found = mustPerson(baseOf(d), op.personId);
    if (isRejection(found)) return found;
    if (!Object.hasOwn(found.timeOff, op.timeOffId)) return reject("not_found", "That time off isn't on the calendar anymore.");
    delete d.people[op.personId].timeOff[op.timeOffId];
  },

  caption: () => part("Time off removed"),
  // An entry is either there to remove or not_found
  noopCaption: () => null,
  undoable: true,
  activity: "show",
  idempotent: false,
  deprecates: [],
  parser: { exempt: "Time off is removed in Team and Settings; a command for it arrives with the Phase 5 parser.", until: 5 },
  palette: { exempt: "Time off is removed in Team and Settings; a palette phrase arrives with the Phase 5 parser.", until: 5 },
  transport: { tool: "person_edit", field: "timeOff" },
  // The first time-off entry of the first person who has one; fresh ids when the fixture has none
  sample(fx, mint) {
    for (const id of Object.keys(fx.workspace.people).sort(compareKeys)) {
      const off = Object.keys(fx.workspace.people[id as PersonId].timeOff).sort(compareKeys)[0];
      if (off) return { op: "removeTimeOff", personId: id, timeOffId: off };
    }
    return { op: "removeTimeOff", personId: mint("person"), timeOffId: mint("timeOff") };
  },
  // Complete, but no named fixture holds time off yet, so the completeness test can't apply the
  // sample. The mark keeps the op out of the full-op checks until test/fixtures/v2/named.ts gains
  // an entry (reported by step 10d); then delete this line.
  stub: { family: "10d", until: 1 },
});
