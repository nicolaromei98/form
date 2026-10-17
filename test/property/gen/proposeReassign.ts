// Property generator for proposeReassign: 1–3 moves on neighbouring tasks (the first one missing
// now and then), each a handover or a start shift. A handover usually names the task's real owner
// as `from` and someone else as `to`; sometimes a wrong `from`, the same person, or a missing
// receiver. Done tasks, repeated tasks and impossible dates are refused too.
import type { PersonId, TaskId } from "@/lib/domain/schema/ids";
import { activeProject, dateFrom, type OpGen, pick, pickPerson, pickTask, tasksOf } from "./_pick";

const SOURCES = ["parser", "agent", "direct"] as const;
const WHY = ["Marta is 4d over capacity. Sara has room for its 6d.", "Shift it by 2 days: it has 5 days of float", ""];

const gen: OpGen = (s, state, mint) => {
  const tasks = tasksOf(state);
  const people = Object.keys(state.workspace.people).sort() as PersonId[];
  const pending = activeProject(state)?.proposal ?? null;
  const first = pickTask(s, state, mint, 0);
  const at = tasks.findIndex((t) => t.id === first);
  const count = 1 + (s.picks[1] % 3);
  // Neighbours in workflow order; a repeated task (1 time in 25) breaks the schema's uniqueness rule
  const ids: TaskId[] = [first];
  for (let i = 1; i < count && tasks.length > 0; i++) ids.push(tasks[(Math.max(at, 0) + i) % tasks.length].id);
  if (s.picks[1] % 25 === 0) ids.push(first);
  const moves = ids.map((taskId, i) => {
    const task = tasks.find((t) => t.id === taskId);
    const why = pick(WHY, s.picks[3] + i);
    if (s.flags[i % 4] && s.picks[4] % 3 === 0) {
      return { type: "shift", taskId, pinnedStart: dateFrom(s.nums[i % 4], s.flags[3] && s.picks[2] % 9 === 0), days: 1 + ((s.picks[4] + i) % 10), why };
    }
    const owner = task?.ownerId ?? null;
    const from = s.picks[2] % 11 === 0 ? pickPerson(s, state, mint, 2) : owner;
    const others = people.filter((p) => p !== owner);
    const to = s.picks[3] % 9 === 0 || others.length === 0 ? pickPerson(s, state, mint, 3) : pick(others, s.picks[3] + i);
    return { type: "owner", taskId, from, to, why };
  });
  return {
    op: "proposeReassign",
    proposalId: pending !== null && s.picks[2] % 12 === 1 ? pending.id : mint("proposal"),
    moves,
    source: pick(SOURCES, s.picks[5]),
  };
};

export default gen;
