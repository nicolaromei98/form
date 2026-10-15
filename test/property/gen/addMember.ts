// Property generator for addMember: a third of the time a current member (a no-op), a third a
// non-member (someone of the workspace outside the project, else an id the workspace doesn't
// know: invalid_reference), otherwise any person of the workspace, archived ones included.
import type { PersonId } from "@/lib/domain/schema/ids";
import { activeProject, type OpGen, pick, pickPerson } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const members = activeProject(state)?.memberIds ?? [];
  const outside = (Object.keys(state.workspace.people).sort() as PersonId[]).filter((id) => !members.includes(id));
  let personId: PersonId;
  switch (s.picks[0] % 3) {
    case 0:
      personId = members.length > 0 ? pick(members, s.picks[1]) : pickPerson(s, state, mint, 2);
      break;
    case 1:
      personId = outside.length > 0 && s.flags[0] ? pick(outside, s.picks[1]) : mint("person");
      break;
    default:
      personId = pickPerson(s, state, mint, 2);
  }
  return { op: "addMember", personId };
};

export default gen;
