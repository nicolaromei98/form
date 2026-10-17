// Property generator for updatePerson: every field in turn on a person (archived ones included)
// or a missing one. Names are sometimes the person's own (a no-op) or another active person's
// (refused); capacities include null, the current value and the out-of-range 10 and 2.7.
import { type OpGen, pick, pickPerson, titleFrom } from "./_pick";

const FIELDS = ["capacityDaysPerWeek", "name", "role", "email", "dayRateCents"] as const;
const CAPACITIES = [null, 0, 2, 4, 4.5, 5, 7, 10, 2.7];
const EMAILS = [null, "marta@studio.it", "not an email"];

const gen: OpGen = (s, state, mint) => {
  const personId = pickPerson(s, state, mint, 0);
  const field = pick(FIELDS, s.picks[1]);
  const current = Object.hasOwn(state.workspace.people, personId) ? state.workspace.people[personId] : null;
  const same = s.flags[1] && current !== null;
  let value: unknown;
  switch (field) {
    case "capacityDaysPerWeek":
      value = same ? current.capacityDaysPerWeek : pick(CAPACITIES, s.picks[2]);
      break;
    case "name": {
      const others = Object.values(state.workspace.people)
        .filter((p) => !p.archived && p.id !== personId)
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      value = same ? current.name : s.picks[2] % 4 === 0 && others.length > 0 ? pick(others, s.picks[3]).name : titleFrom(s, 40);
      break;
    }
    case "role":
      value = same ? current.role : s.flags[2] ? null : titleFrom(s, 40);
      break;
    case "email":
      value = same ? current.email : pick(EMAILS, s.picks[2]);
      break;
    case "dayRateCents":
      value = same ? current.dayRateCents : s.flags[2] ? null : Math.round(Math.abs(s.nums[2]) * 1000);
      break;
  }
  return { op: "updatePerson", personId, field, value };
};

export default gen;
