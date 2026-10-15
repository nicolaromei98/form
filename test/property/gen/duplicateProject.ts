// Property generator for duplicateProject: a source from the index (deleted and archived ones
// included) or a missing one, a fresh project id (or a taken one now and then), and a title that
// is sometimes invalid.
//
// An applied duplicateProject spawns its copy in the same command (Q9): the property suite
// validates it, checks it for determinism, plans it, and drops it on undo (plan §5.8). `spawning`
// is the same generator under its own name, for workspace.test.ts.
import { type OpGen, pick, titleFrom } from "./_pick";

export const spawning: OpGen = (s, state, mint) => {
  const index = Object.keys(state.workspace.projects).sort();
  const sourceId = index.length > 0 && s.picks[0] % 10 !== 0 ? pick(index, s.picks[0]) : mint("project");
  const projectId = index.length > 0 && s.picks[1] % 25 === 0 ? pick(index, s.picks[2]) : mint("project");
  return { op: "duplicateProject", sourceId, projectId, title: titleFrom(s, 80) };
};

export default spawning;
