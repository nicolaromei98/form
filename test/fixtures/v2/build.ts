// Builders of v2 documents for tests, fixtures and perf runs (plan §2, §10.3, §10.7). Every
// builder is deterministic: fixed timestamps, seeded ids and a seeded generator, so two calls with
// the same arguments return deep-equal states. Each call returns fresh, unfrozen objects.
//
// - emptyState / emptyWorkspace: the /demo workspace before any project ("empty")
// - demoState: the v0 website template in v2 (plan §8.3: sample people 2/4/5 days a week)
// - generated(n, …): an n-task project with steps, a DAG of dependencies and people
// - multiProject(…): several generated projects on one workspace and one team
import { addDays } from "@/lib/domain/dates";
import { type Minter, seededMinter } from "@/lib/domain/ids";
import { DEPS_MAX } from "@/lib/domain/limits";
import { frontZs, placeNew, type MoodRect } from "@/lib/domain/mood-geometry";
import { nKeys } from "@/lib/domain/order";
import {
  type BlockKind,
  DEFAULT_BLOCKS,
  defaultViewConfig,
  emptyBriefState,
  IsoDate,
  type MoodItem,
  type MoodKind,
  type Person,
  PersonId,
  type Priority,
  type ProjectDoc,
  type ProjectId,
  type ProjectIndexEntry,
  type Status,
  type Step,
  type Task,
  type TaskId,
  Timestamp,
  type ViewKind,
  type WorkspaceDoc,
  WorkspaceId,
} from "@/lib/domain/schema";

/* ------------------------------------------------------------------
   Constants
   ------------------------------------------------------------------ */

/** The fixtures' clock: every createdAt, and the migration snapshots' `now` (plan §10.6) */
export const FIXTURE_NOW = Timestamp.parse("2026-10-14T09:00:00Z");
/** "Today" in the workspace time zone at FIXTURE_NOW */
export const FIXTURE_TODAY = IsoDate.parse("2026-10-14");
/** When generated Done tasks were completed */
const COMPLETED_AT = Timestamp.parse("2026-10-01T09:00:00Z");
/** The demo's sample start: Monday 28 September 2026 (plan §8.3) */
export const SAMPLE_START = IsoDate.parse("2026-09-28");

/** The readable fixed ids of the demo (plan §3.1) */
export const DEMO_WORKSPACE_ID = WorkspaceId.parse("wsp_demoworkspace");
export const DEMO_PEOPLE = {
  marta: PersonId.parse("per_demomarta"),
  sara: PersonId.parse("per_demosara"),
  luca: PersonId.parse("per_demoluca"),
} as const;

/** A workspace with its projects, and the one the test works on: the shape of the store's DocsState */
export interface FixtureState {
  workspace: WorkspaceDoc;
  projects: Record<ProjectId, ProjectDoc>;
  projectId: ProjectId | null;
}

/* ------------------------------------------------------------------
   Entities with defaults
   ------------------------------------------------------------------ */

/** The /demo workspace: "Demo studio", Europe/Rome, EUR, Monday to Friday, nobody yet */
export function emptyWorkspace(o: Partial<WorkspaceDoc> = {}): WorkspaceDoc {
  return {
    schemaVersion: 2,
    docType: "workspace",
    id: DEMO_WORKSPACE_ID,
    name: "Demo studio",
    timezone: "Europe/Rome",
    defaultCurrency: "EUR",
    workingDays: [1, 2, 3, 4, 5],
    closures: {},
    holidayPreset: null,
    people: {},
    templates: {},
    projects: {},
    improveFormOptIn: false,
    createdAt: FIXTURE_NOW,
    ...o,
  };
}

export function makePerson(p: Partial<Person> & Pick<Person, "id" | "name" | "order">): Person {
  return {
    role: null,
    email: null,
    userId: null,
    capacityDaysPerWeek: null,
    dayRateCents: null,
    timeOff: {},
    archived: false,
    createdAt: FIXTURE_NOW,
    ...p,
  };
}

