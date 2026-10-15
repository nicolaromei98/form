// Property generator for deletePerson: usually someone who owns no task or step in any project
// (deleted), otherwise anyone (owners are refused with owns_tasks) or a missing person.
import type { PersonId } from "@/lib/domain/schema/ids";
import { type OpGen, pick, pickPerson } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const owners = new Set<PersonId>();
  for (const p of Object.values(state.projects)) {
    for (const t of Object.values(p.tasks)) {
      if (t.ownerId !== null) owners.add(t.ownerId);
      for (const step of t.steps) if (step.ownerId !== null) owners.add(step.ownerId);
    }
  }
  const free = (Object.keys(state.workspace.people) as PersonId[]).filter((id) => !owners.has(id)).sort();
  const personId = s.flags[1] && free.length > 0 ? pick(free, s.picks[1]) : pickPerson(s, state, mint, 0);
  return { op: "deletePerson", personId };
};

export default gen;
