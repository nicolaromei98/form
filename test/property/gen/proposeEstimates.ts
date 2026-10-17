// Property generator for proposeEstimates: 1–5 suggestions on neighbouring tasks (the first one
// missing now and then; milestones are refused), in half days, sometimes a raw invalid number
// (2.7, 0, past 250), and the odd repeated task.
import type { TaskId } from "@/lib/domain/schema/ids";
import { activeProject, estimateFrom, type OpGen, pick, pickTask, tasksOf } from "./_pick";

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
  const raw = s.flags[3] && s.picks[3] % 6 === 0;
  return {
    op: "proposeEstimates",
    proposalId: pending !== null && s.picks[2] % 12 === 1 ? pending.id : mint("proposal"),
    items: ids.map((taskId, i) => ({ taskId, estimateDays: estimateFrom(s.nums[i % 4], raw) ?? 0.5 + i })),
    source: pick(SOURCES, s.picks[5]),
  };
};

export default gen;
