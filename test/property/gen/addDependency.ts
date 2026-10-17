// Property generator for addDependency: 30% of the time toward a task that already waits on the
// first one (a forced loop), sometimes the task itself or a missing task, otherwise any pair.
import { activeProject, descendants, type OpGen, pick, pickTask } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const taskId = pickTask(s, state, mint, 0);
  const project = activeProject(state);
  let dependsOnId = pickTask(s, state, mint, 1);
  if (project && Object.hasOwn(project.tasks, taskId)) {
    const below = descendants(project, taskId);
    if (below.length > 0 && s.picks[2] % 10 < 3) dependsOnId = pick(below, s.picks[3]);
    else if (s.picks[2] % 25 === 3) dependsOnId = taskId;
  }
  return { op: "addDependency", taskId, dependsOnId };
};

export default gen;
