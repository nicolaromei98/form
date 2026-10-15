// Property generator for unpinStart: half the time a pinned task (applied), otherwise any task,
// which is usually unpinned (a no-op), or a missing one.
import { type OpGen, pick, pickTask, tasksOf } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const pinned = tasksOf(state).filter((t) => t.pinnedStart !== null);
  const taskId = pinned.length > 0 && s.picks[1] % 2 === 0 ? pick(pinned, s.picks[2]).id : pickTask(s, state, mint, 0);
  return { op: "unpinStart", taskId };
};

export default gen;
