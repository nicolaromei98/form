// Property generator for setView: a random subset of the options, with the columns/layout
// coupling exercised (columns alone, layout alone, both), partial fields and filters with repeats;
// one time in five the options the project already has (a no-op, which a random subset rarely is).
import { PRIORITY_ORDER, SORT_ORDER, STATUS_ORDER } from "@/lib/domain/labels";
import { activeProject, type OpGen, pick, pickPerson } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const project = activeProject(state);
  if (project && s.picks[4] % 5 === 0) {
    const vc = project.viewConfig;
    return { op: "setView", patch: { density: vc.density, sort: vc.sort, hideDone: vc.hideDone, briefShort: vc.brief.short } };
  }
  const patch: Record<string, unknown> = {};
  const has = (bit: number) => (s.picks[0] >> bit) % 2 === 1;
  if (has(0)) patch.density = s.flags[0] ? "compact" : "comfortable";
  if (has(1)) patch.layout = s.flags[1] ? "list" : "grid";
  if (has(2)) patch.columns = s.picks[1] % 6 === 0 ? null : 1 + (s.picks[1] % 4);
  if (has(3)) patch.sort = pick(SORT_ORDER, s.picks[2]);
  if (has(4)) patch.hideDone = s.flags[2];
  if (has(5)) patch.highlightUrgent = s.flags[3];
  if (has(6)) patch.fields = { [pick(["priority", "estimate", "progress", "owner", "due", "cost"], s.picks[3])]: s.flags[0] };
  if (has(7)) {
    const owner = s.flags[1] ? "none" : pickPerson(s, state, mint, 4);
    patch.filters = s.flags[2]
      ? { ownerIds: [owner, owner], statuses: [pick(STATUS_ORDER, s.picks[5])], due: pick(["any", "thisWeek", "late"], s.picks[5]) }
      : { priorities: [pick(PRIORITY_ORDER, s.picks[5])], tags: [] };
  }
  if (has(8)) patch.briefAudience = s.flags[3] ? "team" : "client";
  if (has(9)) patch.briefShort = s.flags[0];
  return { op: "setView", patch };
};

export default gen;
