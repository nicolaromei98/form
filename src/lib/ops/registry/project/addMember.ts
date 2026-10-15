import { z } from "zod";
import { resolvePerson } from "@/lib/domain/invariants/check";
import { MEMBERS_MAX } from "@/lib/domain/limits";
import { PersonId } from "@/lib/domain/schema/ids";
import { defineOp, reject } from "@/lib/ops/registry/_contract";
import { part, title } from "@/lib/ops/registry/_helpers";

/**
 * Adds a person to the project's members, its Team rows (plan §4.4 row 22). Members are
 * references the workspace resolves at read time (Q7): a member the workspace no longer knows
 * reads as missing, exactly as after deletePerson, which never edits project documents. So, unlike
 * an owner, a member id the workspace doesn't know is kept as a reference rather than refused;
 * a person who has left the team (archived) is refused, since adding them means nothing.
 * Already a member: no-op.
 */
export default defineOp({
  name: "addMember",
  scope: "project",
  schema: z.object({ op: z.literal("addMember"), personId: PersonId }).strict(),

  reduce(d, op, ctx) {
    if (d.memberIds.includes(op.personId)) return;
    if (resolvePerson(op.personId, ctx.workspace) === "archived") {
      return reject("archived", `${title(ctx.workspace.people[op.personId].name)} has left the team.`);
    }
    if (d.memberIds.length >= MEMBERS_MAX) return reject("limit", `A project has at most ${MEMBERS_MAX} members.`);
    d.memberIds.push(op.personId);
  },

  caption: ({ op, env }) => part(`${title(env.personName(op.personId))} joins the project`, `member:${op.personId}`),
  noopCaption: ({ op, env }) => `${title(env.personName(op.personId))} is already in the project`,
  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: [],
  parser: { exempt: "Members join through the team expansions (sample team, assignments), never parsed alone." },
  palette: { exempt: "Members join through the team expansions; no palette phrase of their own." },
  transport: { tool: "assign" },
  // Every named fixture's people are already members, so the sample names a person the workspace
  // doesn't know: a reference resolved at read time (Q7)
  sample: (_fx, mint) => ({ op: "addMember", personId: mint("person") }),
});
