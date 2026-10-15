import type { Minter } from "@/lib/domain/ids";
import { checkProject, checkWorkspace, docBytes, utf8Length, type Violation } from "@/lib/domain/invariants/check";
import { repairTask } from "@/lib/domain/invariants/transitions";
import { PRIORITY_LABEL, STATUS_LABEL } from "@/lib/domain/labels";
import { DOC_BYTES_MAX, PEOPLE_MAX, PROPOSAL_ITEMS_MAX, STEPS_MAX, TASKS_MAX } from "@/lib/domain/limits";
import { compareKeys, nKeys, nKeysBetween, sortedByOrder } from "@/lib/domain/order";
import type { PersonId, StepId, TaskId } from "@/lib/domain/schema/ids";
import type { OrderKey, Timestamp, ViewKind } from "@/lib/domain/schema/primitives";
import { type BriefState, type MoodItem, ProjectDocSchema, type ProjectDoc, type Step, type Task, type ViewConfig } from "@/lib/domain/schema/project";
import type { OwnerMove, Proposal } from "@/lib/domain/schema/proposal";
import { type Person, PersonSchema, type WorkspaceDoc } from "@/lib/domain/schema/workspace";
import { stepSeed } from "@/lib/ops/build";
import { emptyIdMap, type IdMap, IdMapBuilder, rewriteBriefKey } from "@/lib/migrate/v0/idmap";
import type { V0Source } from "@/lib/migrate/v0/read";
import {
  isRecord,
  type SalvageNotes,
  salvageV0,
  show,
  unwrapV0,
  type V0Doc,
  type V0Person,
  V0_SAMPLE_TEAM,
  type V0SampleId,
  type V0Task,
  type V0Tool,
} from "@/lib/migrate/v0/schema";

/**
 * v0 → v2 (plan §7.2): one v0 document becomes one project document plus the people to add to
 * the workspace. Pure: no storage, no clock, no randomness; time comes from `now` and ids from
 * `mint`, so a fixed `(now, minter seed)` gives the same result every time. Every change the
 * migration makes on the user's behalf is written to the report: what it coerced, dropped,
 * promoted and repaired.
 *
 * The steps, in the order they run:
 * 1. salvage (`schema.ts`);
 * 2. the shape: workflow order, steps under their top-level task, orphans and steps past 40
 *    promoted to tasks;
 * 3. ids, minted once in a fixed order (`idmap.ts`);
 * 4. people (sample team, deduplication, capacities), the moodboard and the brief lines;
 * 5. tasks: a finish-to-start chain over the workflow order, estimates read as working days (Q5),
 *    coherence repaired with status first (Q2);
 * 6. the proposal: the subtasks one wins over the workload plan;
 * 7. brief edit keys rewritten; edits whose entity is gone are dropped;
 * 8. validation: strict schemas and every invariant, or a MigrationError.
 */

export interface MigrateV0Options {
  /** createdAt of everything the migration creates */
  now: Timestamp;
  mint: Minter;
  /** demo: /demo's first load (plan §7.3); import: the Phase 2 importer */
  mode: "demo" | "import";
  /** The workspace the result joins: its id, currency and people (deduplication, order keys) */
  workspace: WorkspaceDoc;
  /** Demo mode: the sample team's ids and weekly capacities (`lib/demo/sample.ts`) */
  sample: { ids: Record<V0SampleId, PersonId>; capacities: Record<V0SampleId, number> };
  /** Import mode (Q4): whether Marta, Sara and Luca come along */
  includeSampleTeam: boolean;
  /** Where `readV0` found the value; "main" when omitted */
  source?: V0Source;
}

