// Property generator for updateMoodItem: a reference on the board, or a missing one one time in
// ten (and always on an empty board). The patch cycles through a drag, a resize, a rotation (all
// often far out of bounds), a note's text or a colour's name (null too, which a note refuses), a
// hex (which only a colour takes), the reference's own values again (a no-op) and nothing at all;
// toFront comes and goes, so a reference already on top stays put.
import { sortedByZ } from "@/lib/domain/order";
import { activeProject, type OpGen, pick } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const project = activeProject(state);
  const onBoard = project ? sortedByZ(project.moodboard.items) : [];
  const item = onBoard.length > 0 && s.picks[0] % 10 !== 0 ? onBoard[s.picks[0] % onBoard.length] : null;
  const [a, b] = s.nums;
  let patch: Record<string, unknown>;
  switch (s.picks[1] % 7) {
    case 0:
      patch = { x: a / 200, y: b / 10 };
      break;
    case 1:
      patch = { w: a / 200, h: b / 50 };
      break;
    case 2:
      patch = { r: a / 10 };
      break;
    case 3:
      patch = { text: s.flags[1] ? null : s.text };
      break;
    case 4:
      patch = { hex: pick(["#0c0c0c", "#ABC", "e4572e"], s.picks[2]) };
      break;
    case 5:
      patch = item ? { x: item.x, y: item.y, w: item.w } : {};
      break;
    default:
      patch = {};
  }
  return { op: "updateMoodItem", itemId: item ? item.id : mint("moodItem"), patch, toFront: s.flags[0] };
};

export default gen;
