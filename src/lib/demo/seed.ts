import type { Minter } from "@/lib/domain/ids";
import { resolvePerson } from "@/lib/domain/invariants/check";
import { compareKeys, sortedByOrder } from "@/lib/domain/order";
import { type PersonId, WorkspaceId } from "@/lib/domain/schema/ids";
import type { BirthView, Priority, Status, Timestamp } from "@/lib/domain/schema/primitives";
import type { ProjectDoc, ProjectDraft } from "@/lib/domain/schema/project";
import type { TaskSeed } from "@/lib/domain/schema/template";
import type { WorkspaceDoc } from "@/lib/domain/schema/workspace";
import { SAMPLE_OWNER_BY_TITLE, SAMPLE_PEOPLE, SAMPLE_START, type SamplePerson } from "@/lib/demo/sample";
import { makeOp, type Op, taskSeed } from "@/lib/ops/build";
import type { LocalIntent } from "@/lib/ops/local-intents";

/**
 * The /demo seed (plan §8.3): the workspace, the website template as v2 task seeds, and the two
 * demo expansions that bring the sample team in. They build ops only, through `ops/build`, so
 * the store's action creators and the fast parser (which gets them injected, plan §8.4) produce
 * the same commands, and every change still goes through the registry, the reducer and undo.
 *
 * Pure: time and ids come from the caller (`now`, a Minter). Imported only by the store, its
 * actions and the tests (lint-enforced).
 */

/* ------------------------------------------------------------------
   The workspace
   ------------------------------------------------------------------ */

/** The demo workspace's readable fixed id (plan §3.1) */
export const DEMO_WORKSPACE_ID: WorkspaceId = WorkspaceId.parse("wsp_demoworkspace");
export const DEMO_WORKSPACE_NAME = "Demo studio";
/** The demo works in euros, as v0 did */
export const DEMO_CURRENCY = "EUR";

/**
 * The /demo workspace before any project: nobody in it yet (the sample team arrives with the
 * first project or "Add a sample team"), Monday to Friday, in the browser's time zone (plan §8.1).
 */
export function demoWorkspace(now: Timestamp, timezone: string): WorkspaceDoc {
  return {
    schemaVersion: 2,
    docType: "workspace",
    id: DEMO_WORKSPACE_ID,
    name: DEMO_WORKSPACE_NAME,
    timezone,
    defaultCurrency: DEMO_CURRENCY,
    workingDays: [1, 2, 3, 4, 5],
    closures: {},
    holidayPreset: null,
    people: {},
    templates: {},
    projects: {},
    improveFormOptIn: false,
    createdAt: now,
  };
}

/* ------------------------------------------------------------------
   The template
   ------------------------------------------------------------------ */

/** One task of the website template; `dependsOn` and `owner` name other rows by title */
export interface DemoTaskSpec {
  readonly title: string;
  readonly status: Status;
  readonly priority: Priority;
  readonly progress: number;
  readonly estimateDays: number;
  /** The sample person who owns it, by name */
  readonly owner: SamplePerson["name"];
  readonly dependsOn: string | null;
}

/** The v0 website template (plan §8.3), in workflow order: a chain from Research to Development */
export const DEMO_TASKS: readonly DemoTaskSpec[] = Object.freeze([
  { title: "Research", status: "done", priority: "low", progress: 100, estimateDays: 3, owner: "Sara", dependsOn: null },
  { title: "Visual Direction", status: "review", priority: "high", progress: 85, estimateDays: 4, owner: "Marta", dependsOn: "Research" },
  { title: "UI Design", status: "active", priority: "urgent", progress: 30, estimateDays: 6, owner: "Marta", dependsOn: "Visual Direction" },
  { title: "Development", status: "todo", priority: "medium", progress: 0, estimateDays: 8, owner: "Luca", dependsOn: "UI Design" },
] as const);

