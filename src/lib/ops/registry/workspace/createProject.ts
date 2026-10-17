import { z } from "zod";
import { docBytes } from "@/lib/domain/invariants/check";
import { coherenceProblems } from "@/lib/domain/invariants/transitions";
import { VIEW_LABEL } from "@/lib/domain/labels";
import { DOC_BYTES_MAX, PROJECTS_MAX, TEMPLATE_TASKS_MAX } from "@/lib/domain/limits";
import { nKeys } from "@/lib/domain/order";
import { type PersonId, ProjectId, type StepId, type TaskId, type WorkspaceId } from "@/lib/domain/schema/ids";
import type { OrderKey, Timestamp } from "@/lib/domain/schema/primitives";
import {
  DEFAULT_BLOCKS,
  defaultViewConfig,
  emptyBriefState,
  type ProjectDoc,
  ProjectDraftSchema,
  type Task,
} from "@/lib/domain/schema/project";
import { type TaskSeed, TaskSeedSchema } from "@/lib/domain/schema/template";
import type { WorkspaceDoc } from "@/lib/domain/schema/workspace";
import { defineOp, isRejection, type Rejection, reject } from "@/lib/ops/registry/_contract";
import { baseOf, ensureFreshId, mustActivePerson, part, SAMPLE_DATES, title, unique } from "@/lib/ops/registry/_helpers";
import { backwardsRange, fitsDoc, normaliseDays, recordBytes, tasksText } from "@/lib/ops/registry/_workspace";

/**
 * Creates a project from a draft (plan §4.4 row 16, Q9; v0 createProject). The op commits on the
 * workspace, where it adds the project's index entry; `spawn` builds the new project document in
 * the same command, so no op touches two documents. Everything is minted by the producer: the
 * project id, and each seed's task and step ids. The new project has the plan §3.9 defaults, is
 * born as the one view the draft asks for, and starts with up to 150 fully formed task seeds
 * (a starter, a template, or the demo's four), in list order.
 *
 * The recipe refuses anything that would make the spawned document invalid, so the commit gate
 * never has to: dependencies name earlier seeds only, statuses are coherent, people exist and are
 * on the team. Milestones are normalised (estimate 0, allocation 1, no steps), and members,
 * tags and dependencies are deduplicated, as addTask does. A seed's owner joins the members.
 *
 * A project born as a timeline on an unconfirmed start says its dates are samples ("Timeline
 * created · 4 tasks · sample dates, sequenced from estimates"), as the Timeline itself does
 * (caption policy rule 6).
 */

const Schema = z
  .object({
    op: z.literal("createProject"),
    projectId: ProjectId,
    draft: ProjectDraftSchema,
    // A project starts from at most one template's worth of tasks
    tasks: z.array(TaskSeedSchema).max(TEMPLATE_TASKS_MAX),
  })
  .strict();
type CreateProject = z.infer<typeof Schema>;

/** A new project is planning until one of its tasks is under way (plan §5.5) */
const statusOf = (seeds: readonly TaskSeed[]) => (seeds.some((s) => s.status === "active") ? "active" : "planning");

function taskOf(seed: TaskSeed, order: OrderKey, now: Timestamp): Task {
  const milestone = seed.kind === "milestone";
  return {
    id: seed.taskId,
    title: seed.title,
    kind: seed.kind,
    description: null,
    status: seed.status,
    priority: seed.priority,
    progress: seed.progress,
    estimateDays: milestone ? 0 : seed.estimateDays,
    allocation: 1,
    pinnedStart: null,
    dueDate: null,
    dependsOn: unique(seed.dependsOn),
    ownerId: seed.ownerId,
    costCents: null,
    tags: [],
    links: [],
    emphasis: seed.emphasis,
    steps: milestone ? [] : seed.steps.map((s) => ({ id: s.stepId, title: s.title, done: false, ownerId: null, estimateDays: s.estimateDays })),
    order,
    createdAt: now,
    completedAt: seed.status === "done" ? now : null,
  };
}