/** A To-do task at 0% with unknown estimate and nothing else set */
export function makeTask(t: Partial<Task> & Pick<Task, "id" | "title" | "order">): Task {
  return {
    kind: "task",
    description: null,
    status: "todo",
    priority: "medium",
    progress: 0,
    estimateDays: null,
    allocation: 1,
    pinnedStart: null,
    dueDate: null,
    dependsOn: [],
    ownerId: null,
    costCents: null,
    tags: [],
    links: [],
    emphasis: false,
    steps: [],
    createdAt: FIXTURE_NOW,
    completedAt: null,
    ...t,
  };
}

/** A new project with the plan §3.9 defaults */
export function makeProject(p: Partial<ProjectDoc> & Pick<ProjectDoc, "id" | "workspaceId" | "title">): ProjectDoc {
  return {
    schemaVersion: 2,
    docType: "project",
    client: null,
    kind: "other",
    goal: null,
    status: "planning",
    startDate: null,
    startConfirmed: false,
    deadline: null,
    deadlineKind: "soft",
    currency: "EUR",
    budgetCents: null,
    leadId: null,
    memberIds: [],
    requireReview: false,
    autoChain: true,
    calendarOverride: null,
    links: [],
    tags: [],
    views: ["cards"],
    blocks: [...DEFAULT_BLOCKS],
    viewConfig: defaultViewConfig(),
    tasks: {},
    moodboard: { items: {} },
    brief: emptyBriefState(),
    proposal: null,
    createdAt: FIXTURE_NOW,
    ...p,
  };
}

export function indexEntry(id: ProjectId, createdAt: Timestamp = FIXTURE_NOW): ProjectIndexEntry {
  return { id, createdAt, archivedAt: null, deletedAt: null };
}

/** Records keyed by id, in list order */
export function byId<T extends { id: string }>(list: readonly T[]): Record<T["id"], T> {
  return Object.fromEntries(list.map((x) => [x.id, x])) as Record<T["id"], T>;
}

/** Adds a project and its index entry to a state, and makes it the active one */
export function withProject(state: FixtureState, project: ProjectDoc): FixtureState {
  return {
    workspace: { ...state.workspace, projects: { ...state.workspace.projects, [project.id]: indexEntry(project.id, project.createdAt) } },
    projects: { ...state.projects, [project.id]: project },
    projectId: project.id,
  };
}

/** The active project of a state; throws when there is none */
export function activeProject(state: FixtureState): ProjectDoc {
  if (state.projectId === null) throw new Error("This fixture has no active project");
  return state.projects[state.projectId];
}

/** A project's task by title; throws when there is none, so a test never runs on undefined */
export function taskByTitle(project: ProjectDoc, title: string): Task {
  const task = Object.values(project.tasks).find((t) => t.title === title);
  if (!task) throw new Error(`No task called "${title}"`);
  return task;
}

/* ------------------------------------------------------------------
   Empty and demo
   ------------------------------------------------------------------ */

/** The /demo workspace with no project ("empty") */
export function emptyState(): FixtureState {
  return { workspace: emptyWorkspace(), projects: {}, projectId: null };
}

/** The demo workspace with one project that has no tasks yet */
export function emptyProjectState(o: { seed?: number; title?: string } = {}): FixtureState {
  const mint = seededMinter(o.seed ?? 1);
  const project = makeProject({ id: mint("project"), workspaceId: DEMO_WORKSPACE_ID, title: o.title ?? "New project" });
  return withProject(emptyState(), project);
}

/** The sample team (plan §8.3): weekly capacities that keep the v0 story true */
export function samplePeople(): Person[] {
  const [a, b, c] = nKeys(3);
  return [
    makePerson({ id: DEMO_PEOPLE.marta, name: "Marta", role: "Art director", capacityDaysPerWeek: 2, order: a }),
    makePerson({ id: DEMO_PEOPLE.sara, name: "Sara", role: "Designer", capacityDaysPerWeek: 4, order: b }),
    makePerson({ id: DEMO_PEOPLE.luca, name: "Luca", role: "Developer", capacityDaysPerWeek: 5, order: c }),
  ];
}

export interface DemoOptions {
  /** Seeds the project and task ids */
  seed?: number;
  title?: string;
  views?: ViewKind[];
  blocks?: BlockKind[];
}

