// Property generator for removeMoodItem: a reference on the board, or a missing one one time in
// ten (and always on an empty board).
import { sortedByZ } from "@/lib/domain/order";
import { activeProject, type OpGen } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const project = activeProject(state);
  const onBoard = project ? sortedByZ(project.moodboard.items) : [];
  const itemId = onBoard.length > 0 && s.picks[0] % 10 !== 0 ? onBoard[s.picks[0] % onBoard.length].id : mint("moodItem");
  return { op: "removeMoodItem", itemId };
};

export default gen;
