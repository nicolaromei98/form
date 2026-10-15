import { z } from "zod";
import { PersonId } from "@/lib/domain/schema/ids";
import { defineOp, isRejection, reject } from "@/lib/ops/registry/_contract";
import { baseOf, part, title } from "@/lib/ops/registry/_helpers";
import { mustPerson } from "@/lib/ops/registry/_workspace";

/**
 * Deletes a person for good (plan §4.4 row 9, Q8): from Settings only, and only when they own no
 * task or step in any project (`ctx.ownership`), so no project is left naming someone who is gone.
 * Anyone else is refused with `owns_tasks`; archivePerson is the everyday way out of the team.
 */
export default defineOp({
  name: "deletePerson",
  scope: "workspace",
  schema: z.object({ op: z.literal("deletePerson"), personId: PersonId }).strict(),

  reduce(d, op, ctx) {
    const found = mustPerson(baseOf(d), op.personId);
    if (isRejection(found)) return found;
    const owned = ctx.ownership(op.personId);
    if (owned > 0) {
      // Ownership counts tasks and steps alike
      const what = owned === 1 ? "1 task or step: reassign it" : `${owned} tasks or steps: reassign them`;
      return reject("owns_tasks", `${title(found.name)} still owns ${what} first.`, { owned: String(owned) });
    }
    delete d.people[op.personId];
  },

  caption: ({ op, before }) => part(`${title(before.people[op.personId].name)} deleted`),
  // A person is either there to delete or not_found
  noopCaption: () => null,
  undoable: true,
  activity: "show",
  idempotent: false,
  deprecates: [],
  parser: { exempt: "Settings only: deleting a person for good is never a command (Q8)." },
  palette: { exempt: "Settings only: deleting a person for good is never a palette command (Q8)." },
  transport: { exempt: "Settings only: the agent never edits workspace settings." },
  sample: (fx) => ({ op: "deletePerson", personId: fx.person("Luca") }),
});
