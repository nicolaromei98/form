import { z } from "zod";
import { sortedByOrder } from "@/lib/domain/order";
import { PersonId } from "@/lib/domain/schema/ids";
import type { ProjectDoc } from "@/lib/domain/schema/project";
import { type CaptionPart, defineOp } from "@/lib/ops/registry/_contract";
import { baseOf, part, title } from "@/lib/ops/registry/_helpers";
import { count } from "@/lib/ops/registry/_tasks";

/**
 * Takes a person out of the project (plan §4.4 row 23). Whoever owns work in a project is part of
 * it (FORM-v1 §3), so their tasks and steps here become unassigned and, if they lead the project,
 * it has no lead; the caption says so, and undo gives everything back. Their tasks in other
 * projects are untouched: no op edits two documents. A person who isn't in the project and owns
 * nothing here is a no-op.
 */

/** The person's tasks and steps in this project */
function owned(doc: ProjectDoc, id: PersonId): { tasks: number; steps: number } {
  let tasks = 0;
  let steps = 0;
  for (const t of Object.values(doc.tasks)) {
    if (t.ownerId === id) tasks++;
    for (const s of t.steps) if (s.ownerId === id) steps++;
  }
  return { tasks, steps };
}

export default defineOp({
  name: "removeMember",
  scope: "project",
  schema: z.object({ op: z.literal("removeMember"), personId: PersonId }).strict(),

  reduce(d, op) {
    const base: ProjectDoc = baseOf(d);
    const i = d.memberIds.indexOf(op.personId);
    if (i >= 0) d.memberIds.splice(i, 1);
    if (d.leadId === op.personId) d.leadId = null;
    // Workflow order, so the patches never depend on how the tasks record was built
    for (const t of sortedByOrder(base.tasks)) {
      if (t.ownerId === op.personId) d.tasks[t.id].ownerId = null;
      t.steps.forEach((s, j) => {
        if (s.ownerId === op.personId) d.tasks[t.id].steps[j].ownerId = null;
      });
    }
  },

  caption({ op, before, env }) {
    const parts: CaptionPart[] = [part(`${title(env.personName(op.personId))} leaves the project`, `member:${op.personId}`)];
    const { tasks, steps } = owned(before, op.personId);
    if (tasks > 0 || steps > 0) {
      const what = [tasks > 0 ? count(tasks, "task") : null, steps > 0 ? count(steps, "step") : null].filter(Boolean).join(" and ");
      parts.push(part(`${what} unassigned`));
    }
    if (before.leadId === op.personId) parts.push(part("No lead now"));
    return parts;
  },
  noopCaption: ({ op, env }) => `${title(env.personName(op.personId))} isn't in the project`,
  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: [],
  parser: { exempt: "Members leave through direct edits until the Phase 5 parser names them.", until: 5 },
  palette: { exempt: "No palette phrase for leaving a project until the Phase 5 parser.", until: 5 },
  transport: { exempt: "Not exposed to the agent until the Phase 5 transport.", until: 5 },
  sample: (fx) => ({ op: "removeMember", personId: fx.person("Luca") }),
});
