// Turns step intents into raw ops against the current state (plan §10.3), and builds the frozen
// start states of the runs. About 5% of payloads are corrupted on purpose (an extra key, a wrong
// type, a missing field, 2.7 or 2026-02-30, or the name of a v0 op no registry op runs any more),
// so the schemas' and the registry's refusals are exercised too.
import { type Minter, seededMinter } from "@/lib/domain/ids";
import { keyAfter, sortedByOrder } from "@/lib/domain/order";
import {
  ClosureId,
  IsoDate,
  PersonId,
  type ProjectDoc,
  type ProjectId,
  type Proposal,
  type TaskId,
  TemplateId,
  TimeOffId,
} from "@/lib/domain/schema";
import {
  activeProject as activeOf,
  demoExtrasState,
  demoState,
  emptyState,
  EXTRA_USER_ID,
  FIXTURE_NOW,
  type FixtureState,
  generated,
  makePerson,
  multiProject,
  SAMPLE_START,
  websiteTemplate,
} from "../fixtures/v2/build";
import type { PropertyFixture, StartProposal } from "./arbitraries";
import { GENERATORS } from "./gen";
import type { GenState, StepIntent } from "./gen/_pick";

export type { GenState, StepIntent } from "./gen/_pick";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

/**
 * The generated team plus two people who own nothing: Davide, new and on no project yet, and Anna,
 * who left (archived). Generated teams are all members and owners, so without them addMember,
 * deletePerson and restorePerson would only meet a target after another op made one.
 */
function withBench(state: FixtureState): FixtureState {
  const last = sortedByOrder(state.workspace.people).at(-1)!.order;
  const [a, b] = [keyAfter(last), keyAfter(keyAfter(last))];
  // Readable fixed ids: minted ones from another seed could repeat the fixture's own
  const davide = makePerson({ id: PersonId.parse("per_benchdavide"), name: "Davide", role: "Designer", capacityDaysPerWeek: 4, order: a });
  const anna = makePerson({ id: PersonId.parse("per_benchanna"), name: "Anna", role: "Producer", capacityDaysPerWeek: 3, archived: true, order: b });
  return { ...state, workspace: { ...state.workspace, people: { ...state.workspace.people, [davide.id]: davide, [anna.id]: anna } } };
}

/**
 * Three generated projects of 50 tasks on one team (plan §10.3), each with a few brief lines, two
 * brief edits and mood references, one of the inactive two archived; in the workspace a user
 * template, a closure, the first person linked to an account and off for a week, and the bench: a
 * busy studio, so the ops on those meet targets from the first step in more than one fixture.
 */
function busyStudio(): FixtureState {
  const state = withBench(multiProject({ briefLines: 3, moodItems: 6 }));
  const template = websiteTemplate(TemplateId.parse("tpl_busystudio"));
  const closure = { id: ClosureId.parse("cls_busystudio"), from: IsoDate.parse("2026-12-24"), to: IsoDate.parse("2027-01-06"), label: "Christmas break" };
  const off = { id: TimeOffId.parse("off_busystudio"), from: IsoDate.parse("2026-11-02"), to: IsoDate.parse("2026-11-06"), label: null };
  const first = sortedByOrder(state.workspace.people)[0];
  const me = { ...first, userId: EXTRA_USER_ID, timeOff: { [off.id]: off } };
  const edits = {
    "client:head:status": { text: "All good this week.", basis: "On track." },
    "team:next:up": { text: "", basis: "Next up: Task 20." },
  };
  const projects = Object.fromEntries(Object.entries(state.projects).map(([id, p]) => [id, { ...p, brief: { ...p.brief, edits } }]));
  const shelved = Object.keys(state.projects).find((id) => id !== state.projectId) as ProjectId;
  return {
    ...state,
    projects,
    workspace: {
      ...state.workspace,
      templates: { [template.id]: template },
      closures: { [closure.id]: closure },
      people: { ...state.workspace.people, [me.id]: me },
      projects: { ...state.workspace.projects, [shelved]: { ...state.workspace.projects[shelved], archivedAt: FIXTURE_NOW } },
    },
  };
}

/** The start states: plan §10.3's four (generated ones with the bench), and demoExtras */
const BUILDERS: Record<PropertyFixture, () => FixtureState> = {
  empty: emptyState,
  demo: () => demoState(),
  generated60: () => withBench(generated(60)),
  multiProject150: busyStudio,
  demoExtras: () => demoExtrasState(),
};

const CACHE = new Map<string, GenState>();

