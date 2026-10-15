import { z } from "zod";
import { MEMBERS_MAX } from "@/lib/domain/limits";
import { PersonId } from "@/lib/domain/schema/ids";
import { defineOp, isRejection, reject } from "@/lib/ops/registry/_contract";
import { mustActivePerson, part, title } from "@/lib/ops/registry/_helpers";

/**
 * Adds a person to the project's members, its Team rows (plan §4.4 row 22). Like an owner, a new
 * member must be in the workspace (`invalid_reference`) and still in the team (`archived`), read
 * from `ctx.workspace` and never written (Q7). Members the workspace stops knowing later (after
 * deletePerson, which never edits project documents) stay as references and read as missing.
 * Already a member: no-op, whatever the workspace says about them now.
 */
export default defineOp({
  name: "addMember",
  scope: "project",
  schema: z.object({ op: z.literal("addMember"), personId: PersonId }).strict(),

  reduce(d, op, ctx) {
    if (d.memberIds.includes(op.personId)) return;
    const person = mustActivePerson(ctx.workspace, op.personId);
    if (isRejection(person)) return person;
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
  // Giulia is in demoExtras' team but not in its project
  sample: (fx) => ({ op: "addMember", personId: fx.person("Giulia") }),
  sampleOn: "demoExtras",
});