/**
 * The v0 website template in v2 (plan §8.3): Research → Visual Direction → UI Design →
 * Development from the unconfirmed sample start, owned by the sample team.
 */
export function demoState(o: DemoOptions = {}): FixtureState {
  const mint = seededMinter(o.seed ?? 2026);
  const people = samplePeople();
  const projectId = mint("project");
  const [research, visual, ui, dev] = [mint("task"), mint("task"), mint("task"), mint("task")];
  const [k0, k1, k2, k3] = nKeys(4);
  const tasks = [
    makeTask({ id: research, title: "Research", status: "done", priority: "low", progress: 100, estimateDays: 3, ownerId: DEMO_PEOPLE.sara, order: k0 }),
    makeTask({
      id: visual,
      title: "Visual Direction",
      status: "review",
      priority: "high",
      progress: 85,
      estimateDays: 4,
      ownerId: DEMO_PEOPLE.marta,
      dependsOn: [research],
      order: k1,
    }),
    makeTask({ id: ui, title: "UI Design", status: "active", priority: "urgent", progress: 30, estimateDays: 6, ownerId: DEMO_PEOPLE.marta, dependsOn: [visual], order: k2 }),
    makeTask({ id: dev, title: "Development", status: "todo", priority: "medium", progress: 0, estimateDays: 8, ownerId: DEMO_PEOPLE.luca, dependsOn: [ui], order: k3 }),
  ];
  const project = makeProject({
    id: projectId,
    workspaceId: DEMO_WORKSPACE_ID,
    title: o.title ?? "New website",
    kind: "website",
    status: "active",
    startDate: SAMPLE_START,
    startConfirmed: false,
    memberIds: people.map((p) => p.id),
    views: o.views ?? ["cards"],
    blocks: o.blocks ?? [...DEFAULT_BLOCKS],
    tasks: byId(tasks),
  });
  return withProject({ workspace: emptyWorkspace({ people: byId(people) }), projects: {}, projectId: null }, project);
}

/* ------------------------------------------------------------------
   Generated projects
   ------------------------------------------------------------------ */

export interface GeneratedOptions {
  /** Steps on every task that isn't a milestone (default 3) */
  stepsPerTask?: number;
  /** Mean number of predecessors per task (default 1.5) */
  predsMean?: number;
  /** People in the team when no workspace is given (default 8) */
  people?: number;
  /** Seeds ids and choices (default n) */
  seed?: number;
  /** Mood items on the board (default 0) */
  moodItems?: number;
  /** Brief lines the user added (default 0) */
  briefLines?: number;
  /** Builds on this workspace and its people instead of a new one */
  workspace?: WorkspaceDoc;
  title?: string;
}

/** mulberry32: the generator behind every random choice here */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

const NAMES = ["Marta", "Sara", "Luca", "Giulia", "Paolo", "Elena", "Marco", "Chiara", "Davide", "Anna", "Fabio", "Irene"];
const ROLES = ["Art director", "Designer", "Developer", "Copywriter", "Producer"];
/** Weekly capacities, with one unknown (Q3) */
const CAPACITIES = [5, 4, 3, 5, 2, 4.5, null, 5];
const DAY_RATES = [45_000, 40_000, null, 50_000, 38_000, null];
const TAGS = ["design", "client", "dev", "copy"];
const HEXES = ["#0c0c0c", "#f2efe8", "#c65d3b", "#2a8c86", "#d4a017"];

/** A team of `count` people with distinct names, ids from `mint` */
export function generatedPeople(count: number, mint: Minter): Person[] {
  const orders = nKeys(count);
  return Array.from({ length: count }, (_, i) =>
    makePerson({
      id: mint("person"),
      name: i < NAMES.length ? NAMES[i] : `${NAMES[i % NAMES.length]} ${Math.floor(i / NAMES.length) + 1}`,
      role: ROLES[i % ROLES.length],
      capacityDaysPerWeek: CAPACITIES[i % CAPACITIES.length],
      dayRateCents: DAY_RATES[i % DAY_RATES.length],
      order: orders[i],
    }),
  );
}