export interface MigrationReport {
  source: V0Source;
  /** Values coerced to what v2 accepts, by path in the v0 document */
  salvaged: { path: string; was: string; now: string }[];
  /** Things that couldn't come along, and why */
  dropped: { what: string; why: string }[];
  /** Orphan steps and steps past 40, promoted to tasks */
  promoted: number;
  /** Tasks whose status and progress disagreed (Q2: status wins), as "status@progress" */
  repaired: { title: string; from: string; to: string }[];
  /** "Schedule now skips weekends." when a dated, estimated schedule moved onto working days */
  notices: "weekendsNow"[];
  /** Whether the document had the sample team, and a sample start date */
  sample: { team: boolean; start: boolean };
  /** Legacy image keys the moodboard references: Phase 2 uploads only these */
  assets: { referenced: string[] };
  /** New people whose weekly capacity is unknown (Q3) */
  capacityUnknown: PersonId[];
  /** Entries in the v0 change log: /demo's "{n} changes" counter */
  changes: number;
}

export interface MigrateV0Result {
  /** People to add to the workspace, in v0 order (people it already had are reused, not repeated) */
  people: Person[];
  project: ProjectDoc | null;
  idMap: IdMap;
  /** The view to open: v0's view on screen when the project still has it */
  local: { activeView: ViewKind | null };
  report: MigrationReport;
}

/** The result failed validation: a bug in the migration, never the user's data (plan §7.2 step 12) */
export class MigrationError extends Error {
  readonly report: MigrationReport;
  readonly problems: readonly string[];

  constructor(report: MigrationReport, problems: readonly string[]) {
    super(`The v0 document couldn't be migrated: ${problems.slice(0, 3).join("; ")}${problems.length > 3 ? "; …" : ""}`);
    this.name = "MigrationError";
    this.report = report;
    this.problems = problems;
  }
}

function newReport(source: V0Source): MigrationReport {
  return {
    source,
    salvaged: [],
    dropped: [],
    promoted: 0,
    repaired: [],
    notices: [],
    sample: { team: false, start: false },
    assets: { referenced: [] },
    capacityUnknown: [],
    changes: 0,
  };
}

/** Case-insensitive, trimmed: the workspace's rule for unique names (W2) */
const nameKey = (name: string) => name.trim().toLowerCase();

/** The sample person this v0 person is: the template's id with the template's name */
function sampleKeyOf(p: V0Person): V0SampleId | null {
  if (p.id === null || !Object.hasOwn(V0_SAMPLE_TEAM, p.id)) return null;
  const key = p.id as V0SampleId;
  return nameKey(p.name) === nameKey(V0_SAMPLE_TEAM[key]) ? key : null;
}

/**
 * Migrates one stored v0 value (the zustand envelope, the backup or a bare document) into v2.
 * Total: anything unusable is salvaged or dropped and reported; it throws only a MigrationError,
 * when its own result fails validation.
 */
export function migrateV0(raw: unknown, o: MigrateV0Options): MigrateV0Result {
  const report = newReport(o.source ?? "main");
  const notes: SalvageNotes = {
    salvaged: (path, was, now) => report.salvaged.push({ path, was, now }),
    dropped: (what, why) => report.dropped.push({ what, why }),
  };
  const { doc, log } = unwrapV0(raw);
  // The labels are raw commands: only their number is kept (privacy)
  report.changes = Array.isArray(log) ? log.length : 0;
  const nothing = (): MigrateV0Result => ({ people: [], project: null, idMap: emptyIdMap(), local: { activeView: null }, report });

  if (!isRecord(doc) || Object.hasOwn(doc, "schemaVersion")) {
    notes.dropped("the saved value", `${show(doc)} isn't a v0 document`);
    return nothing();
  }
  const v0 = salvageV0(doc, notes);
  report.sample = { team: v0.people.some((p) => sampleKeyOf(p) !== null), start: v0.tool?.startDateIsSample ?? false };
  if (v0.tool === null) {
    dropWithoutProject(v0, notes);
    return nothing();
  }
  return new Migration(v0, v0.tool, o, report, notes).run();
}

