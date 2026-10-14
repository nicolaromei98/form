// Property generator for addTask: fresh ids (and a reused one now and then for duplicate_id),
// every place kind including missing anchors and repeated inserts after the same task, milestones,
// owners who may be missing or archived, and dependencies that may name missing tasks or itself.
import { PRIORITY_ORDER } from "@/lib/domain/labels";
import { estimateFrom, type OpGen, pick, pickPerson, pickTask, tasksOf, titleFrom } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const tasks = tasksOf(state);
  const taskId = s.picks[0] % 25 === 0 && tasks.length > 0 ? pick(tasks, s.picks[1]).id : mint("task");
  const variant = s.picks[2] % 5;
  const place =
    variant === 0
      ? "start"
      : variant === 1
        ? "end"
        : // {after: X}: an existing task, a missing one, or (variant 4) always the first task, so keys grow at one spot
          { after: variant === 4 && tasks.length > 0 ? tasks[0].id : pickTask(s, state, mint, 3) };
  const dependsOn = s.flags[1] ? [pickTask(s, state, mint, 1), ...(s.flags[2] ? [pickTask(s, state, mint, 4)] : [])] : [];
  if (s.picks[3] % 40 === 1) dependsOn.push(taskId);
  return {
    op: "addTask",
    taskId,
    title: titleFrom(s),
    kind: s.picks[4] % 6 === 0 ? "milestone" : "task",
    place,
    dependsOn,
    estimateDays: estimateFrom(s.nums[0], s.flags[3] && s.picks[1] % 4 === 0),
    priority: pick(PRIORITY_ORDER, s.picks[5]),
    ownerId: s.flags[2] ? pickPerson(s, state, mint, 2) : null,
  };
};

export default gen;
