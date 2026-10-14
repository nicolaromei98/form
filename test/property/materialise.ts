// Turns step intents into raw ops against the current state (plan §10.3), and builds the frozen
// start states of the runs. About 5% of payloads are corrupted on purpose (an extra key, a wrong
// type, a missing field, 2.7 or 2026-02-30), so the schemas' refusals are exercised too.
import { type Minter, seededMinter } from "@/lib/domain/ids";
import { sortedByOrder } from "@/lib/domain/order";
import type { PersonId, ProjectDoc, Proposal, TaskId } from "@/lib/domain/schema";
import {
  activeProject as activeOf,
  demoState,
  emptyState,
  FIXTURE_NOW,
  type FixtureState,
  generated,
  multiProject,
  SAMPLE_START,
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

const BUILDERS: Record<PropertyFixture, () => FixtureState> = {
  empty: emptyState,
  demo: () => demoState(),
  generated60: () => generated(60),
  multiProject150: () => multiProject(),
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

/** Breaks a valid payload in one of four ways */
function corrupt(raw: Record<string, unknown>, how: number): Record<string, unknown> {
  const keys = Object.keys(raw).filter((k) => k !== "op");
  switch (how % 4) {
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
