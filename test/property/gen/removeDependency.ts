// Property generator for removeDependency: usually an edge that exists, otherwise any pair (a
// no-op), the task itself, or a missing task on either side.
import { activeProject, type OpGen, pick, pickTask } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const taskId = pickTask(s, state, mint, 0);
  const project = activeProject(state);
  let dependsOnId = pickTask(s, state, mint, 1);
  if (project && Object.hasOwn(project.tasks, taskId)) {
    const deps = project.tasks[taskId].dependsOn;
    if (deps.length > 0 && s.picks[2] % 3 !== 0) dependsOnId = pick(deps, s.picks[3]);
    else if (s.picks[2] % 25 === 1) dependsOnId = taskId;
  }
  return { op: "removeDependency", taskId, dependsOnId };
};

export default gen;
