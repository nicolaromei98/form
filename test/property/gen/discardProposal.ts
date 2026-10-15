// Property generator for discardProposal: the pending proposal, or an id that is no longer
// pending (1 time in 5, and whenever nothing is pending), which is a no-op.
import { activeProject, type OpGen } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const pending = activeProject(state)?.proposal ?? null;
  return { op: "discardProposal", proposalId: pending !== null && s.picks[0] % 5 !== 0 ? pending.id : mint("proposal") };
};

export default gen;
