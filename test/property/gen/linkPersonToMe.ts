// Property generator for linkPersonToMe: a person (archived ones are refused) or a missing one,
// linked to one of two accounts, so a second link moves the account (unlinking the first person),
// the same link again is a no-op, and an empty account is refused.
import { type OpGen, pick, pickPerson } from "./_pick";

const ACCOUNTS = ["user_1", "user_2", "user_1", ""];

const gen: OpGen = (s, state, mint) => ({
  op: "linkPersonToMe",
  personId: pickPerson(s, state, mint, 0),
  userId: pick(ACCOUNTS, s.picks[1]),
});

export default gen;
