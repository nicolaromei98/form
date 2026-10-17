// Property generator for addStep: fresh ids (and a taken step id now and then for duplicate_id),
// every anchor kind (first, last, after a step of the task, a missing step), milestones that
// refuse steps, a step id given as the task 5% of the time (a nesting attempt), and titles and
// estimates that are sometimes invalid.
import { estimateFrom, type OpGen, pick, pickTask, tasksOf, titleFrom } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const tasks = tasksOf(state);
  const steps = tasks.flatMap((t) => t.steps);
  const nest = steps.length > 0 && s.picks[1] % 20 === 0;
  const taskId = nest ? pick(steps, s.picks[2]).id : pickTask(s, state, mint, 0);
  const task = tasks.find((t) => t.id === taskId);
  const stepId = steps.length > 0 && s.picks[2] % 25 === 0 ? pick(steps, s.picks[3]).id : mint("step");
  let after: unknown;
  switch (s.picks[3] % 4) {
    case 0:
      after = null;
      break;
    case 1:
      after = "end";
      break;
    case 2:
      after = task && task.steps.length > 0 ? pick(task.steps, s.picks[4]).id : "end";
      break;
    default:
      after = mint("step");
  }
  return {
    op: "addStep",
    taskId,
    stepId,
    title: titleFrom(s),
    estimateDays: estimateFrom(s.nums[0], s.flags[3] && s.picks[1] % 4 === 0),
    after,
  };
};

export default gen;
