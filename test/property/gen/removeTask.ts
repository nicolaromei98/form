// Property generator for removeTask: an existing task (bridging its dependents, pruning the
// proposal, the focus pin and brief edits), or a missing one.
import { type OpGen, pickTask } from "./_pick";

const gen: OpGen = (s, state, mint) => ({ op: "removeTask", taskId: pickTask(s, state, mint, 0) });

export default gen;
