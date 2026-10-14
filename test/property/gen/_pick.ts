// Shared vocabulary of the property generators (plan §10.3). A generator turns a step *intent*
// (plain numbers, a text, flags) into a raw op against the current state, so fast-check shrinks
// numbers while the payload stays meaningful. `test/property/gen/<op>.ts` default-exports one
// `OpGen`; returning null skips the step (a stub, or nothing sensible to generate).
import type { Minter } from "@/lib/domain/ids";
import { successorMap } from "@/lib/domain/invariants/graph";
import { sortedByOrder } from "@/lib/domain/order";
import type { PersonId, ProjectId, TaskId } from "@/lib/domain/schema/ids";
import type { ProjectDoc, Task } from "@/lib/domain/schema/project";
import type { WorkspaceDoc } from "@/lib/domain/schema/workspace";
import type { OpName } from "@/lib/ops/registry";

/** One generated step: the op to try and the raw material its generator draws from */
export interface StepIntent {
  op: OpName;
  /** Six naturals: which entity, which field, which variant… `picks[i] % 10 === 0` names a missing id */
  picks: readonly number[];
  /** Titles and texts, sometimes empty, untrimmed or one past a limit */
  text: string;
  /** Four doubles in [-10, 400]: estimates, progress, money, dates */
  nums: readonly number[];
  flags: readonly boolean[];
}

/** The state a generator reads: the store's DocsState plus the active project */
export interface GenState {
  readonly workspace: WorkspaceDoc;
  readonly projects: Readonly<Record<ProjectId, ProjectDoc>>;
  readonly projectId: ProjectId | null;
}

export type OpGen = (step: StepIntent, state: GenState, mint: Minter) => unknown;

export function activeProject(state: GenState): ProjectDoc | null {
  return state.projectId !== null && Object.hasOwn(state.projects, state.projectId) ? state.projects[state.projectId] : null;
}

/** The active project's tasks in workflow order (empty without a project) */
export function tasksOf(state: GenState): Task[] {
  const p = activeProject(state);
  return p ? sortedByOrder(p.tasks) : [];
}

export function pick<T>(list: readonly T[], n: number): T {
  return list[Math.abs(n) % list.length];
}

/** An existing task, or a fresh (missing) id one time in ten and whenever there are no tasks */
export function pickTask(step: StepIntent, state: GenState, mint: Minter, i: number): TaskId {
  const tasks = tasksOf(state);
  const n = step.picks[i] ?? 0;
  if (tasks.length === 0 || n % 10 === 0) return mint("task");
  return tasks[n % tasks.length].id;
}

/** A person of the workspace (archived ones included), or a fresh (missing) id one time in ten */
export function pickPerson(step: StepIntent, state: GenState, mint: Minter, i: number): PersonId {
  const people = Object.keys(state.workspace.people).sort() as PersonId[];
  const n = step.picks[i] ?? 0;
  if (people.length === 0 || n % 10 === 0) return mint("person");
  return people[n % people.length];
}

/** Tasks that wait on `id`, directly or not: depending on one of them closes a loop */
export function descendants(project: ProjectDoc, id: TaskId): TaskId[] {
  const succ = successorMap(project);
  const seen = new Set<TaskId>();
  const queue = [...(succ.get(id) ?? [])];
  while (queue.length) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    queue.push(...(succ.get(next) ?? []));
  }
  return [...seen];
}

/** A title: usually a valid trimmed line, sometimes the raw text (empty, untrimmed, too long) */
export function titleFrom(step: StepIntent, max = 140): string {
  if (step.flags[0] && step.picks[4] % 3 === 0) return step.text;
  const clean = step.text.replace(/[\r\n]+/g, " ").trim().slice(0, max).trim();
  return clean.length > 0 ? clean : `Task ${step.picks[0] % 1000}`;
}

/** An estimate: null for negatives, half days in range, and sometimes a raw invalid number (2.7, 0, > 250) */
export function estimateFrom(n: number, raw: boolean): number | null {
  if (raw) return n;
  if (n < 0) return null;
  return Math.min(250, Math.max(0.5, Math.round(n * 2) / 2));
}

/** A date around the demo's weeks, sometimes impossible ("2026-02-30") */
export function dateFrom(n: number, raw: boolean): string {
  if (raw) return "2026-02-30";
  const day = Math.floor(Math.abs(n)) % 120;
  const d = new Date(Date.UTC(2026, 8, 28 + day));
  return d.toISOString().slice(0, 10);
}
