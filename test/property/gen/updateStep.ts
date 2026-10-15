// Property generator for updateStep: a step of a task that has steps (or a missing one), cycling
// through the four fields; a third of the time the value it already has (a no-op); owners that may
// be missing, archived or not yet members; titles and estimates that are sometimes invalid.
import { estimateFrom, type OpGen, pick, pickPerson, pickTask, tasksOf, titleFrom } from "./_pick";

const FIELDS = ["done", "title", "ownerId", "estimateDays", "done"] as const;

const gen: OpGen = (s, state, mint) => {
  const withSteps = tasksOf(state).filter((t) => t.steps.length > 0);
  const field = pick(FIELDS, s.picks[2]);
  if (withSteps.length === 0 || s.picks[0] % 10 === 0) {
    return { op: "updateStep", taskId: pickTask(s, state, mint, 1), stepId: mint("step"), field, value: field === "done" ? s.flags[1] : null };
  }
  const task = pick(withSteps, s.picks[0]);
  const step = pick(task.steps, s.picks[1]);
  const same = s.picks[3] % 3 === 0;
  let value: unknown;
  switch (field) {
    case "done":
      value = same ? step.done : s.flags[1];
      break;
    case "title":
      value = same ? step.title : titleFrom(s);
      break;
    case "ownerId":
      value = same ? step.ownerId : s.flags[1] ? null : pickPerson(s, state, mint, 4);
      break;
    case "estimateDays":
      value = same ? step.estimateDays : estimateFrom(s.nums[0], s.flags[3] && s.picks[4] % 4 === 0);
      break;
  }
  return { op: "updateStep", taskId: task.id, stepId: step.id, field, value };
};

export default gen;
