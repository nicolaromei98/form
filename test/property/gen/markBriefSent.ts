// Property generator for markBriefSent: a fresh snapshot id for either audience, now and then one
// already recorded (duplicate_id).
import { type OpGen, activeProject, pick } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const sent = activeProject(state)?.brief.sent ?? [];
  const snapshotId = sent.length > 0 && s.picks[0] % 5 === 0 ? pick(sent, s.picks[1]).snapshotId : mint("snapshot");
  return { op: "markBriefSent", audience: s.flags[0] ? "team" : "client", snapshotId };
};

export default gen;
