// Property generator for setWorkspaceCalendar: the current days reversed (a no-op), or 0–8 days
// with repeats and in any order (normalised on write; no days, 8 days or a day 8 are refused).
import type { OpGen } from "./_pick";

const gen: OpGen = (s, state) => {
  if (s.flags[1]) return { op: "setWorkspaceCalendar", workingDays: [...state.workspace.workingDays].reverse() };
  const n = s.picks[1] % 9;
  const stride = 1 + (s.picks[3] % 3);
  const days = Array.from({ length: n }, (_, i) => 1 + ((s.picks[2] + i * stride) % 7));
  if (s.picks[4] % 15 === 0) days.push(8);
  return { op: "setWorkspaceCalendar", workingDays: days };
};

export default gen;
