import { z } from "zod";
import { USER_ID } from "@/lib/domain/limits";
import { compareKeys } from "@/lib/domain/order";
import { PersonId } from "@/lib/domain/schema/ids";
import { defineOp, isRejection, reject } from "@/lib/ops/registry/_contract";
import { baseOf, part, setIfChanged, title } from "@/lib/ops/registry/_helpers";
import { fitsDoc, jsonBytes, mustPerson } from "@/lib/ops/registry/_workspace";

/**
 * "This is me" (plan §4.4 row 10): links a person to the signed-in account. One person per
 * account (W2), so anyone else linked to the same account is unlinked in the same op. Archived
 * people can't be linked.
 */
export default defineOp({
  name: "linkPersonToMe",
  scope: "workspace",
  schema: z.object({ op: z.literal("linkPersonToMe"), personId: PersonId, userId: z.string().min(1).max(USER_ID) }).strict(),

  reduce(d, op) {
    const base = baseOf(d);
    const found = mustPerson(base, op.personId);
    if (isRejection(found)) return found;
    if (found.archived) return reject("archived", `${title(found.name)} has left the team.`);
    const tooLarge = fitsDoc(d, jsonBytes(op.userId), jsonBytes(found.userId));
    if (tooLarge) return tooLarge;
    // Others linked to the account first, in id order, so patches never depend on key order
    for (const id of Object.keys(base.people).sort(compareKeys)) {
      if (id !== op.personId && base.people[id as PersonId].userId === op.userId) d.people[id as PersonId].userId = null;
    }
    setIfChanged(d.people[op.personId], "userId", op.userId);
  },

  caption: ({ op, after }) => part(`This is you: ${title(after.people[op.personId].name)}`),
  noopCaption: ({ op, before }) => `${title(before.people[op.personId].name)} is already you`,
  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: [],
  parser: { exempt: "\"This is me\" needs an account (Phase 2); a command for it arrives with the Phase 5 parser.", until: 5 },
  palette: { exempt: "\"This is me\" needs an account (Phase 2); a palette phrase arrives with the Phase 5 parser.", until: 5 },
  transport: { exempt: "Linking a person to an account needs sign-in (Phase 2) and the agent (Phase 5).", until: 5 },
  sample: (fx) => ({ op: "linkPersonToMe", personId: fx.person("Marta"), userId: "user_marta" }),
});