/** "Reset demo" leaves no project: whatever else is stored has nowhere to go */
function dropWithoutProject(v0: V0Doc, notes: SalvageNotes): void {
  const leftovers: [number, string][] = [
    [v0.tasks.length, "tasks"],
    [v0.people.length, "people"],
    [v0.mood.length, "moodboard items"],
    [v0.brief.edits.length + v0.brief.lines.length, "brief edits and lines"],
    [v0.proposal || v0.plan ? 1 : 0, "pending proposal"],
  ];
  for (const [count, what] of leftovers) if (count > 0) notes.dropped(`${count} ${what}`, "the v0 document has no project to hold them");
}

/** Where every v0 task goes */
interface Shape {
  /** The v2 tasks: the workflow order first, then the promoted ones */
  tasks: V0Task[];
  /** The first `chainLength` tasks form the finish-to-start chain; promoted tasks have no dependencies */
  chainLength: number;
  /** Each task's steps (by v0 id), in step order, at most 40 */
  steps: Map<string, V0Task[]>;
}

class Migration {
  private readonly ids: IdMapBuilder;
  /** v0 person ids that weren't imported, with the reason their tasks lose them */
  private readonly notImported = new Map<string, string>();

  constructor(
    private readonly v0: V0Doc,
    private readonly tool: V0Tool,
    private readonly o: MigrateV0Options,
    private readonly report: MigrationReport,
    private readonly notes: SalvageNotes,
  ) {
    this.ids = new IdMapBuilder(o.mint);
  }

  run(): MigrateV0Result {
    const { o, tool, v0, report } = this;

    // Ids in the fixed order (idmap.ts): project, tasks, steps, people, mood (and images), brief lines, proposal
    const projectId = this.ids.fresh("project", tool.id);
    const shape = this.shape();
    const taskIds = shape.tasks.map((t) => this.ids.fresh("tasks", t.id));
    const stepIds = shape.tasks.map((t) => shape.steps.get(t.id)!.map((s) => this.ids.fresh("steps", s.id)));
    const { people, memberIds } = this.people();
    const moodItems = this.moodItems();
    const lines = v0.brief.lines.map((l) => ({ id: this.ids.fresh("briefLines", l.id), audience: l.audience, section: l.section, text: l.text }));

    const tasks = this.tasks(shape, taskIds, stepIds);
    const proposal = this.proposal(tasks);
    const project: ProjectDoc = {
      schemaVersion: 2,
      docType: "project",
      id: projectId,
      workspaceId: o.workspace.id,
      title: tool.title,
      client: null,
      // The v0 template is always a website
      kind: "website",
      goal: null,
      status: Object.values(tasks).some((t) => t.status !== "todo") ? "active" : "planning",
      startDate: tool.startDate,
      // Caveat: v0's ±1-week buttons also cleared the sample flag
      startConfirmed: tool.startDate !== null && !tool.startDateIsSample,
      deadline: null,
      deadlineKind: "soft",
      currency: o.workspace.defaultCurrency,
      budgetCents: null,
      leadId: null,
      memberIds,
      requireReview: false,
      autoChain: true,
      calendarOverride: null,
      links: [],
      tags: [],
      views: tool.views,
      blocks: tool.blocks,
      viewConfig: this.viewConfig(),
      tasks,
      moodboard: { items: Object.fromEntries(moodItems.map((m) => [m.id, m])) },
      brief: this.brief(lines),
      proposal,
      createdAt: o.now,
    };
    this.fitSize(project);

    report.promoted = shape.tasks.length - shape.chainLength;
    if (project.startDate !== null && Object.values(project.tasks).some((t) => t.estimateDays !== null)) report.notices.push("weekendsNow");
    this.validate(project, people);

    const representation = v0.view.representation;
    return {
      people,
      project,
      idMap: this.ids.build(),
      local: { activeView: project.views.includes(representation) ? representation : project.views[0] },
      report,
    };
  }

  /* ------------------------------------------------------------------
     Shape: workflow order, steps, promotions
     ------------------------------------------------------------------ */

