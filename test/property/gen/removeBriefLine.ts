// Property generator for removeBriefLine: one of the user's lines, or a missing one (not_found).
import { type OpGen, activeProject, pick } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const lines = activeProject(state)?.brief.lines ?? [];
  const lineId = lines.length > 0 && s.picks[0] % 10 !== 0 ? pick(lines, s.picks[0]).id : mint("briefLine");
  return { op: "removeBriefLine", lineId };
};

export default gen;
