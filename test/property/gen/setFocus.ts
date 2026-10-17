// Property generator for setFocus: a pin on an existing task (sometimes the one already pinned, a
// no-op), on a missing task (not_found), or null to hand the choice back to FORM.
import { activeProject, type OpGen, pickTask } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  if (s.flags[0] && s.picks[1] % 2 === 0) return { op: "setFocus", taskId: null };
  const pinned = activeProject(state)?.viewConfig.focusPin ?? null;
  const taskId = pinned !== null && s.picks[1] % 3 === 0 ? pinned : pickTask(s, state, mint, 0);
  return { op: "setFocus", taskId };
};

export default gen;
