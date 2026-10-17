// Property generator for restoreProject: usually an archived project when there is one, otherwise
// any project of the index (a live one is a no-op, a deleted one is refused) or a missing one.
import { type OpGen, pick } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const entries = Object.values(state.workspace.projects).sort((a, b) => (a.id < b.id ? -1 : 1));
  const archived = entries.filter((e) => e.archivedAt !== null).map((e) => e.id);
  if (archived.length > 0 && (s.flags[1] || s.picks[2] % 3 !== 0)) return { op: "restoreProject", projectId: pick(archived, s.picks[1]) };
  const projectId = entries.length > 0 && s.picks[0] % 10 !== 0 ? pick(entries, s.picks[1]).id : mint("project");
  return { op: "restoreProject", projectId };
};

export default gen;
