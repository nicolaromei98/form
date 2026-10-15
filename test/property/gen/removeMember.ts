// Property generator for removeMember: usually a member (their tasks, steps and lead role go with
// them), a quarter of the time someone who holds nothing in the project (a no-op), otherwise any
// person of the workspace or a missing one.
import { activeProject, type OpGen, pick, pickPerson } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const members = activeProject(state)?.memberIds ?? [];
  const variant = s.picks[0] % 4;
  if (variant === 0) return { op: "removeMember", personId: mint("person") };
  const personId = members.length > 0 && variant !== 1 ? pick(members, s.picks[1]) : pickPerson(s, state, mint, 2);
  return { op: "removeMember", personId };
};

export default gen;
