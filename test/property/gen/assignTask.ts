// Property generator for assignTask: any person of the workspace (members or not, archived ones
// included) or a missing one, on any task or a missing one; a quarter of the time the task's own
// owner (a no-op).
import { activeProject, type OpGen, pickPerson, pickTask } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const taskId = pickTask(s, state, mint, 0);
  const project = activeProject(state);
  const owner = project && Object.hasOwn(project.tasks, taskId) ? project.tasks[taskId].ownerId : null;
  const personId = owner !== null && s.picks[1] % 4 === 0 ? owner : pickPerson(s, state, mint, 2);
  return { op: "assignTask", taskId, personId };
};

export default gen;
