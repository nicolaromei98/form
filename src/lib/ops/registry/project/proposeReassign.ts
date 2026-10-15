import { z } from "zod";
import { PROPOSAL_ITEMS_MAX } from "@/lib/domain/limits";
import { ProposalId } from "@/lib/domain/schema/ids";
import { ReassignMoveSchema } from "@/lib/domain/schema/proposal";
import { type CaptionPart, defineOp, isRejection, reject } from "@/lib/ops/registry/_contract";
import { formatDays, mustActivePerson, mustTask, part, title } from "@/lib/ops/registry/_helpers";
import { distinct, freshIds, mustBeOpen, ownerName, plural, ProposalSource } from "@/lib/ops/registry/_proposals";

/**
 * Proposes handovers (owner moves) and start shifts that balance the workload (plan §4.4 row 41,
 * §6.6; v0 proposeReassign). Each move names open work; an owner move names the task's current
 * owner as `from` and an active person other than them as `to`. The pending proposal is
 * replaced, and undo restores it. Nothing moves until the proposal is accepted.
 */

export default defineOp({
  name: "proposeReassign",
  scope: "project",
  schema: z
    .object({
      op: z.literal("proposeReassign"),
      proposalId: ProposalId,
      moves: z
        .array(ReassignMoveSchema)
        .min(1)
        .max(PROPOSAL_ITEMS_MAX)
        .refine((moves) => distinct(moves.map((m) => m.taskId)), "Each task can be moved once"),
      source: ProposalSource,
    })
    .strict(),

  reduce(d, op, ctx) {
    for (const m of op.moves) {
      const task = mustTask(d, m.taskId);
      if (isRejection(task)) return task;
      const closed = mustBeOpen(task);
      if (closed) return closed;
      if (m.type === "owner") {
        if (task.ownerId !== m.from) {
          return reject("invalid_state", `${title(task.title)} is with ${ownerName(ctx.workspace, task.ownerId)} now, not ${ownerName(ctx.workspace, m.from)}.`);
        }
        const to = mustActivePerson(ctx.workspace, m.to);
        if (isRejection(to)) return to;
        if (m.to === task.ownerId) return reject("invalid_state", `${title(task.title)} is already with ${title(to.name)}.`);
      }
    }
    const taken = freshIds(d, [op.proposalId]);
    if (taken) return taken;
    d.proposal = {
      id: op.proposalId,
      createdAt: ctx.now,
      source: op.source,
      kind: "reassign",
      moves: op.moves.map((m) => ({ ...m })),
    };
  },

  // "Marta is 4d over capacity · 1 handover proposed. Review it on the team." Nothing moved yet,
  // so the overload the env reads after the op is the one the proposal answers: the person the
  // moves relieve, else the most overloaded one (v0).
  caption({ op, after, env }) {
    const owners = op.moves.filter((m) => m.type === "owner").length;
    const shifts = op.moves.length - owners;
    const what = [owners > 0 ? plural(owners, "handover") : null, shifts > 0 ? plural(shifts, "shift") : null]
      .filter((w) => w !== null)
      .join(" and ");
    const relieved = new Set(op.moves.map((m) => (m.type === "owner" ? m.from : after.tasks[m.taskId].ownerId)));
    const overloads = env.overloads();
    const worst = overloads.find((o) => relieved.has(o.personId)) ?? overloads[0];
    const lead = worst
      ? `${title(worst.name)} is ${formatDays(worst.over)}d over capacity`
      : op.moves.every((m) => m.type === "owner" && m.from === null)
        ? "Unassigned work gets an owner"
        : null;
    const parts: CaptionPart[] = [];
    if (lead) parts.push(part(lead, undefined, "proposal"));
    parts.push(part(`${what} proposed. Review it on the team.`, undefined, "proposal"));
    return parts;
  },
  // A proposal always carries a fresh id: proposing applies or is refused, never a no-op
  noopCaption: () => null,
  undoable: true,
  activity: "show",
  idempotent: false,
  deprecates: ["proposeReassign"],
  parser: { family: "team", examples: [{ say: "Even out the workload", fixture: "demo" }] },
  palette: [{ group: "Team", phrase: "Balance the workload", rank: 30, needs: "project", fixture: "demo", surfaces: ["demo", "app"] }],
  transport: { tool: "propose", action: "reassign" },
  // The demo's one balance move (plan §6.6): UI Design from Marta to Sara
  sample: (fx, mint) => ({
    op: "proposeReassign",
    proposalId: mint("proposal"),
    moves: [
      {
        type: "owner",
        taskId: fx.task("UI Design"),
        from: fx.person("Marta"),
        to: fx.person("Sara"),
        why: "Marta is 4d over capacity. Sara has room for its 6d.",
      },
    ],
    source: "parser",
  }),
});
