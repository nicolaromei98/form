// Property generator for addMoodItems: one to four references, or a full batch of 24 so runs
// approach the 200-reference cap, of every kind in turn: images with fresh asset ids, colours in
// every accepted hex form (and now and then a name, refused by the schema), notes with the step's
// text (empty, untrimmed or long). Some are dropped at a place and size far outside the board, so
// the clamps run. Ids are fresh, except one time in twenty-five a reference already on the board
// (duplicate_id) and one time in forty the same id twice in the batch (refused by the schema).
import { sortedByZ } from "@/lib/domain/order";
import { activeProject, type OpGen, pick } from "./_pick";

const KINDS = ["color", "note", "image"] as const;
const HEXES = ["#0C0C0C", "f2efe8", "#c53", "E4572E", "#2a8c86", "#D4A017"];

const gen: OpGen = (s, state, mint) => {
  const project = activeProject(state);
  const onBoard = project ? sortedByZ(project.moodboard.items) : [];
  const count = s.picks[0] % 6 === 0 ? 24 : 1 + (s.picks[0] % 4);
  const items = Array.from({ length: count }, (_, i) => {
    const kind = pick(KINDS, s.picks[2] + i);
    const item: Record<string, unknown> = { itemId: mint("moodItem"), kind };
    if (kind === "image") item.assetId = mint("asset");
    else if (kind === "color") {
      item.hex = s.flags[3] && s.picks[3] % 9 === 0 ? "terracotta" : pick(HEXES, s.picks[3] + i);
      if (s.flags[2]) item.text = "Terracotta";
    } else item.text = s.flags[2] ? s.text : s.text.trim().slice(0, 120);
    // Dropped somewhere, sized by hand: nums run from -10 to 400, so most of these need clamping
    if (s.flags[1] && i === 0) Object.assign(item, { x: s.nums[0] / 100, y: s.nums[1] / 10, w: s.nums[2] / 200, h: s.nums[3] / 50 });
    return item;
  });
  if (onBoard.length > 0 && s.picks[1] % 25 === 0) items[0].itemId = pick(onBoard, s.picks[4]).id;
  else if (count > 1 && s.picks[1] % 40 === 1) items[1].itemId = items[0].itemId;
  return { op: "addMoodItems", items };
};

export default gen;
