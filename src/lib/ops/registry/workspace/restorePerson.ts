import { z } from "zod";
import { compareKeys } from "@/lib/domain/order";
import { PersonId } from "@/lib/domain/schema/ids";
import { defineOp, isRejection, reject } from "@/lib/ops/registry/_contract";
import { baseOf, part, setIfChanged, title } from "@/lib/ops/registry/_helpers";
import { activeNamed, mustPerson } from "@/lib/ops/registry/_workspace";

/**
 * Brings an archived person back into the team (plan §4.4 row 8): Settings "Restore", and the
 * demo's sample-team expansion when a sample person was removed. Their open tasks read as theirs
 * again. Refused while another active person has the same name (W2).
 */
export default defineOp({
  name: "restorePerson",
  scope: "workspace",
  schema: z.object({ op: z.literal("restorePerson"), personId: PersonId }).strict(),

  reduce(d, op) {
    const base = baseOf(d);
    const found = mustPerson(base, op.personId);
    if (isRejection(found)) return found;
    if (!found.archived) return;
    const other = activeNamed(base, found.name, op.personId);
    if (other) return reject("invalid_state", `There's already someone called ${title(other.name)} in the team.`);
    setIfChanged(d.people[op.personId], "archived", false);
  },

  caption: ({ op, after }) => part(`${title(after.people[op.personId].name)} is back in the team`),
  noopCaption: ({ op, before }) => `${title(before.people[op.personId].name)} is already in the team`,
  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: [],
  parser: { exempt: "No phrase of its own: the demo's sample-team expansion restores archived sample people." },
  palette: { exempt: "No phrase of its own: \"Add a sample team\" (addPerson) expands to it for archived sample people." },
  transport: { exempt: "Settings \"Restore\" only: the agent never restores people." },
  // The first archived person; a fresh id when the fixture has none (it then refuses)
  sample: (fx, mint) => ({
    op: "restorePerson",
    personId: Object.values(fx.workspace.people).filter((p) => p.archived).map((p) => p.id).sort(compareKeys)[0] ?? mint("person"),
  }),
  sampleOn: "demoExtras",
});