  private shape(): Shape {
    const { v0, notes } = this;
    const byId = new Map<string, V0Task>();
    const index = new Map<string, number>();
    v0.tasks.forEach((t, i) => {
      byId.set(t.id, t);
      index.set(t.id, i);
    });

    // Workflow order: the stored order, filtered to top-level tasks once each, then the top-level tasks it misses
    const chain: V0Task[] = [];
    const inChain = new Set<string>();
    for (const id of v0.order) {
      const t = byId.get(id);
      if (t === undefined || t.parentId !== null) notes.dropped(`the order entry ${show(id)}`, t ? "it names a step" : "it names no task");
      else if (inChain.has(id)) notes.dropped(`the order entry ${show(id)}`, "it is listed twice");
      else {
        inChain.add(id);
        chain.push(t);
      }
    }
    for (const t of v0.tasks) {
      if (t.parentId === null && !inChain.has(t.id)) {
        inChain.add(t.id);
        chain.push(t);
        notes.salvaged(`order[${chain.length - 1}]`, "missing", show(t.id));
      }
    }

    // Every other task lands under a root: a top-level task, or an orphan promoted to a task.
    // A parent chain that ends at a missing task promotes its topmost task; one that loops
    // promotes the loop's task that comes first in record order.
    const rootOf = new Map<string, string>(chain.map((t) => [t.id, t.id]));
    const orphans: V0Task[] = [];
    const promote = (t: V0Task) => {
      orphans.push(t);
      rootOf.set(t.id, t.id);
      notes.salvaged(`tasks.${t.id}.parentId`, show(t.parentId), "null");
    };
    for (const t of v0.tasks) {
      if (rootOf.has(t.id)) continue;
      const path: V0Task[] = [];
      const onPath = new Set<string>();
      let cur = t;
      let root: string;
      for (;;) {
        const known = rootOf.get(cur.id);
        if (known !== undefined) {
          root = known;
          break;
        }
        path.push(cur);
        onPath.add(cur.id);
        const parent = cur.parentId === null ? undefined : byId.get(cur.parentId);
        if (parent === undefined) {
          promote(cur);
          root = cur.id;
          break;
        }
        if (onPath.has(parent.id)) {
          const loop = path.slice(path.indexOf(parent));
          const head = loop.reduce((a, b) => (index.get(a.id)! <= index.get(b.id)! ? a : b));
          promote(head);
          root = head.id;
          break;
        }
        cur = parent;
      }
      for (const p of path) if (!rootOf.has(p.id)) rootOf.set(p.id, root);
    }
    orphans.sort((a, b) => index.get(a.id)! - index.get(b.id)!);

    // Steps: direct children first, then deeper descendants flattened onto the root, each in record order
    const roots = [...chain, ...orphans];
    const direct = new Map<string, V0Task[]>(roots.map((r) => [r.id, []]));
    const deeper = new Map<string, V0Task[]>(roots.map((r) => [r.id, []]));
    for (const t of v0.tasks) {
      const root = rootOf.get(t.id)!;
      if (root === t.id) continue;
      if (t.parentId === root) direct.get(root)!.push(t);
      else {
        deeper.get(root)!.push(t);
        notes.salvaged(`tasks.${t.id}.parentId`, show(t.parentId), show(root));
      }
    }

    // A task holds at most 40 steps: the rest become tasks of their own
    const steps = new Map<string, V0Task[]>();
    const overflow: V0Task[] = [];
    for (const r of roots) {
      const all = [...direct.get(r.id)!, ...deeper.get(r.id)!];
      steps.set(r.id, all.slice(0, STEPS_MAX));
      for (const s of all.slice(STEPS_MAX)) {
        overflow.push(s);
        steps.set(s.id, []);
        notes.salvaged(`tasks.${s.id}.parentId`, show(s.parentId), "null");
      }
    }

    const tasks = [...roots, ...overflow];
    if (tasks.length > TASKS_MAX) {
      const cut = tasks.splice(TASKS_MAX);
      const stepCount = cut.reduce((n, t) => n + steps.get(t.id)!.length, 0);
      notes.dropped(`the last ${cut.length} tasks${stepCount ? ` and their ${stepCount} steps` : ""}`, `a project holds at most ${TASKS_MAX} tasks`);
    }
    return { tasks, chainLength: Math.min(chain.length, tasks.length), steps };
  }