/** The template's titles: "Add a sample team" staffs only these tasks (v0 SAMPLE_OWNERS) */
export const DEMO_TASK_TITLES: readonly string[] = DEMO_TASKS.map((t) => t.title);

/**
 * The draft of a demo project (plan §8.3): the website kind, starting on the labelled sample date
 * (unconfirmed, so nothing is ever late), in euros, with the sample team as its members, born as
 * the one view asked for.
 */
export function demoDraft(title: string, startAs: BirthView, memberIds: readonly PersonId[] = SAMPLE_PEOPLE.map((p) => p.id)): ProjectDraft {
  return {
    title,
    client: null,
    kind: "website",
    goal: null,
    startDate: SAMPLE_START,
    startConfirmed: false,
    deadline: null,
    deadlineKind: "soft",
    currency: DEMO_CURRENCY,
    budgetCents: null,
    leadId: null,
    memberIds: [...memberIds],
    requireReview: false,
    autoChain: true,
    calendarOverride: null,
    links: [],
    tags: [],
    startAs,
  };
}

/**
 * The template's four task seeds, with fresh ids and the given owners (by sample name). Research
 * is Done at 100%, so createProject records its completion; the demo never shows that date.
 */
export function demoSeeds(mint: Minter, ownerOf: (name: SamplePerson["name"]) => PersonId | null = sampleIdByName): TaskSeed[] {
  const ids = new Map(DEMO_TASKS.map((spec) => [spec.title, mint("task")]));
  return DEMO_TASKS.map((spec) =>
    taskSeed({
      taskId: ids.get(spec.title)!,
      title: spec.title,
      estimateDays: spec.estimateDays,
      dependsOn: spec.dependsOn === null ? [] : [ids.get(spec.dependsOn)!],
      status: spec.status,
      priority: spec.priority,
      progress: spec.progress,
      ownerId: ownerOf(spec.owner),
    }),
  );
}

function sampleIdByName(name: string): PersonId | null {
  return SAMPLE_PEOPLE.find((p) => p.name === name)?.id ?? null;
}

/* ------------------------------------------------------------------
   The sample team in a workspace
   ------------------------------------------------------------------ */

/** Who stands for a sample person in a workspace, and the op that brings them in (if any) */
interface SampleSeat {
  readonly sample: SamplePerson;
  /** The person who does the sample person's work */
  readonly personId: PersonId;
  readonly op: Op | null;
}

const nameKey = (name: string) => name.trim().toLowerCase();

/** An active person called `name`, other than the sample id (lowest id first, never record order) */
function activeNamed(ws: Pick<WorkspaceDoc, "people">, name: string): PersonId | null {
  for (const id of (Object.keys(ws.people) as PersonId[]).sort(compareKeys)) {
    const p = ws.people[id];
    if (!p.archived && nameKey(p.name) === nameKey(name)) return id;
  }
  return null;
}

/**
 * The sample team's seats in a workspace (v0 addSampleTeam: by id, else by name):
 * - the sample person is there and active: nothing to do;
 * - they are there but archived: restorePerson, unless someone active has their name (then that
 *   person stands in for them, as v0 matched people by name);
 * - they aren't there: someone active with their name stands in, else addPerson with the sample
 *   capacity (2, 4 or 5 days a week).
 */
export function sampleSeats(ws: Pick<WorkspaceDoc, "people">): SampleSeat[] {
  return SAMPLE_PEOPLE.map((sample): SampleSeat => {
    const found = resolvePerson(sample.id, ws);
    if (typeof found === "object") return { sample, personId: sample.id, op: null };
    const named = activeNamed(ws, sample.name);
    if (named !== null) return { sample, personId: named, op: null };
    if (found === "archived") return { sample, personId: sample.id, op: makeOp({ op: "restorePerson", personId: sample.id }) };
    return {
      sample,
      personId: sample.id,
      op: makeOp({
        op: "addPerson",
        personId: sample.id,
        name: sample.name,
        role: sample.role,
        email: null,
        capacityDaysPerWeek: sample.capacityDaysPerWeek,
        dayRateCents: null,
      }),
    };
  });
}

