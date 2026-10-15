// Property generator for removeClosure: a closure on the calendar, or a missing one.
import { type OpGen, pick } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const ids = Object.keys(state.workspace.closures).sort();
  const closureId = ids.length > 0 && s.picks[0] % 10 !== 0 ? pick(ids, s.picks[0]) : mint("closure");
  return { op: "removeClosure", closureId };
};

export default gen;
