// Property generator for removeTimeOff: an entry of a person who has time off, or a missing entry
// or person.
import type { PersonId } from "@/lib/domain/schema/ids";
import { type OpGen, pick, pickPerson } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const entries = (Object.keys(state.workspace.people) as PersonId[])
    .sort()
    .flatMap((personId) => Object.keys(state.workspace.people[personId].timeOff).sort().map((timeOffId) => ({ personId, timeOffId })));
  if (entries.length > 0 && s.picks[0] % 10 !== 0) return { op: "removeTimeOff", ...pick(entries, s.picks[1]) };
  return { op: "removeTimeOff", personId: pickPerson(s, state, mint, 2), timeOffId: mint("timeOff") };
};

export default gen;
