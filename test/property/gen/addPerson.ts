// Property generator for addPerson: fresh ids (a taken one now and then), new names, and one time
// in five the name of someone already on the team in another case (a no-op). Capacities run from
// null (Q3) through the half days to the invalid 7.5 and 2.7; emails are sometimes invalid.
import { type OpGen, pick, titleFrom } from "./_pick";

const CAPACITIES = [null, 0, 0.5, 2, 4, 5, 7, 7.5, 2.7];
const EMAILS = [null, "giulia@studio.it", "not an email"];

const gen: OpGen = (s, state, mint) => {
  const people = Object.values(state.workspace.people).sort((a, b) => (a.id < b.id ? -1 : 1));
  const active = people.filter((p) => !p.archived);
  const personId = s.picks[0] % 25 === 0 && people.length > 0 ? pick(people, s.picks[1]).id : mint("person");
  const known = s.picks[2] % 5 === 0 && active.length > 0 ? pick(active, s.picks[3]).name : null;
  const name = known === null ? titleFrom(s, 40) : s.flags[1] ? known.toLowerCase() : known;
  return {
    op: "addPerson",
    personId,
    name,
    role: s.flags[2] ? "Designer" : null,
    email: pick(EMAILS, s.picks[4]),
    capacityDaysPerWeek: pick(CAPACITIES, s.picks[3]),
    dayRateCents: s.flags[3] ? Math.round(Math.abs(s.nums[2]) * 1000) : null,
  };
};

export default gen;
