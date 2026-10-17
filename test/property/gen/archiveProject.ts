// Property generator for archiveProject: a project of the index (archived ones are a no-op, deleted
// ones are refused) or a missing one.
import { type OpGen, pick } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const index = Object.keys(state.workspace.projects).sort();
  const projectId = index.length > 0 && s.picks[0] % 10 !== 0 ? pick(index, s.picks[1]) : mint("project");
  return { op: "archiveProject", projectId };
};

export default gen;
