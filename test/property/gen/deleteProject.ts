// Property generator for deleteProject: usually a project other than the active one, so a run goes
// on with its project ops; the active project one time in four (the demo reset); a deleted one
// (a no-op) or a missing one otherwise.
import { type OpGen, pick } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const index = Object.keys(state.workspace.projects).sort();
  const others = index.filter((id) => id !== state.projectId);
  let projectId: string;
  if (state.projectId !== null && index.includes(state.projectId) && s.picks[1] % 4 === 0) projectId = state.projectId;
  else if (others.length > 0 && s.picks[0] % 10 !== 0) projectId = pick(others, s.picks[2]);
  else projectId = mint("project");
  return { op: "deleteProject", projectId };
};

export default gen;