  /* ------------------------------------------------------------------
     People
     ------------------------------------------------------------------ */

  /**
   * The v0 team (plan §7.2 step 6). Demo mode maps the sample team to its fixed ids and weekly
   * capacities; every other new person has an unknown capacity (Q3: v0 stored days per project,
   * which has no honest weekly conversion). Import mode leaves the sample team out unless asked
   * (Q4). A name the workspace (or an earlier v0 person) already has is reused, never repeated.
   * Every imported person is a member: v0's team was the project's team.
   */
  private people(): { people: Person[]; memberIds: PersonId[] } {
    const { o, notes, report } = this;
    const existing = sortedByOrder(o.workspace.people);
    const activeByName = new Map<string, PersonId>();
    for (const p of existing) if (!p.archived && !activeByName.has(nameKey(p.name))) activeByName.set(nameKey(p.name), p.id);

    const created: Omit<Person, "order">[] = [];
    const memberIds: PersonId[] = [];
    const byName = new Map<string, PersonId>();
    let room = PEOPLE_MAX - existing.length;

    for (const p of this.v0.people) {
      const sample = sampleKeyOf(p);
      if (sample !== null && o.mode === "import" && !o.includeSampleTeam) {
        notes.dropped(`person ${p.name}`, "the sample team isn't included");
        if (p.id !== null) this.notImported.set(p.id, "the sample team isn't included");
        continue;
      }
      const key = nameKey(p.name);
      let id = byName.get(key);
      if (id !== undefined) notes.dropped(`a second person called ${p.name}`, "names are unique: their tasks go to the first");
      else {
        const sampleId = sample !== null && o.mode === "demo" ? o.sample.ids[sample] : null;
        id = sampleId !== null && Object.hasOwn(o.workspace.people, sampleId) ? sampleId : activeByName.get(key);
        if (id === undefined) {
          if (room <= 0) {
            notes.dropped(`person ${p.name}`, `a workspace holds at most ${PEOPLE_MAX} people`);
            if (p.id !== null) this.notImported.set(p.id, `the workspace already holds ${PEOPLE_MAX} people`);
            continue;
          }
          room--;
          id = sampleId ?? (p.id !== null ? this.ids.fresh("people", p.id) : o.mint("person"));
          const capacity = sample !== null && sampleId !== null ? o.sample.capacities[sample] : null;
          if (capacity === null) report.capacityUnknown.push(id);
          created.push({
            id,
            name: p.name,
            role: p.role,
            email: null,
            userId: null,
            capacityDaysPerWeek: capacity,
            dayRateCents: null,
            timeOff: {},
            archived: false,
            createdAt: o.now,
          });
        }
        byName.set(key, id);
      }
      if (p.id !== null) this.ids.link("people", p.id, id);
      if (!memberIds.includes(id)) memberIds.push(id);
    }

    // Order keys follow the workspace's last person
    let last: OrderKey | null = null;
    for (const p of existing) if (last === null || compareKeys(p.order, last) > 0) last = p.order;
    const orders = nKeysBetween(last, null, created.length);
    const people = created.map(
      (p, i): Person => ({
        id: p.id,
        name: p.name,
        role: p.role,
        email: p.email,
        userId: p.userId,
        capacityDaysPerWeek: p.capacityDaysPerWeek,
        dayRateCents: p.dayRateCents,
        timeOff: p.timeOff,
        order: orders[i],
        archived: p.archived,
        createdAt: p.createdAt,
      }),
    );
    return { people, memberIds };
  }

  private owner(t: V0Task): PersonId | null {
    if (t.owner === null) return null;
    const id = this.ids.get("people", t.owner);
    if (id !== undefined) return id;
    this.notes.dropped(`the owner of "${t.title}"`, this.notImported.get(t.owner) ?? `${show(t.owner)} isn't in the team`);
    return null;
  }

