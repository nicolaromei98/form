// Property generator for updateTemplate: a user template or a missing one, renamed or given a kind,
// with its current value about one time in three (a no-op) and invalid values now and then.
import { PROJECT_KIND_ORDER } from "@/lib/domain/labels";
import type { TemplateId } from "@/lib/domain/schema/ids";
import { type OpGen, pick, titleFrom } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const ids = Object.keys(state.workspace.templates).sort() as TemplateId[];
  const templateId = ids.length > 0 && s.picks[0] % 10 !== 0 ? pick(ids, s.picks[0]) : mint("template");
  const current = Object.hasOwn(state.workspace.templates, templateId) ? state.workspace.templates[templateId] : null;
  const same = current !== null && s.picks[2] % 3 === 0;
  if (s.flags[1]) {
    const kind = same ? current.kind : s.picks[3] % 9 === 0 ? "poster" : pick(PROJECT_KIND_ORDER, s.picks[3]);
    return { op: "updateTemplate", templateId, field: "kind", value: kind };
  }
  return { op: "updateTemplate", templateId, field: "name", value: same ? current.name : titleFrom(s, 60) };
};

export default gen;
