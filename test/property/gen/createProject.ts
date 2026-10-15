// Property generator for createProject: fresh project ids (a taken one now and then), drafts with
// members, a lead and a calendar override, and 0–5 seeds chained in list order. One payload in
// two provokes a refusal: a seed waiting on itself or on a later seed, a repeated id, a missing or
// archived owner, an incoherent status, a zero estimate, a deadline before the start.
//
// `spawning` is the real generator. The default export stays off because an applied createProject
// spawns a project document that reducer.property.test.ts's end-of-run undo can't remove (it only
// replays patches; plan §5.8 drops spawned documents on undo). Step 16 switches it on once the
// suite drops spawned projects on undo; until then workspace.test.ts runs it under its own
// spawn-aware property.
import { PRIORITY_ORDER, PROJECT_KIND_ORDER, STATUS_ORDER } from "@/lib/domain/labels";
import type { Person } from "@/lib/domain/schema/workspace";
import { estimateFrom, type OpGen, pick, titleFrom } from "./_pick";

const VIEWS = ["cards", "board", "timeline"] as const;

export const spawning: OpGen = (s, state, mint) => {
  const index = Object.keys(state.workspace.projects).sort();
  const projectId = s.picks[0] % 25 === 0 && index.length > 0 ? pick(index, s.picks[1]) : mint("project");
  const people = Object.values(state.workspace.people).sort((a: Person, b: Person) => (a.id < b.id ? -1 : 1));
  const active = people.filter((p) => !p.archived);
  const archived = people.filter((p) => p.archived);
  const n = s.picks[3] % 6;
  const ids = Array.from({ length: n }, () => mint("task"));

  const tasks = ids.map((taskId, i) => {
    const milestone = i === n - 1 && s.flags[2] && i > 0;
    let status = pick(STATUS_ORDER, s.picks[5] + i);
    if (milestone && status !== "done") status = "todo";
    const progress = status === "done" ? 100 : status === "todo" ? 0 : status === "review" ? 60 : 5 * (1 + ((s.picks[4] + i) % 18));
    return {
      taskId,
      title: `Task ${i + 1}`,
      kind: milestone ? "milestone" : "task",
      estimateDays: milestone ? 0 : estimateFrom(s.nums[i % 4], false),
      dependsOn: i > 0 ? [ids[i - 1], ...(i > 1 && s.flags[3] ? [ids[0], ids[0]] : [])] : [],
      status,
      priority: pick(PRIORITY_ORDER, s.picks[4] + i),
      progress,
      ownerId: active.length > 0 && s.flags[1] ? pick(active, s.picks[2] + i).id : null,
      emphasis: false,
      steps: !milestone && i === 0 && s.flags[3] ? [{ stepId: mint("step"), title: "First pass", estimateDays: 1 }] : [],
    };
  });

  const draft: Record<string, unknown> = {
    title: titleFrom(s, 80),
    client: s.flags[0] ? { name: "Ceramica Bassi", contactName: null, contactEmail: null } : null,
    kind: pick(PROJECT_KIND_ORDER, s.picks[2]),
    goal: null,
    startDate: s.flags[2] ? "2026-10-19" : null,
    startConfirmed: s.flags[0],
    deadline: s.flags[2] ? "2026-12-18" : null,
    deadlineKind: s.flags[1] ? "hard" : "soft",
    currency: "EUR",
    budgetCents: s.flags[3] ? 1_200_000 : null,
    leadId: active.length > 0 && s.flags[0] ? pick(active, s.picks[1]).id : null,
    memberIds: active.length > 0 && s.flags[2] ? [pick(active, s.picks[4]).id, pick(active, s.picks[4]).id] : [],
    requireReview: s.picks[1] % 3 === 0,
    autoChain: true,
    calendarOverride: s.picks[4] % 4 === 0 ? { workingDays: [5, 4, 3, 2, 1], closures: null } : null,
    links: [],
    tags: s.flags[1] ? ["web", "web"] : [],
    startAs: pick(VIEWS, s.picks[5]),
  };

  // One payload in two provokes a refusal
  const first = tasks[0];
  switch (s.picks[2] % 14) {
    case 1:
      if (first) first.dependsOn = [first.taskId];
      break;
    case 2:
      if (n > 1) first.dependsOn = [tasks[1].taskId];
      break;
    case 3:
      if (first) tasks.push({ ...first });
      break;
    case 4:
      if (first) first.ownerId = mint("person");
      break;
    case 5:
      if (first && archived.length > 0) first.ownerId = pick(archived, s.picks[3]).id;
      else draft.leadId = mint("person");
      break;
    case 6:
      if (first) Object.assign(first, { kind: "task", status: "todo", progress: 30 });
      break;
    case 7:
      if (first) Object.assign(first, { kind: "task", estimateDays: 0 });
      break;
    case 8:
      Object.assign(draft, { startDate: "2026-12-18", deadline: "2026-10-19" });
      break;
  }
  return { op: "createProject", projectId, draft, tasks };
};

// Off until the reducer property drops spawned projects on undo (see above)
const gen: OpGen = () => null;

export default gen;
