// Property generator for restorePerson: usually an archived person (whose name may have been taken
// meanwhile), otherwise anyone (an active one is a no-op) or a missing one.
import { type OpGen, pick, pickPerson } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const archived = Object.values(state.workspace.people)
    .filter((p) => p.archived)
    .map((p) => p.id)
    .sort();
  const personId = s.flags[1] && archived.length > 0 ? pick(archived, s.picks[1]) : pickPerson(s, state, mint, 0);
  return { op: "restorePerson", personId };
};

export default gen;
