// Property generator for addBriefLine: a fresh line id (now and then one already taken, for
// duplicate_id), either audience, any section, and the step text as one clean line, or raw
// (sometimes empty, untrimmed or past 600 characters).
import { BriefSection } from "@/lib/domain/schema/primitives";
import { type OpGen, activeProject, pick } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const lines = activeProject(state)?.brief.lines ?? [];
  const lineId = lines.length > 0 && s.picks[0] % 20 === 0 ? pick(lines, s.picks[1]).id : mint("briefLine");
  const clean = s.text.replace(/\s+/g, " ").trim().slice(0, 600).trim();
  const text = s.flags[1] && s.picks[3] % 3 === 0 ? s.text : clean || "Homepage preview on Friday.";
  return { op: "addBriefLine", lineId, audience: s.flags[0] ? "team" : "client", section: pick(BriefSection.options, s.picks[2]), text };
};

export default gen;
