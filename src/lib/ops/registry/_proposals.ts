import { z } from "zod";
import { resolvePerson } from "@/lib/domain/invariants/check";
import type { PersonId } from "@/lib/domain/schema/ids";
import type { ProjectDoc, Task } from "@/lib/domain/schema/project";
import type { WorkspaceDoc } from "@/lib/domain/schema/workspace";
import { type Rejection, reject } from "@/lib/ops/registry/_contract";
import { ensureFreshId, idIndex, title } from "@/lib/ops/registry/_helpers";

/**
 * Shared by the proposal ops of step 10e (plan §4.4 rows 40–46, §5.6) and imported by nothing
 * else: the payload pieces every propose op carries, the checks they share and the wording of
 * their captions. Ops never import each other, so what two of them need lives here.
 */

/**
 * Who made the proposal (plan §3.4): the fast parser, the agent, or a direct action. The
 * producer says so in the payload, so a replay keeps it; `ctx.source` can't tell the parser from
 * the agent.
 */
export const ProposalSource = z.enum(["parser", "agent", "direct"]);

/** Whether a list of ids has no repeats (plan §3.8 P3: the ids inside a proposal are unique) */
export function distinct(ids: readonly string[]): boolean {
  return new Set(ids).size === ids.length;
}

/** "1 step", "4 steps" */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * `duplicate_id` when any id is already used in the base document, the pending proposal and the
 * ids it would create included: producers mint fresh ids, and the reducer never re-mints one.
 */
export function freshIds(d: ProjectDoc, ids: readonly string[]): Rejection | void {
  for (const id of ids) {
    const taken = ensureFreshId(d, id);
    if (taken) return taken;
  }
}

/**
 * `duplicate_id` when an id that accepting would create is already used outside the proposal.
 * Invariant P3 keeps those ids fresh, so this only guards a document that broke it. `ensureFreshId`
 * can't answer here: its index counts the pending proposal's own ids as taken.
 */
export function freshOutsideProposal(base: ProjectDoc, ids: readonly string[]): Rejection | void {
  if (ids.length === 0) return;
  const taken = idIndex({ ...base, proposal: null });
  if (ids.some((id) => taken.has(id))) return reject("duplicate_id", "That id is already taken, so FORM didn't reuse it.");
}

/** A person's name for a message, or "no one" for an empty owner */
export function ownerName(ws: Pick<WorkspaceDoc, "people">, id: PersonId | null): string {
  if (id === null) return "no one";
  return Object.hasOwn(ws.people, id) ? title(ws.people[id].name) : "someone";
}

/** Whether a person can take work: in the workspace and not archived (read at apply time, Q7) */
export function isActivePerson(ws: Pick<WorkspaceDoc, "people">, id: PersonId): boolean {
  return typeof resolvePerson(id, ws) === "object";
}

/** A move or suggestion can only target open work: a Done task has nothing left to move */
export function mustBeOpen(task: Task): Rejection | void {
  if (task.status === "done") return reject("invalid_state", `${title(task.title)} is done, so there's nothing to move.`);
}