/** The project document the command creates: a pure function of the op, so spawn and the recipe agree */
function buildProject(op: CreateProject, workspaceId: WorkspaceId, now: Timestamp): ProjectDoc {
  const { draft } = op;
  const keys = nKeys(op.tasks.length);
  const tasks: Record<TaskId, Task> = {};
  op.tasks.forEach((seed, i) => {
    tasks[seed.taskId] = taskOf(seed, keys[i], now);
  });
  const owners = op.tasks.map((s) => s.ownerId).filter((id): id is PersonId => id !== null);
  const override = draft.calendarOverride;
  return {
    schemaVersion: 2,
    docType: "project",
    id: op.projectId,
    workspaceId,
    title: draft.title,
    client: draft.client === null ? null : { ...draft.client },
    kind: draft.kind,
    goal: draft.goal,
    status: statusOf(op.tasks),
    startDate: draft.startDate,
    startConfirmed: draft.startConfirmed,
    deadline: draft.deadline,
    deadlineKind: draft.deadlineKind,
    currency: draft.currency,
    budgetCents: draft.budgetCents,
    leadId: draft.leadId,
    memberIds: unique([...draft.memberIds, ...owners]),
    requireReview: draft.requireReview,
    autoChain: draft.autoChain,
    calendarOverride:
      override === null
        ? null
        : { workingDays: override.workingDays === null ? null : normaliseDays(override.workingDays), closures: override.closures === null ? null : { ...override.closures } },
    links: draft.links.map((l) => ({ ...l })),
    tags: unique(draft.tags),
    views: [draft.startAs],
    blocks: [...DEFAULT_BLOCKS],
    viewConfig: defaultViewConfig(),
    tasks,
    moodboard: { items: {} },
    brief: emptyBriefState(),
    proposal: null,
    createdAt: now,
  };
}

/** The draft's own rules (plan §3.8 P1, P3, P12), checked before any document exists */
function checkDraft(draft: CreateProject["draft"]): Rejection | null {
  if (draft.startDate !== null && draft.deadline !== null && draft.startDate > draft.deadline) {
    return reject("invalid_payload", "The deadline comes before the start.");
  }
  for (const [key, closure] of Object.entries(draft.calendarOverride?.closures ?? {})) {
    if (key !== closure.id) return reject("invalid_payload", "A closure is stored under its own id.");
    const backwards = backwardsRange(closure);
    if (backwards) return backwards;
  }
  if (unique(draft.links.map((l) => l.id)).length !== draft.links.length) return reject("duplicate_id", "Two links share an id.");
  return null;
}

/** Lead, members and owners: people of the workspace who are on the team */
function checkPeople(op: CreateProject, ws: WorkspaceDoc): Rejection | null {
  const named = [op.draft.leadId, ...op.draft.memberIds, ...op.tasks.map((s) => s.ownerId)];
  for (const id of unique(named)) {
    if (id === null) continue;
    const person = mustActivePerson(ws, id);
    if (isRejection(person)) return person;
  }
  return null;
}

/** The seeds' own rules: fresh ids, earlier dependencies, coherent statuses (plan §3.8 P3–P6) */
function checkSeeds(op: CreateProject): Rejection | null {
  const taskIds = new Set<TaskId>();
  const stepIds = new Set<StepId>();
  for (const seed of op.tasks) {
    const name = title(seed.title);
    if (taskIds.has(seed.taskId)) return reject("duplicate_id", "Two tasks of the new project share an id.");
    for (const s of seed.steps) {
      if (stepIds.has(s.stepId)) return reject("duplicate_id", "Two steps of the new project share an id.");
      stepIds.add(s.stepId);
    }
    for (const dep of seed.dependsOn) {
      if (dep === seed.taskId) return reject("self_dependency", "A task can't wait on itself.");
      if (!taskIds.has(dep)) return reject("not_found", `${name} waits on a task that doesn't come before it.`);
    }
    taskIds.add(seed.taskId);
    if (seed.kind === "milestone" && seed.status !== "todo" && seed.status !== "done") {
      return reject("invalid_state", `${name} is a milestone: it's either to do or done.`);
    }
    if (seed.kind === "task" && seed.estimateDays === 0) return reject("invalid_payload", "An estimate is at least half a day.");
    const problem = coherenceProblems({ status: seed.status, progress: seed.progress, completedAt: null }, op.draft.requireReview)[0];
    if (problem) return reject("invalid_state", `${name}: ${problem}`);
  }
  return null;
}