  /* ------------------------------------------------------------------
     Tasks and steps
     ------------------------------------------------------------------ */

  private tasks(shape: Shape, taskIds: TaskId[], stepIds: StepId[][]): Record<TaskId, Task> {
    const { o, report } = this;
    const orders = nKeys(shape.tasks.length);
    const out: Record<TaskId, Task> = {};
    shape.tasks.forEach((t, i) => {
      const steps: Step[] = shape.steps.get(t.id)!.map((s, j) => {
        this.reportStep(s, t);
        return { id: stepIds[i][j], title: s.title, done: s.status === "done", ownerId: null, estimateDays: s.estimate };
      });
      const draft: Task = {
        id: taskIds[i],
        title: t.title,
        kind: "task",
        description: null,
        status: t.status,
        priority: t.priority,
        progress: t.progress,
        // Q5: the v0 number, read as working days (no ×5/7)
        estimateDays: t.estimate,
        allocation: 1,
        pinnedStart: null,
        dueDate: null,
        // The v0 sequence as finish-to-start dependencies (FORM-v1 §5.8): each task waits on the one before
        dependsOn: i > 0 && i < shape.chainLength ? [taskIds[i - 1]] : [],
        ownerId: this.owner(t),
        costCents: t.costCents,
        tags: [],
        links: [],
        emphasis: t.emphasis,
        steps,
        order: orders[i],
        createdAt: o.now,
        // When an imported task was completed is unknown, never invented
        completedAt: null,
      };
      const task = repairTask(draft);
      if (task !== draft) report.repaired.push({ title: t.title, from: `${draft.status}@${draft.progress}`, to: `${task.status}@${task.progress}` });
      out[task.id] = task;
    });
    return out;
  }

  /** A step keeps its title, its estimate and whether it's done; anything else it carried is reported */
  private reportStep(s: V0Task, parent: V0Task): void {
    const lost: string[] = [];
    if (s.status === "active" || s.status === "review") lost.push(`${STATUS_LABEL[s.status]} at ${s.progress}%`);
    else if (s.progress !== (s.status === "done" ? 100 : 0)) lost.push(`${s.progress}% progress`);
    if (s.priority !== "medium" && s.priority !== parent.priority) lost.push(`${PRIORITY_LABEL[s.priority]} priority`);
    if (s.costCents !== null) lost.push("its cost");
    if (s.emphasis) lost.push("its emphasis");
    if (s.owner !== null) lost.push("its owner");
    if (lost.length > 0) this.notes.dropped(`step "${s.title}": ${lost.join(", ")}`, "a step keeps only its title, its estimate and whether it's done");
  }

  /* ------------------------------------------------------------------
     View config, moodboard, brief, proposal
     ------------------------------------------------------------------ */

  private viewConfig(): ViewConfig {
    const view = this.v0.view;
    let focusPin: TaskId | null = null;
    if (view.focusId !== null) {
      focusPin = this.ids.get("tasks", view.focusId) ?? null;
      if (focusPin === null) this.notes.dropped("the focus pin", `${show(view.focusId)} isn't a task in the project, so FORM picks again`);
    }
    return {
      density: view.density,
      layout: view.layout,
      columns: view.columns,
      sort: view.sort,
      hideDone: view.hideDone,
      highlightUrgent: view.highlightUrgent,
      fields: { ...view.fields, owner: false, due: false, cost: false },
      filters: { ownerIds: [], statuses: [], priorities: [], tags: [], due: "any" },
      focusPin,
      brief: { audience: view.briefAudience, short: view.briefShort },
    };
  }

  /** Mood items keyed by fresh ids, stacked in array order; image keys become asset ids (aliases) */
  private moodItems(): MoodItem[] {
    const zs = nKeys(this.v0.mood.length);
    const referenced = this.report.assets.referenced;
    return this.v0.mood.map((m, i): MoodItem => {
      const id = this.ids.fresh("moodItems", m.id);
      let assetId = null;
      if (m.asset !== null) {
        if (this.ids.get("assets", m.asset) === undefined) referenced.push(m.asset);
        assetId = this.ids.asset(m.asset);
      }
      return { id, kind: m.kind, x: m.box.x, y: m.box.y, w: m.box.w, h: m.box.h, r: m.box.r, z: zs[i], assetId, hex: m.hex, text: m.text };
    });
  }

