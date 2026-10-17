// Property generator for addTimeOff: a person (archived ones are refused) or a missing one, a fresh
// entry id (one of theirs now and then), and ranges that sometimes run backwards.
import type { PersonId, TimeOffId } from "@/lib/domain/schema/ids";
import { dateFrom, type OpGen, pick, pickPerson } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const personId: PersonId = pickPerson(s, state, mint, 0);
  const taken = Object.hasOwn(state.workspace.people, personId) ? (Object.keys(state.workspace.people[personId].timeOff).sort() as TimeOffId[]) : [];
  const timeOffId = s.picks[1] % 25 === 0 && taken.length > 0 ? pick(taken, s.picks[2]) : mint("timeOff");
  const start = Math.floor(Math.abs(s.nums[0])) % 120;
  const span = Math.floor(Math.abs(s.nums[1])) % 10;
  const backwards = s.picks[3] % 8 === 0;
  return {
    op: "addTimeOff",
    personId,
    timeOff: {
      timeOffId,
      from: dateFrom(start, s.flags[3] && s.picks[2] % 6 === 0),
      to: dateFrom(backwards ? Math.max(0, start - 1 - span) : start + span, false),
      label: s.flags[1] ? "Holiday" : null,
    },
  };
};

export default gen;
