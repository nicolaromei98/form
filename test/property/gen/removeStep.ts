// Property generator for removeStep: a step of a task that has steps, or a missing step (on a
// real task or a missing one), or a real step named under another task.
import { type OpGen, pick, pickTask, tasksOf } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const withSteps = tasksOf(state).filter((t) => t.steps.length > 0);
  if (withSteps.length === 0 || s.picks[0] % 10 === 0) return { op: "removeStep", taskId: pickTask(s, state, mint, 1), stepId: mint("step") };
  const task = pick(withSteps, s.picks[0]);
  const stepId = pick(task.steps, s.picks[1]).id;
  // Now and then the step under the wrong task
  const taskId = s.picks[2] % 15 === 0 ? pickTask(s, state, mint, 3) : task.id;
  return { op: "removeStep", taskId, stepId };
};

export default gen;
