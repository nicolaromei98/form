import { z } from "zod";
import { PersonId, TaskId } from "@/lib/domain/schema/ids";
import { type CaptionPart, defineOp, isRejection } from "@/lib/ops/registry/_contract";
import { captionKey, formatDays, mustActivePerson, mustTask, part, setIfChanged, title } from "@/lib/ops/registry/_helpers";
import { ensureMember } from "@/lib/ops/registry/_tasks";

/**
 * Gives a task to a person (plan §4.4 row 34, §5.6; v0 assignTask with a person). The person must
 * be in the workspace (`invalid_reference`) and not archived (`archived`), read from
 * `ctx.workspace` and never written (Q7). The owner joins the project's members. When the
 * planning engine is wired into captions, the caption adds the receiver's load as v0 did ("Sara
 * 6/20d", "Sara is now 2d over").
 */
export default defineOp({
  name: "assignTask",
  scope: "project",
  schema: z.object({ op: z.literal("assignTask"), taskId: TaskId, personId: PersonId }).strict(),

  reduce(d, op, ctx) {
    const t = mustTask(d, op.taskId);
    if (isRejection(t)) return t;
    const person = mustActivePerson(ctx.workspace, op.personId);
    if (isRejection(person)) return person;
    const member = ensureMember(d, op.personId);
    if (member) return member;
    setIfChanged(t, "ownerId", op.personId);
  },

  caption({ op, after, env }) {
    const name = env.personName(op.personId);
    const parts: CaptionPart[] = [part(`${title(after.tasks[op.taskId].title)} → ${title(name)}`, captionKey.taskField(op.taskId, "owner"))];
    const lane = env.lanes().find((l) => l.personId === op.personId);
    if (lane) {
      if (lane.over !== null && lane.over > 0) parts.push(part(`${title(name)} is now ${formatDays(lane.over)}d over`));
      else if (lane.capacity === null) parts.push(part(`${title(name)} ${formatDays(lane.days)}d`));
      else parts.push(part(`${title(name)} ${formatDays(lane.days)}/${formatDays(lane.capacity)}d`));
    }
    return parts;
  },
  noopCaption: ({ op, before, env }) => `${title(before.tasks[op.taskId].title)} is already with ${title(env.personName(op.personId))}`,
  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: ["assignTask"],
  parser: {
    family: "team",
    examples: [
      { say: "Give UI Design to Sara", fixture: "demo" },
      { say: "Give it to Luca", fixture: "demoSelected", selected: "UI Design" },
    ],
  },
  palette: [{ group: "Team", phrase: "Assign Development to Sara", rank: 40, needs: "project", fixture: "demo", surfaces: ["demo", "app"] }],
  transport: { tool: "assign" },
  sample: (fx) => ({ op: "assignTask", taskId: fx.task("Development"), personId: fx.person("Sara") }),
});
