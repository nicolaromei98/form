// Property generator for addClosure: fresh ids (a taken one now and then), ranges of 0–19 days
// around the demo's weeks that sometimes run backwards, and labels that are sometimes invalid.
import { dateFrom, type OpGen, pick, titleFrom } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const taken = Object.keys(state.workspace.closures).sort();
  const closureId = s.picks[0] % 25 === 0 && taken.length > 0 ? pick(taken, s.picks[1]) : mint("closure");
  const start = Math.floor(Math.abs(s.nums[0])) % 120;
  const span = Math.floor(Math.abs(s.nums[1])) % 20;
  const from = dateFrom(start, s.flags[3] && s.picks[2] % 6 === 0);
  // One range in eight ends before it starts
  const to = dateFrom(s.picks[3] % 8 === 0 ? Math.max(0, start - 1 - span) : start + span, false);
  return { op: "addClosure", closure: { closureId, from, to, label: titleFrom(s, 60) } };
};

export default gen;
