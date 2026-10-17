import { z } from "zod";
import { PersonId } from "@/lib/domain/schema/ids";
import { defineOp, isRejection } from "@/lib/ops/registry/_contract";
import { baseOf, part, setIfChanged, title } from "@/lib/ops/registry/_helpers";
import { mustPerson, tasksText } from "@/lib/ops/registry/_workspace";

/**
 * Takes a person off the team (plan §4.4 row 7; v0 removePerson). The person stays in the
 * workspace, so closed work keeps its owner, and nothing in any project is rewritten (Q7: no op
 * touches two documents). Their open tasks read as unassigned at read time, and the caption counts
 * them across projects: "Luca removed · 1 task unassigned".
 */
export default defineOp({
  name: "archivePerson",
  scope: "workspace",
  schema: z.object({ op: z.literal("archivePerson"), personId: PersonId }).strict(),

  reduce(d, op) {
    const found = mustPerson(baseOf(d), op.personId);
    if (isRejection(found)) return found;
    setIfChanged(d.people[op.personId], "archived", true);
  },

  caption({ op, before, env }) {
    const name = title(before.people[op.personId].name);
    const open = env.openTasksOwnedBy(op.personId);
    return part(open > 0 ? `${name} removed · ${tasksText(open)} unassigned` : `${name} removed`);
  },
  noopCaption: ({ op, before }) => `${title(before.people[op.personId].name)} has already left the team`,
  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: ["removePerson"],
  parser: { family: "team", examples: [{ say: "Remove Luca from the team", fixture: "demo" }] },
  palette: { exempt: "The v0 palette has no remove-person phrase; the parser example covers it." },
  transport: { tool: "person_edit", field: "remove" },
  sample: (fx) => ({ op: "archivePerson", personId: fx.person("Luca") }),
});