function pick<T>(rand: () => number, list: readonly T[]): T {
  return list[Math.floor(rand() * list.length)];
}

function weighted<T>(rand: () => number, choices: readonly (readonly [T, number])[]): T {
  let r = rand() * choices.reduce((s, [, w]) => s + w, 0);
  for (const [value, w] of choices) {
    r -= w;
    if (r < 0) return value;
  }
  return choices[choices.length - 1][0];
}

/** The status of the task at fraction `f` of the workflow: early work done, late work to do */
function statusAt(f: number, rand: () => number): Status {
  if (f < 0.3) return rand() < 0.95 ? "done" : "active";
  if (f < 0.45) return weighted<Status>(rand, [["done", 2], ["review", 2], ["active", 4], ["todo", 2]]);
  return rand() < 0.85 ? "todo" : "active";
}

/** Earlier tasks this one waits on: mostly recent ones, sometimes any earlier task */
function predecessors(i: number, predsMean: number, rand: () => number): number[] {
  if (i === 0 || rand() < 0.08) return [];
  const base = Math.floor(predsMean);
  const want = Math.min(i, DEPS_MAX, base + (rand() < predsMean - base ? 1 : 0));
  const chosen = new Set<number>();
  for (let tries = 0; chosen.size < want && tries < want * 8; tries++) {
    const j = rand() < 0.9 ? i - 1 - Math.floor(rand() * Math.min(i, 10)) : Math.floor(rand() * i);
    chosen.add(j);
  }
  return [...chosen].sort((a, b) => a - b);
}

/**
 * An n-task project on a workspace with a team (plan §10.7: `generated(150, { stepsPerTask: 3,
 * predsMean: 1.5, people: 8 })`). About one task in twelve is a milestone and one in ten has no
 * estimate; statuses run from Done to To do along the workflow, all coherent. The start is
 * confirmed, so planning can show lateness.
 */
export function generated(n: number, o: GeneratedOptions = {}): FixtureState {
  const seed = o.seed ?? n;
  const stepsPerTask = o.stepsPerTask ?? 3;
  const predsMean = o.predsMean ?? 1.5;
  const mint = seededMinter(seed);
  const rand = generator(seed ^ 0x9e3779b9);

  const workspace = o.workspace ?? emptyWorkspace({ people: byId(generatedPeople(o.people ?? 8, mint)) });
  const people = Object.values(workspace.people).filter((p) => !p.archived);
  const projectId = mint("project");
  const ids: TaskId[] = Array.from({ length: n }, () => mint("task"));
  const orders = nKeys(n);

  const tasks: Task[] = ids.map((id, i) => {
    const milestone = i > 0 && i % 12 === 11;
    const f = i / n;
    const status: Status = milestone ? (f < 0.3 ? "done" : "todo") : statusAt(f, rand);
    const progress =
      status === "done" ? 100 : status === "todo" ? 0 : status === "review" ? 60 + 5 * Math.floor(rand() * 8) : 5 * (1 + Math.floor(rand() * 18));
    const steps: Step[] = milestone
      ? []
      : Array.from({ length: stepsPerTask }, (_, j) => ({
          id: mint("step"),
          title: `Step ${j + 1}`,
          done: status === "done" || (status !== "todo" && rand() < 0.3),
          ownerId: null,
          estimateDays: rand() < 0.3 ? null : 0.5 * (1 + Math.floor(rand() * 4)),
        }));
    const owned = people.length > 0 && rand() < 0.85;
    return makeTask({
      id,
      title: `${milestone ? "Milestone" : "Task"} ${i + 1}`,
      kind: milestone ? "milestone" : "task",
      description: rand() < 0.1 ? `Notes for task ${i + 1}.` : null,
      status,
      priority: weighted<Priority>(rand, [["low", 20], ["medium", 45], ["high", 25], ["urgent", 10]]),
      progress,
      estimateDays: milestone ? 0 : rand() < 0.1 ? null : (1 + Math.floor(rand() * 16)) / 2,
      allocation: milestone ? 1 : pick(rand, [1, 1, 1, 1, 0.5, 0.75] as const),
      pinnedStart: rand() < 0.04 ? addDays(SAMPLE_START, Math.floor(i * 1.2)) : null,
      dueDate: rand() < 0.1 ? addDays(SAMPLE_START, 5 + Math.floor(i * 1.5)) : null,
      dependsOn: predecessors(i, predsMean, rand).map((j) => ids[j]),
      ownerId: owned ? pick(rand, people).id : null,
      costCents: rand() < 0.1 ? 1000 * (10 + Math.floor(rand() * 90)) : null,
      tags: rand() < 0.2 ? [pick(rand, TAGS)] : [],
      links: rand() < 0.03 ? [{ id: mint("link"), label: "Figma", url: "https://www.figma.com/file/form" }] : [],
      emphasis: rand() < 0.05,
      steps,
      order: orders[i],
      completedAt: status === "done" && rand() < 0.5 ? COMPLETED_AT : null,
    });
  });

  const owners = new Set(tasks.map((t) => t.ownerId).filter((id): id is PersonId => id !== null));
  const lead = people[0]?.id ?? null;
  if (lead) owners.add(lead);
  const memberIds = people.map((p) => p.id).filter((id) => owners.has(id));

  const project = makeProject({
    id: projectId,
    workspaceId: workspace.id,
    title: o.title ?? `Generated ${n}`,
    kind: "website",
    status: "active",
    startDate: SAMPLE_START,
    startConfirmed: true,
    leadId: lead,
    memberIds,
    views: ["cards", "board", "timeline", "team", "focus", "brief"],
    blocks: ["header", "metrics", "progress", "collection", ...(o.moodItems ? (["moodboard"] as const) : [])],
    tasks: byId(tasks),
    moodboard: { items: byId(moodItems(o.moodItems ?? 0, mint)) },
    brief: {
      ...emptyBriefState(),
      lines: Array.from({ length: o.briefLines ?? 0 }, (_, i) => ({
        id: mint("briefLine"),
        audience: i % 2 === 0 ? ("client" as const) : ("team" as const),
        section: "next" as const,
        text: `Line ${i + 1} written by hand.`,
      })),
    },
  });
  return withProject({ workspace, projects: {}, projectId: null }, project);
}

