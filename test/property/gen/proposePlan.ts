// Property generator for proposePlan: 1–4 minted seeds that wait on earlier seeds or existing
// tasks, with steps, owners, milestones and coherent status/progress pairs. Now and then a seed
// reuses a task id (duplicate_id), waits on itself (self_dependency), on a later seed or a missing
// task (not_found), has an incoherent pair or a started milestone (invalid_state), a task
// estimate of 0 (invalid_payload) or an owner who isn't in the workspace (invalid_reference).
import { PRIORITY_ORDER } from "@/lib/domain/labels";
import type { TaskId } from "@/lib/domain/schema/ids";
import { activeProject, estimateFrom, type OpGen, pick, pickPerson, pickTask, tasksOf, titleFrom } from "./_pick";

const SOURCES = ["parser", "agent", "direct"] as const;
/** Coherent pairs first; the last one is never coherent */
const STATES = [
  ["todo", 0],
  ["active", 30],
  ["todo", 0],
  ["review", 60],
  ["done", 100],
  ["done", 40],
] as const;

const gen: OpGen = (s, state, mint) => {
  const tasks = tasksOf(state);
  const pending = activeProject(state)?.proposal ?? null;
  const count = 1 + (s.picks[1] % 4);
  const ids: TaskId[] = Array.from({ length: count }, () => mint("task"));
  if (tasks.length > 0 && s.picks[1] % 23 === 0) ids[0] = pick(tasks, s.picks[2]).id;
  const seeds = ids.map((taskId, i) => {
    const salt = s.picks[2] + i;
    const milestone = (s.picks[3] + i) % 6 === 0;
    let dependsOn: TaskId[] = [];
    switch ((s.picks[4] + i) % 5) {
      case 0:
        break;
      case 1:
        if (i > 0) dependsOn = [ids[i - 1]];
        break;
      case 2:
        // An existing task (a missing one 1 time in 10)
        dependsOn = [pickTask(s, state, mint, 0)];
        break;
      case 3:
        dependsOn = i > 0 ? [ids[0], pickTask(s, state, mint, 3)] : [];
        break;
      default:
        // A later seed, or itself: both refused
        if (salt % 7 === 0) dependsOn = [i + 1 < count ? ids[i + 1] : taskId];
    }
    const [status, progress] = s.picks[0] % 17 === 0 ? pick(STATES, salt) : pick(STATES.slice(0, 5), salt);
    return {
      taskId,
      title: i === 0 ? titleFrom(s) : `Proposed ${i + 1}`,
      kind: milestone ? "milestone" : "task",
      estimateDays: s.picks[3] % 31 === 0 ? 0 : estimateFrom(s.nums[i % 4], false),
      dependsOn,
      // A started milestone is refused, so milestones mostly stay to do or done
      status: milestone && salt % 5 !== 0 ? (status === "done" ? "done" : "todo") : status,
      priority: pick(PRIORITY_ORDER, salt),
      progress: milestone && salt % 5 !== 0 ? (status === "done" ? 100 : 0) : progress,
      ownerId: s.flags[(i + 1) % 4] ? pickPerson(s, state, mint, 5) : null,
      emphasis: s.flags[i % 4],
      steps: s.flags[2] && !milestone ? [{ stepId: mint("step"), title: "First pass", estimateDays: null }] : [],
    };
  });
  return {
    op: "proposePlan",
    proposalId: pending !== null && s.picks[2] % 12 === 1 ? pending.id : mint("proposal"),
    tasks: seeds,
    source: pick(SOURCES, s.picks[5]),
  };
};

export default gen;
