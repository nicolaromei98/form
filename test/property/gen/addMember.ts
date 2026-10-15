// Property generator for addMember: a third of the time a current member (a no-op), otherwise any
// person of the workspace, archived ones included, or one it doesn't know (kept as a reference).
import { activeProject, type OpGen, pick, pickPerson } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const members = activeProject(state)?.memberIds ?? [];
  const personId = members.length > 0 && s.picks[0] % 3 === 0 ? pick(members, s.picks[1]) : pickPerson(s, state, mint, 2);
  return { op: "addMember", personId };
};

export default gen;
