// Property generator for proposeLeveling: 1–5 start moves on neighbouring tasks (the first one
// missing now and then), with dates around the demo's weeks, sometimes impossible ones, and the
// odd repeated task. Moves on Done tasks are refused.
import type { TaskId } from "@/lib/domain/schema/ids";
import { activeProject, dateFrom, type OpGen, pick, pickTask, tasksOf } from "./_pick";

const SOURCES = ["parser", "agent", "direct"] as const;

const gen: OpGen = (s, state, mint) => {
  const tasks = tasksOf(state);
  const pending = activeProject(state)?.proposal ?? null;
  const first = pickTask(s, state, mint, 0);
  const at = Math.max(
    tasks.findIndex((t) => t.id === first),
    0,
  );
  const ids: TaskId[] = [first];
  for (let i = 1; i < 1 + (s.picks[1] % 5) && tasks.length > 0; i++) ids.push(tasks[(at + i) % tasks.length].id);
  if (s.picks[1] % 25 === 0) ids.push(first);
  return {
    op: "proposeLeveling",
    proposalId: pending !== null && s.picks[2] % 12 === 1 ? pending.id : mint("proposal"),
    moves: ids.map((taskId, i) => ({
      taskId,
      pinnedStart: dateFrom(s.nums[i % 4] + 3 * i, s.flags[3] && s.picks[3] % 9 === 0),
      days: 1 + ((s.picks[4] + i) % 10),
      why: "Their owner is busy until then.",
    })),
    source: pick(SOURCES, s.picks[5]),
  };
};

export default gen;
