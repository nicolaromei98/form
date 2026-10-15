// Property generator for updateMoodItem: a reference on the board, or a missing one one time in
// ten (and always on an empty board). The patch cycles through a drag, a resize, a rotation (all
// often far out of bounds), a note's text or a colour's name (now and then null, which a note
// refuses), a hex (which only a colour takes) and three no-ops: the reference's own values again,
// the top reference brought to the front, and nothing at all (or a plain bring to front).
// Mood items appear only once addMoodItems has run, so a draw that finds one favours applied and
// no-op outcomes; empty boards already give plenty of rejections.
import { sortedByZ } from "@/lib/domain/order";
import { activeProject, type OpGen, pick } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const project = activeProject(state);
  const onBoard = project ? sortedByZ(project.moodboard.items) : [];
  const variant = s.picks[1] % 8;
  const missing = onBoard.length === 0 || s.picks[0] % 10 === 0;
  // Variant 6 always names the top reference, so bringing it to the front changes nothing
  const item = missing ? null : variant === 6 ? onBoard[onBoard.length - 1] : onBoard[s.picks[0] % onBoard.length];
  const [a, b] = s.nums;
  let patch: Record<string, unknown> = {};
  let toFront = s.flags[0];
  switch (variant) {
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
      patch = { text: s.flags[1] && s.picks[2] % 3 === 0 ? null : s.text };
      break;
    case 4:
      patch = { hex: pick(["#0c0c0c", "#ABC", "e4572e"], s.picks[2]) };
      break;
    case 5:
      patch = item ? { x: item.x, y: item.y, w: item.w } : {};
      toFront = false;
      break;
    case 6:
      toFront = true;
      break;
  }
  return { op: "updateMoodItem", itemId: item ? item.id : mint("moodItem"), patch, toFront };
};

export default gen;
