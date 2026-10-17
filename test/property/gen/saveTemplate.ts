// Property generator for saveTemplate: the active project's first tasks as a template (or a
// synthetic one), chained by index with repeats, a milestone with an estimate to normalise, and
// now and then a refusal: a taken id, a task that waits on a later one, or a zero estimate.
import { PROJECT_KIND_ORDER } from "@/lib/domain/labels";
import { estimateFrom, type OpGen, pick, tasksOf, titleFrom } from "./_pick";

const gen: OpGen = (s, state, mint) => {
  const taken = Object.keys(state.workspace.templates).sort();
  const templateId = s.picks[0] % 25 === 0 && taken.length > 0 ? pick(taken, s.picks[1]) : mint("template");
  const titles = tasksOf(state).map((t) => t.title);
  const n = 1 + (s.picks[2] % 5);
  const tasks = Array.from({ length: n }, (_, i) => {
    const milestone = i > 0 && i === n - 1 && s.flags[2];
    return {
      title: titles[i] ?? `Phase ${i + 1}`,
      kind: milestone ? "milestone" : "task",
      estimateDays: milestone ? 2 : estimateFrom(s.nums[i % 4], false),
      dependsOn: i > 0 ? [i - 1, ...(s.flags[1] ? [i - 1] : [])] : [],
      steps: s.flags[3] && !milestone ? ["Draft", "Review"] : milestone && s.flags[3] ? ["Party"] : [],
      roleHint: s.flags[1] ? "Designer" : null,
    };
  });
  // One payload in eight is refused by the recipe
  if (s.picks[3] % 8 === 0) tasks[0].dependsOn = [n];
  else if (s.picks[3] % 8 === 1 && tasks[0].kind === "task") tasks[0].estimateDays = 0;
  return { op: "saveTemplate", template: { templateId, name: titleFrom(s, 60), kind: pick(PROJECT_KIND_ORDER, s.picks[4]), tasks } };
};

export default gen;
