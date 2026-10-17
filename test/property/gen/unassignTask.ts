// Property generator for unassignTask: any task, owned (applied) or not (a no-op), or a missing one.
import { type OpGen, pickTask } from "./_pick";

const gen: OpGen = (s, state, mint) => ({ op: "unassignTask", taskId: pickTask(s, state, mint, 0) });

export default gen;
