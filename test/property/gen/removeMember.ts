// Property generator for removeMember: usually a member (their tasks, steps and lead role go with
// them), otherwise any person of the workspace or a missing one (a no-op when they hold nothing).
import { activeProject, type OpGen, pick, pickPerson } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const members = activeProject(state)?.memberIds ?? [];
  const personId = members.length > 0 && s.picks[0] % 3 !== 0 ? pick(members, s.picks[1]) : pickPerson(s, state, mint, 2);
  return { op: "removeMember", personId };
};

export default gen;
