// Property generator for updateBriefLine: one of the user's lines (or a missing one), with new
// text, the same text (a no-op), or the raw step text (sometimes empty or untrimmed).
import { type OpGen, activeProject, pick } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const lines = activeProject(state)?.brief.lines ?? [];
  if (lines.length === 0 || s.picks[0] % 10 === 0) return { op: "updateBriefLine", lineId: mint("briefLine"), text: "Moved to Monday." };
  const line = pick(lines, s.picks[0]);
  const clean = s.text.replace(/\s+/g, " ").trim().slice(0, 600).trim();
  const how = s.picks[1] % 3;
  const text = how === 0 ? line.text : how === 1 && s.flags[1] ? s.text : clean || "Moved to Monday.";
  return { op: "updateBriefLine", lineId: line.id, text };
};

export default gen;
