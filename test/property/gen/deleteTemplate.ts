// Property generator for deleteTemplate: a user template, or a missing one.
import { type OpGen, pick } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const ids = Object.keys(state.workspace.templates).sort();
  const templateId = ids.length > 0 && s.picks[0] % 10 !== 0 ? pick(ids, s.picks[0]) : mint("template");
  return { op: "deleteTemplate", templateId };
};

export default gen;
