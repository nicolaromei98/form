// Property generator for pinStart: any task (or a missing one) on a day around the demo's weeks,
// sometimes an impossible date, and a third of the time a pinned task on its own day (a no-op).
import { dateFrom, type OpGen, pick, pickTask, tasksOf } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const pinned = tasksOf(state).filter((t) => t.pinnedStart !== null);
  if (pinned.length > 0 && s.picks[1] % 3 === 0) {
    const t = pick(pinned, s.picks[2]);
    return { op: "pinStart", taskId: t.id, date: t.pinnedStart };
  }
  return { op: "pinStart", taskId: pickTask(s, state, mint, 0), date: dateFrom(s.nums[0], s.flags[3] && s.picks[2] % 5 === 0) };
};

export default gen;