/** A valid pending proposal of the given kind on the project (fresh ids, existing targets) */
function proposalFor(kind: Exclude<StartProposal, null>, project: ProjectDoc, workspace: GenState["workspace"]): Proposal | null {
  const mint = seededMinter(4242);
  const tasks = sortedByOrder(project.tasks).filter((t) => t.kind === "task");
  if (tasks.length < 2) return null;
  const base = { id: mint("proposal"), createdAt: FIXTURE_NOW, source: "agent" as const };
  const [a, b] = tasks;
  switch (kind) {
    case "subtasks":
      return { ...base, kind, taskId: a.id, items: [{ stepId: mint("step"), title: "First pass", estimateDays: 1 }, { stepId: mint("step"), title: "Review", estimateDays: null }] };
    case "reassign": {
      const people = Object.keys(workspace.people).sort() as PersonId[];
      const to = people.find((p) => p !== a.ownerId);
      return to
        ? { ...base, kind, moves: [{ type: "owner", taskId: a.id, from: a.ownerId, to, why: "Room for it." }, { type: "shift", taskId: b.id, pinnedStart: SAMPLE_START, days: 2, why: "Float." }] }
        : { ...base, kind, moves: [{ type: "shift", taskId: b.id, pinnedStart: SAMPLE_START, days: 2, why: "Float." }] };
    }
    case "leveling":
      return { ...base, kind, moves: tasks.slice(0, 3).map((t) => ({ taskId: t.id, pinnedStart: SAMPLE_START, days: 1, why: "Owner is busy." })) };
    case "estimates":
      return { ...base, kind, items: tasks.slice(0, 3).map((t) => ({ taskId: t.id, estimateDays: 2 })) };
    case "plan": {
      const first = mint("task");
      const seed = (taskId: TaskId, title: string, dependsOn: TaskId[]) => ({
        taskId,
        title,
        kind: "task" as const,
        estimateDays: null,
        dependsOn,
        status: "todo" as const,
        priority: "medium" as const,
        progress: 0,
        ownerId: null,
        emphasis: false,
        steps: [],
      });
      return { ...base, kind, tasks: [seed(first, "Proposed A", [a.id]), seed(mint("task"), "Proposed B", [first, b.id])] };
    }
  }
}

/**
 * A run's start state, deeply frozen (inputs of a reducer are always frozen: property 5) and
 * cached, since nothing can change a frozen document. `requireReview` turns the review step on in
 * the active project (every fixture task stays coherent under it); `proposal` adds a pending one.
 */
export function startState(fixture: PropertyFixture, requireReview: boolean, proposal: StartProposal = null): GenState {
  const key = `${fixture}:${requireReview}:${proposal}`;
  let state = CACHE.get(key);
  if (!state) {
    const built = BUILDERS[fixture]();
    if (built.projectId !== null) {
      const project = activeOf(built);
      const pending = proposal ? proposalFor(proposal, project, built.workspace) : null;
      built.projects = { ...built.projects, [project.id]: { ...project, requireReview: requireReview || project.requireReview, proposal: pending } };
    }
    state = deepFreeze<GenState>({ workspace: built.workspace, projects: built.projects, projectId: built.projectId });
    CACHE.set(key, state);
  }
  return state;
}

/** v0 op names that no registry op takes any more (plan §4.5): a replay of one is `unknown_op` */
const RETIRED_NAMES = ["renameTool", "setRepresentation", "setFields", "setStartDate", "removePerson", "acceptReassign", "addSampleTeam"];

/** Breaks a valid payload in one of five ways */
function corrupt(raw: Record<string, unknown>, how: number): Record<string, unknown> {
  const keys = Object.keys(raw).filter((k) => k !== "op");
  switch (how % 5) {
    case 4:
      return { ...raw, op: RETIRED_NAMES[Math.floor(how / 5) % RETIRED_NAMES.length] };
    case 0:
      return { ...raw, extra: true };
    case 1:
      return keys.length ? { ...raw, [keys[0]]: 42 } : { ...raw, extra: 1 };
    case 2:
      return { op: raw.op };
    default: {
      // A number becomes 2.7 and a string becomes an impossible date
      const key = keys.find((k) => typeof raw[k] === "number" || typeof raw[k] === "string") ?? keys[0];
      if (key === undefined) return { ...raw, extra: "x" };
      return { ...raw, [key]: typeof raw[key] === "number" ? 2.7 : "2026-02-30" };
    }
  }
}

/** The raw op a step stands for in this state, or null to skip the step */
export function materialise(step: StepIntent, state: GenState, mint: Minter): unknown {
  const raw = GENERATORS[step.op](step, state, mint);
  if (raw === null || raw === undefined) return null;
  const n = step.picks[5] ?? 1;
  return n % 20 === 0 ? corrupt(raw as Record<string, unknown>, Math.floor(n / 20)) : raw;
}
