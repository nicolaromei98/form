// Property generator for moveTask: every place kind, the place the task already holds (a no-op
// unless the lane changes), repeated moves after the first task (keys grow at one spot), the task
// itself as its anchor, missing tasks and anchors, and board lanes that milestones refuse.
import { STATUS_ORDER } from "@/lib/domain/labels";
import { type OpGen, pick, pickTask, tasksOf } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const tasks = tasksOf(state);
  const taskId = pickTask(s, state, mint, 0);
  const i = tasks.findIndex((t) => t.id === taskId);
  let place: unknown;
  switch (s.picks[1] % 6) {
    case 0:
      place = "start";
      break;
    case 1:
      place = "end";
      break;
    case 2:
      // Where it already is
      place = i > 0 ? { after: tasks[i - 1].id } : "start";
      break;
    case 3:
      // Always after the first task: adversarial key growth, and now and then itself
      place = { after: tasks.length > 0 ? tasks[0].id : mint("task") };
      break;
    default:
      place = { after: pickTask(s, state, mint, 2) };
  }
  const status = s.flags[0] ? pick(STATUS_ORDER, s.picks[3]) : undefined;
  return { op: "moveTask", taskId, place, ...(status ? { status } : {}) };
};

export default gen;
