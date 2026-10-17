// Property generator for clearMood: naming what v0 lowers to, every reference in stacking order,
// or the same in reverse, every other one, all of them plus a missing one, or only a missing one
// (a no-op, like clearing an empty board); one time in thirty a reference named twice (refused by
// the schema).
import { sortedByZ } from "@/lib/domain/order";
import { activeProject, type OpGen } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const project = activeProject(state);
  const ids: string[] = (project ? sortedByZ(project.moodboard.items) : []).map((it) => it.id);
  let itemIds: string[];
  switch (s.picks[1] % 8) {
    case 4:
      itemIds = [...ids].reverse();
      break;
    case 5:
      itemIds = ids.filter((_, i) => i % 2 === 0);
      break;
    case 6:
      itemIds = [...ids, mint("moodItem")];
      break;
    case 7:
      itemIds = [mint("moodItem")];
      break;
    default:
      itemIds = ids;
  }
  if (itemIds.length > 0 && s.picks[2] % 30 === 0) itemIds = [...itemIds, itemIds[0]];
  return { op: "clearMood", itemIds };
};

export default gen;