  /**
   * Edit keys are rewritten through the id map; an edit whose entity is gone is dropped. Bases are
   * kept, so a sentence whose wording changes with working days shows "FORM's version changed".
   */
  private brief(lines: BriefState["lines"]): BriefState {
    const edits: BriefState["edits"] = {};
    const lookup = { task: (id: string) => this.ids.get("tasks", id), person: (id: string) => this.ids.get("people", id) };
    for (const e of this.v0.brief.edits) {
      const next = rewriteBriefKey(e.key, lookup);
      if ("why" in next) this.notes.dropped(`the brief edit ${show(e.key)}`, next.why);
      else if (Object.hasOwn(edits, next.key)) this.notes.dropped(`the brief edit ${show(e.key)}`, "another edit already rewrites that sentence");
      else edits[next.key] = { text: e.text, basis: e.basis };
    }
    return { edits, lines, sent: [], sharing: { showBudgetToClient: false } };
  }

  /**
   * One pending proposal (plan §7.2 step 7). With both a breakdown and a workload plan pending,
   * the breakdown stays: the user chose its task, and "Balance the workload" recomputes the plan.
   */
  private proposal(tasks: Record<TaskId, Task>): Proposal | null {
    const { v0, notes, o } = this;
    if (v0.proposal) {
      const target = this.ids.get("tasks", v0.proposal.parentId);
      if (target !== undefined) {
        const id = this.ids.mintProposal();
        const items = v0.proposal.items.map((it) => stepSeed(this.ids.fresh("proposalItems", it.id), it.title, it.estimate));
        if (v0.plan) notes.dropped("the pending workload plan", "one proposal is kept, the breakdown; Balance the workload makes the plan again");
        return { id, createdAt: o.now, source: "parser", kind: "subtasks", taskId: target, items };
      }
      notes.dropped(
        "the pending breakdown",
        this.ids.get("steps", v0.proposal.parentId) !== undefined ? "it breaks down a step, and steps have no steps" : `its task, ${show(v0.proposal.parentId)}, is gone`,
      );
    }
    if (!v0.plan) return null;

    const moves: OwnerMove[] = [];
    for (const m of v0.plan.moves) {
      const taskId = this.ids.get("tasks", m.taskId);
      const task = taskId !== undefined ? tasks[taskId] : undefined;
      const what = `the workload move of ${task ? `"${task.title}"` : show(m.taskId)}`;
      const to = m.to === null ? undefined : this.ids.get("people", m.to);
      if (task === undefined) notes.dropped(what, "its task is gone");
      else if (m.to === null) notes.dropped(what, "it leaves the task with nobody");
      else if (to === undefined) notes.dropped(what, `${show(m.to)} isn't in the team`);
      else if (moves.some((x) => x.taskId === task.id)) notes.dropped(what, "the task is moved twice");
      else if (to === task.ownerId) notes.dropped(what, "the task already belongs to them");
      else moves.push({ type: "owner", taskId: task.id, from: task.ownerId, to, why: "" });
    }
    if (moves.length > PROPOSAL_ITEMS_MAX) {
      notes.dropped(`${moves.length - PROPOSAL_ITEMS_MAX} workload moves`, `a proposal holds at most ${PROPOSAL_ITEMS_MAX}`);
      moves.length = PROPOSAL_ITEMS_MAX;
    }
    if (moves.length === 0) {
      notes.dropped("the pending workload plan", "none of its moves still applies");
      return null;
    }
    return { id: this.ids.mintProposal(), createdAt: o.now, source: "parser", kind: "reassign", moves };
  }

