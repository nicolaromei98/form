// Property generator for deleteProject: usually a project other than the active one, so a run goes
// on with its project ops; the active project one time in four (the demo reset); one already
// deleted now and then (a no-op), or a missing one.
import { type OpGen, pick } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const entries = Object.values(state.workspace.projects).sort((a, b) => (a.id < b.id ? -1 : 1));
  const index = entries.map((e) => e.id);
  const deleted = entries.filter((e) => e.deletedAt !== null).map((e) => e.id);
  const others = index.filter((id) => id !== state.projectId);
  let projectId: string;
  if (deleted.length > 0 && s.picks[3] % 3 === 0) projectId = pick(deleted, s.picks[2]);
  else if (state.projectId !== null && index.includes(state.projectId) && s.picks[1] % 4 === 0) projectId = state.projectId;
  else if (others.length > 0 && s.picks[0] % 10 !== 0) projectId = pick(others, s.picks[2]);
  else projectId = mint("project");
  return { op: "deleteProject", projectId };
};

export default gen;
