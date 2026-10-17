// Property generator for removeLink: a link that exists, named on its own holder (applied) or now
// and then on the wrong one, or a missing link on any target.
import { activeProject, type OpGen, pick, pickTask, tasksOf } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const project = activeProject(state);
  const held = [
    ...(project?.links ?? []).map((l) => ({ target: { kind: "project" }, id: l.id })),
    ...tasksOf(state).flatMap((t) => t.links.map((l) => ({ target: { kind: "task", taskId: t.id }, id: l.id }))),
  ];
  if (held.length === 0 || s.picks[0] % 10 === 0) {
    const target = s.flags[0] ? { kind: "project" } : { kind: "task", taskId: pickTask(s, state, mint, 1) };
    return { op: "removeLink", target, linkId: mint("link") };
  }
  const link = pick(held, s.picks[1]);
  const target = s.picks[2] % 12 === 0 ? { kind: "task", taskId: pickTask(s, state, mint, 3) } : link.target;
  return { op: "removeLink", target, linkId: link.id };
};

export default gen;
