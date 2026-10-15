// Property generator for linkPersonToMe: a person (archived ones are refused) or a missing one,
// linked to one of two accounts, so a second link moves the account (unlinking the first person)
// and an empty account is refused; now and then someone already linked, to their own account
// again (a no-op).
import { type OpGen, pick, pickPerson } from "./_pick";

const ACCOUNTS = ["user_1", "user_2", "user_1", ""];

const gen: OpGen = (s, state, mint) => {
  const linked = Object.values(state.workspace.people)
    .filter((p) => p.userId !== null)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  if (linked.length > 0 && s.picks[2] % 4 === 0) {
    const person = pick(linked, s.picks[3]);
    return { op: "linkPersonToMe", personId: person.id, userId: person.userId };
  }
  return { op: "linkPersonToMe", personId: pickPerson(s, state, mint, 0), userId: pick(ACCOUNTS, s.picks[1]) };
};

export default gen;