  /* ------------------------------------------------------------------
     Size and validation
     ------------------------------------------------------------------ */

  /**
   * A document holds at most 1 MB. v0 had no such cap, so a huge save first loses its brief
   * edits, then its last tasks, until it fits; both are reported. Nothing depends on the last
   * task in workflow order, so removing from the end leaves no dangling dependency.
   */
  private fitSize(project: ProjectDoc): void {
    let bytes = docBytes(project);
    if (bytes <= DOC_BYTES_MAX) return;
    const edits = Object.keys(project.brief.edits).length;
    if (edits > 0) {
      project.brief.edits = {};
      this.notes.dropped(`${edits} brief edits`, "the project would pass 1 MB");
      bytes = docBytes(project);
    }
    const ordered = sortedByOrder(project.tasks);
    const map = this.ids.build();
    const v0Of = new Map<string, string>(Object.entries(map.tasks).map(([v0, id]) => [id, v0]));
    const v0StepOf = new Map<string, string>(Object.entries(map.steps).map(([v0, id]) => [id, v0]));
    let removed = 0;
    while (bytes > DOC_BYTES_MAX && ordered.length > 0) {
      // Remove about enough tasks, then measure again
      let over = bytes - DOC_BYTES_MAX;
      while (over > 0 && ordered.length > 0) {
        const t = ordered.pop()!;
        over -= utf8Length(JSON.stringify(t)) + utf8Length(t.id) + 4;
        delete project.tasks[t.id];
        this.ids.forget("tasks", v0Of.get(t.id) ?? "");
        for (const s of t.steps) this.ids.forget("steps", v0StepOf.get(s.id) ?? "");
        removed++;
      }
      bytes = docBytes(project);
    }
    if (removed === 0) return;
    this.notes.dropped(`the last ${removed} tasks`, "the project would pass 1 MB");
    const exists = (id: TaskId) => Object.hasOwn(project.tasks, id);
    if (project.viewConfig.focusPin !== null && !exists(project.viewConfig.focusPin)) project.viewConfig.focusPin = null;
    const p = project.proposal;
    if (p?.kind === "subtasks" && !exists(p.taskId)) project.proposal = null;
    if (p?.kind === "reassign") {
      const moves = p.moves.filter((m) => exists(m.taskId));
      project.proposal = moves.length > 0 ? { ...p, moves } : null;
    }
    if (project.proposal === null) this.ids.dropProposal();
  }

  /** Both outputs pass the strict schemas and the invariants, and every person they name exists */
  private validate(project: ProjectDoc, people: Person[]): void {
    const { o } = this;
    const problems: string[] = [];
    const describe = (v: Violation) => `${v.code} at ${v.path.join(".")}: ${v.message}`;

    const parsed = ProjectDocSchema.safeParse(project);
    if (!parsed.success) problems.push(...parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`));
    else problems.push(...checkProject(project).map(describe));

    for (const p of people) {
      const person = PersonSchema.safeParse(p);
      if (!person.success) problems.push(...person.error.issues.slice(0, 3).map((i) => `person ${p.id}.${i.path.join(".")}: ${i.message}`));
    }
    const merged: WorkspaceDoc = { ...o.workspace, people: { ...o.workspace.people, ...Object.fromEntries(people.map((p) => [p.id, p])) } };
    const before = new Set(checkWorkspace(o.workspace).map(describe));
    problems.push(...checkWorkspace(merged).map(describe).filter((v) => !before.has(v)));

    // Owner validity is read-time (Q7), but the migration never leaves a reference dangling
    const named: (PersonId | null)[] = [...project.memberIds, ...Object.values(project.tasks).map((t) => t.ownerId)];
    if (project.proposal?.kind === "reassign") for (const m of project.proposal.moves) if (m.type === "owner") named.push(m.from, m.to);
    for (const id of named) if (id !== null && !Object.hasOwn(merged.people, id)) problems.push(`${id} is named but isn't in the workspace`);

    if (problems.length > 0) throw new MigrationError(this.report, problems);
  }
}
