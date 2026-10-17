// Property generator for resetBriefLine: one to three keys, usually of existing edits (restored),
// sometimes keys without an edit (skipped, so a payload of only those is a no-op), with repeats.
import { type OpGen, activeProject, pick } from "./_pick";

const gen: OpGen = (s, state) => {
  const keys = Object.keys(activeProject(state)?.brief.edits ?? {}).sort();
  const count = 1 + (s.picks[0] % 3);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const n = s.picks[i + 1];
    out.push(keys.length > 0 && n % 4 !== 0 ? pick(keys, n) : `${s.flags[i] ? "team" : "client"}:head:status`);
  }
  return { op: "resetBriefLine", keys: out };
};

export default gen;
