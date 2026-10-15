// Property generator for setBriefSharing: the budget shown or hidden, so the current value again
// is a no-op.
import type { OpGen } from "./_pick";

const gen: OpGen = (s) => ({ op: "setBriefSharing", field: "showBudgetToClient", value: s.flags[0] });

export default gen;
