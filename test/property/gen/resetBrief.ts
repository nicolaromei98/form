// Property generator for resetBrief: either audience, so a brief with the user's edits or lines is
// cleared and one without is a no-op.
import type { OpGen } from "./_pick";

const gen: OpGen = (s) => ({ op: "resetBrief", audience: s.flags[0] ? "team" : "client" });

export default gen;