export default defineOp({
  name: "createProject",
  scope: "workspace",
  schema: Schema,

  reduce(d, op, ctx) {
    const fresh = ensureFreshId(d, op.projectId);
    if (fresh) return fresh;
    if (Object.keys(d.projects).length >= PROJECTS_MAX) return reject("limit", `A workspace holds at most ${PROJECTS_MAX} projects.`);
    const refused = checkDraft(op.draft) ?? checkPeople(op, baseOf(d)) ?? checkSeeds(op);
    if (refused) return refused;
    if (docBytes(buildProject(op, d.id, ctx.now)) > DOC_BYTES_MAX) return reject("limit", "The new project would pass the 1 MB limit for a project.");
    const entry = { id: op.projectId, createdAt: ctx.now, archivedAt: null, deletedAt: null };
    const tooLarge = fitsDoc(d, recordBytes(op.projectId, entry));
    if (tooLarge) return tooLarge;
    d.projects[op.projectId] = entry;
  },

  spawn: (op, ctx) => buildProject(op, ctx.workspace.id, ctx.now),

  caption({ op }) {
    const { startAs, startDate, startConfirmed } = op.draft;
    const sample = startAs === "timeline" && startDate !== null && !startConfirmed && op.tasks.length > 0;
    return part(`${VIEW_LABEL[startAs]} created · ${op.tasks.length === 0 ? "no tasks yet" : tasksText(op.tasks.length)}${sample ? ` · ${SAMPLE_DATES}` : ""}`);
  },
  // A fresh project id is either created or refused
  noopCaption: () => null,
  undoable: true,
  activity: "show",
  idempotent: false,
  deprecates: ["createProject"],
  parser: { family: "create", examples: [{ say: "Make a board for the bakery launch", fixture: "empty" }] },
  palette: [
    { group: "Create", phrase: "Create a timeline for my project", rank: 10, needs: "none", fixture: "empty", surfaces: ["demo", "app"] },
    { group: "Create", phrase: "Create a project tracker for my new website", rank: 20, needs: "none", fixture: "empty", surfaces: ["demo", "app"] },
    { group: "Create", phrase: "Create a board for my new website", rank: 30, needs: "none", fixture: "empty", surfaces: ["demo", "app"] },
  ],
  transport: { tool: "project_draft" },
  sample(fx, mint) {
    const [research, visual] = [mint("task"), mint("task")];
    const seed = (taskId: string, t: string, dependsOn: string[], status: string, progress: number) => ({
      taskId,
      title: t,
      kind: "task",
      estimateDays: 3,
      dependsOn,
      status,
      priority: "medium",
      progress,
      ownerId: fx.person("Sara"),
      emphasis: false,
      steps: [],
    });
    return {
      op: "createProject",
      projectId: mint("project"),
      draft: {
        title: "Ceramica Bassi",
        client: { name: "Ceramica Bassi", contactName: null, contactEmail: null },
        kind: "brand-identity",
        goal: null,
        startDate: "2026-10-19",
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
        startAs: "timeline",
      },
      tasks: [seed(research, "Brand discovery", [], "active", 20), seed(visual, "Logo concepts", [research], "todo", 0)],
    };
  },
});