/* ------------------------------------------------------------------
   The two demo expansions
   ------------------------------------------------------------------ */

export interface DemoProjectRequest {
  /** The project title (v0: "New website", "New project" or the subject named) */
  title: string;
  /** The one view the project is born as */
  startAs: BirthView;
  /** "Create a moodboard for …": the project comes with its moodboard shown */
  wantsMoodboard: boolean;
  /** Whether the command replaces the open project (the `replacesProject` rule) */
  replace: boolean;
}

/** A command's worth of ops and local intents */
export interface DemoCommand {
  ops: Op[];
  local: LocalIntent[];
}

/**
 * `createDemoProject` (plan §8.3): at most 7 ops in one command and one history entry.
 * 1. deleteProject(open project) when the command replaces it;
 * 2. addPerson or restorePerson for each missing or archived sample person;
 * 3. createProject with the demo draft and the four template seeds;
 * 4. addBlock(moodboard) when asked;
 * 5. the local show of the view it is born as.
 */
export function createDemoProject(
  state: { workspace: Pick<WorkspaceDoc, "people">; project: Pick<ProjectDoc, "id"> | null },
  req: DemoProjectRequest,
  mint: Minter,
): DemoCommand {
  const ops: Op[] = [];
  if (req.replace && state.project !== null) ops.push(makeOp({ op: "deleteProject", projectId: state.project.id }));
  const seats = sampleSeats(state.workspace);
  for (const seat of seats) if (seat.op !== null) ops.push(seat.op);
  const seatOf = (name: string) => seats.find((s) => s.sample.name === name)?.personId ?? null;
  const projectId = mint("project");
  ops.push(
    makeOp({
      op: "createProject",
      projectId,
      draft: demoDraft(
        req.title,
        req.startAs,
        seats.map((s) => s.personId),
      ),
      tasks: demoSeeds(mint, seatOf),
    }),
  );
  if (req.wantsMoodboard) ops.push(makeOp({ op: "addBlock", block: "moodboard" }));
  return { ops, local: [{ kind: "show", view: req.startAs }] };
}

/**
 * `addSampleTeam` (plan §4.5): the demo's "Add a sample team" and "Use a sample team".
 * 1. addPerson or restorePerson for each missing or archived sample person;
 * 2. addMember for each of them who isn't in the project yet;
 * 3. assignTask, in workflow order, for each template task with no active owner: the sample
 *    owner it had in v0 (`SAMPLE_OWNER_BY_TITLE`).
 * At most 10 ops; without a project, only the people.
 */
export function addSampleTeam(ws: Pick<WorkspaceDoc, "people">, project: Pick<ProjectDoc, "memberIds" | "tasks"> | null): Op[] {
  const seats = sampleSeats(ws);
  const ops: Op[] = seats.flatMap((seat) => (seat.op === null ? [] : [seat.op]));
  if (project === null) return ops;
  for (const seat of seats) {
    if (!project.memberIds.includes(seat.personId)) ops.push(makeOp({ op: "addMember", personId: seat.personId }));
  }
  // Owners the expansion brings back count as owners: a restored Luca keeps his tasks
  const restored = new Set(seats.filter((s) => s.op?.op === "restorePerson").map((s) => s.personId));
  const hasOwner = (id: PersonId | null) => id !== null && (typeof resolvePerson(id, ws) === "object" || restored.has(id));
  for (const task of sortedByOrder(project.tasks)) {
    const sampleId = Object.hasOwn(SAMPLE_OWNER_BY_TITLE, task.title) ? SAMPLE_OWNER_BY_TITLE[task.title] : undefined;
    if (sampleId === undefined || hasOwner(task.ownerId)) continue;
    const seat = seats.find((s) => s.sample.id === sampleId);
    if (seat) ops.push(makeOp({ op: "assignTask", taskId: task.id, personId: seat.personId }));
  }
  return ops;
}
