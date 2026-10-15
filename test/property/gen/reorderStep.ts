// Property generator for reorderStep: a step of a task that has steps, moved first, after the step
// before it (a no-op), after another step, after itself, or after a missing step; sometimes a
// missing step or task altogether.
import { type OpGen, pick, pickTask, tasksOf } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const withSteps = tasksOf(state).filter((t) => t.steps.length > 0);
  if (withSteps.length === 0 || s.picks[0] % 10 === 0) {
    return { op: "reorderStep", taskId: pickTask(s, state, mint, 1), stepId: mint("step"), after: null };
  }
  const task = pick(withSteps, s.picks[0]);
  const i = s.picks[1] % task.steps.length;
  const stepId = task.steps[i].id;
  let after: unknown;
  switch (s.picks[2] % 5) {
    case 0:
      after = null;
      break;
    case 1:
      after = i > 0 ? task.steps[i - 1].id : null;
      break;
    case 2:
      after = stepId;
      break;
    case 3:
      after = mint("step");
      break;
    default:
      after = pick(task.steps, s.picks[3]).id;
  }
  return { op: "reorderStep", taskId: task.id, stepId, after };
};

export default gen;
