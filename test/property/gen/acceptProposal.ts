// Property generator for acceptProposal: the pending proposal, whole or in part (`only` picks
// every other item, now and then with a key that isn't in it, or only such a key: not_found),
// or a stale id 1 time in 10 and whenever nothing is pending (stale_proposal).
import type { Proposal } from "@/lib/domain/schema/proposal";
import { activeProject, type OpGen } from "./_pick";

/** The keys `only` names: proposed step ids, else task ids */
function keysOf(p: Proposal): string[] {
  switch (p.kind) {
    case "subtasks":
      return p.items.map((i) => i.stepId);
    case "reassign":
    case "leveling":
      return p.moves.map((m) => m.taskId);
    case "estimates":
      return p.items.map((i) => i.taskId);
    case "plan":
      return p.tasks.map((t) => t.taskId);
  }
}

const gen: OpGen = (s, state, mint) => {
  const pending = activeProject(state)?.proposal ?? null;
  const proposalId = pending !== null && s.picks[0] % 10 !== 0 ? pending.id : mint("proposal");
  if (pending === null || !s.flags[0]) return { op: "acceptProposal", proposalId };
  const only = keysOf(pending).filter((_, i) => (i + s.picks[1]) % 2 === 0);
  if (only.length === 0 || s.picks[2] % 8 === 0) only.push(s.flags[1] ? mint("task") : mint("step"));
  return { op: "acceptProposal", proposalId, only };
};

export default gen;
