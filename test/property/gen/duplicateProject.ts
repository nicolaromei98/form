// Property generator for duplicateProject: a source from the index (deleted and archived ones
// included) or a missing one, a fresh project id (or a taken one now and then), and a title that
// is sometimes invalid.
//
// `spawning` is the real generator. The default export stays off because an applied
// duplicateProject spawns a project document that reducer.property.test.ts's end-of-run undo
// can't remove (it only replays patches; plan §5.8 drops spawned documents on undo). Step 16
// switches it on once the suite drops spawned projects on undo; until then workspace.test.ts runs
// it under its own spawn-aware property.
import { type OpGen, pick, titleFrom } from "./_pick";

export const spawning: OpGen = (s, state, mint) => {
  const index = Object.keys(state.workspace.projects).sort();
  const sourceId = index.length > 0 && s.picks[0] % 10 !== 0 ? pick(index, s.picks[0]) : mint("project");
  const projectId = index.length > 0 && s.picks[1] % 25 === 0 ? pick(index, s.picks[2]) : mint("project");
  return { op: "duplicateProject", sourceId, projectId, title: titleFrom(s, 80) };
};

// Off until the reducer property drops spawned projects on undo (see above)
const gen: OpGen = () => null;

export default gen;
