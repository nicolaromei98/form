// Property generator for proposeSubtasks: 1–4 steps (12 now and then) for an existing task, a
// milestone or a missing one. Ids are fresh, except a taken step id or the pending proposal's own
// id now and then (duplicate_id); estimates are known, unknown or sometimes raw (invalid).
import { activeProject, estimateFrom, type OpGen, pick, pickTask, tasksOf, titleFrom } from "./_pick";

const SOURCES = ["parser", "agent", "direct"] as const;

const gen: OpGen = (s, state, mint) => {
  const steps = tasksOf(state).flatMap((t) => t.steps);
  const pending = activeProject(state)?.proposal ?? null;
  const count = s.picks[1] % 9 === 0 ? 12 : 1 + (s.picks[1] % 4);
  const reuseStep = steps.length > 0 && s.picks[2] % 15 === 0;
  const items = Array.from({ length: count }, (_, i) => ({
    stepId: reuseStep && i === 0 ? pick(steps, s.picks[3]).id : mint("step"),
    title: i === 0 ? titleFrom(s) : `Step ${i + 1}`,
    estimateDays: estimateFrom(s.nums[i % 4], s.flags[3] && s.picks[4] % 5 === 0),
  }));
  return {
    op: "proposeSubtasks",
    proposalId: pending !== null && s.picks[2] % 12 === 1 ? pending.id : mint("proposal"),
    taskId: pickTask(s, state, mint, 0),
    items,
    source: pick(SOURCES, s.picks[5]),
  };
};

export default gen;