/** `count` mood items laid out like v0 adds them: images, colours and notes in turn */
function moodItems(count: number, mint: Minter): MoodItem[] {
  const kinds: MoodKind[] = ["image", "color", "note"];
  const zs = frontZs([], count);
  const placed: MoodRect[] = [];
  return Array.from({ length: count }, (_, i) => {
    const kind = kinds[i % kinds.length];
    const box = placeNew(kind, {}, placed);
    placed.push(box);
    return {
      id: mint("moodItem"),
      kind,
      ...box,
      z: zs[i],
      assetId: kind === "image" ? mint("asset") : null,
      hex: kind === "color" ? HEXES[i % HEXES.length] : null,
      text: kind === "note" ? `Note ${i + 1}` : null,
    };
  });
}

export interface MultiProjectOptions extends Omit<GeneratedOptions, "workspace" | "title"> {
  /** Projects on the workspace (default 3) */
  projects?: number;
  /** Tasks in each project (default 50) */
  tasksPerProject?: number;
}

/**
 * Several generated projects sharing one workspace and one team ("multiProject150": 3 × 50 by
 * default; the load perf test uses 10 × 150). The first project is the active one.
 */
export function multiProject(o: MultiProjectOptions = {}): FixtureState {
  const count = o.projects ?? 3;
  const n = o.tasksPerProject ?? 50;
  const seed = o.seed ?? 150;
  const mint = seededMinter(seed);
  let state: FixtureState = {
    workspace: emptyWorkspace({ people: byId(generatedPeople(o.people ?? 8, mint)) }),
    projects: {},
    projectId: null,
  };
  let first: ProjectId | null = null;
  for (let k = 0; k < count; k++) {
    const next = generated(n, { ...o, seed: seed + 7919 * (k + 1), workspace: state.workspace, title: `Project ${k + 1}` });
    const project = activeProject(next);
    first ??= project.id;
    state = withProject({ ...state, workspace: next.workspace }, project);
  }
  return { ...state, projectId: first };
}
