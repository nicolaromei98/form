// Property generator for addMember: a quarter of the time a current member (a no-op); half the
// time someone of the workspace outside the project (still in the team when there is one, so they
// join; else archived, refused), or an id the workspace doesn't know (invalid_reference) when
// nobody is outside; otherwise any person of the workspace, archived ones included, or a missing one.
import type { PersonId } from "@/lib/domain/schema/ids";
import { activeProject, type OpGen, pick, pickPerson } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const members = activeProject(state)?.memberIds ?? [];
  const outside = (Object.keys(state.workspace.people).sort() as PersonId[]).filter((id) => !members.includes(id));
  const active = outside.filter((id) => !state.workspace.people[id].archived);
  let personId: PersonId;
  switch (s.picks[0] % 4) {
    case 0:
      personId = members.length > 0 ? pick(members, s.picks[1]) : pickPerson(s, state, mint, 2);
      break;
    case 1:
    case 2:
      personId = active.length > 0 ? pick(active, s.picks[1]) : outside.length > 0 ? pick(outside, s.picks[1]) : mint("person");
      break;
    default:
      personId = pickPerson(s, state, mint, 2);
  }
  return { op: "addMember", personId };
};

export default gen;
