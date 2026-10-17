// Schema v2 documents (plan §3.3–§3.6): strict, parse equals validate, every limit enforced at
// +1, and `.pick()` works because no document schema carries an object-level refinement
// (plan §12 item 8: zod 4.6.5 throws on `.pick()` over refinements).
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  BRIEF_BASIS,
  BRIEF_EDIT_KEY,
  BRIEF_LINES_MAX,
  BRIEF_SENT_MAX,
  BRIEF_TEXT_MAX,
  COMMAND_TEXT,
  COMMIT_OPS_MAX,
  DEPS_MAX,
  LINKS_MAX,
  MEMBERS_MAX,
  MOOD_TEXT,
  PERSON_NAME,
  PROJECT_GOAL,
  PROJECT_TITLE,
  PROPOSAL_BULK_MAX,
  PROPOSAL_ITEMS_MAX,
  PROPOSAL_WHY,
  STEP_TITLE,
  STEPS_MAX,
  TAG,
  TAGS_MAX,
  TASK_DESCRIPTION,
  TASK_TITLE,
  TEMPLATE_TASKS_MAX,
  WORKSPACE_NAME,
} from "@/lib/domain/limits";
import {
  CommitSchema,
  DemoEnvelopeSchema,
  type DemoEnvelope,
  type MoodItem,
  PersonId,
  ProjectDocSchema,
  type ProjectDoc,
  ProjectDraftSchema,
  ProposalSchema,
  type Proposal,
  StepId,
  TaskId,
  TaskSchema,
  TaskSeedSchema,
  TemplateSchema,
  type Template,
  WorkspaceDocSchema,
  type WorkspaceDoc,
} from "@/lib/domain/schema";
import * as schema from "@/lib/domain/schema";
import { activeProject, DEMO_PEOPLE, demoState, FIXTURE_NOW, generated, taskByTitle } from "../../../../test/fixtures/v2/build";

const ok = (s: z.ZodType, v: unknown) => {
  const r = s.safeParse(v);
  expect(r.success, r.error?.message).toBe(true);
};
const bad = (s: z.ZodType, v: unknown) => expect(s.safeParse(v).success).toBe(false);

/** A fresh demo project, edited; the edit may break it */
function project(edit: (p: ProjectDoc, t: (title: string) => ProjectDoc["tasks"][TaskId]) => void): ProjectDoc {
  const p = activeProject(demoState());
  edit(p, (title) => taskByTitle(p, title));
  return p;
}
function workspace(edit: (w: WorkspaceDoc) => void): WorkspaceDoc {
  const w = demoState().workspace;
  edit(w);
  return w;
}

/** The value at a limit passes, one more fails */
function limit(build: (n: number) => ProjectDoc, max: number) {
  ok(ProjectDocSchema, build(max));
  bad(ProjectDocSchema, build(max + 1));
}

const x = (n: number) => "x".repeat(n);
const list = <T>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));

describe("document schemas", () => {
  it("parse the fixtures to deep-equal values (parse equals validate)", () => {
    for (const state of [demoState(), generated(60, { moodItems: 12, briefLines: 4 })]) {
      expect(WorkspaceDocSchema.parse(state.workspace)).toEqual(state.workspace);
      const p = activeProject(state);
      expect(ProjectDocSchema.parse(p)).toEqual(p);
    }
  });

  it("are strict at every level", () => {
    bad(ProjectDocSchema, project((p) => Object.assign(p, { updatedAt: FIXTURE_NOW })));
    bad(ProjectDocSchema, project((_, t) => Object.assign(t("UI Design"), { parentId: null })));
    bad(ProjectDocSchema, project((p) => Object.assign(p.viewConfig.fields, { tags: true })));
    bad(ProjectDocSchema, project((p) => Object.assign(p.viewConfig.filters, { search: "" })));
    bad(ProjectDocSchema, project((p) => Object.assign(p.moodboard, { layout: "grid" })));
    bad(ProjectDocSchema, project((p) => Object.assign(p.brief.sharing, { token: "x" })));
    bad(WorkspaceDocSchema, workspace((w) => Object.assign(w, { theme: "dark" })));
    bad(WorkspaceDocSchema, workspace((w) => Object.assign(w.people[DEMO_PEOPLE.marta], { capacity: 7 })));
  });

  it("carry no defaults: a missing field fails", () => {
    bad(ProjectDocSchema, project((p) => delete (p as Partial<ProjectDoc>).tags));
    bad(WorkspaceDocSchema, workspace((w) => delete (w as Partial<WorkspaceDoc>).improveFormOptIn));
    bad(ProjectDocSchema, project((p) => void Object.assign(p, { schemaVersion: 1 })));
    bad(ProjectDocSchema, project((p) => void Object.assign(p, { docType: "workspace" })));
  });

  it("support .pick() and .partial(): no object-level refinement anywhere", () => {
    const objects = [ProjectDocSchema, WorkspaceDocSchema, TaskSchema, TaskSeedSchema, TemplateSchema, CommitSchema, DemoEnvelopeSchema] as unknown as z.ZodObject[];
    for (const s of objects) {
      const first = Object.keys(s.shape)[0];
      expect(() => s.pick({ [first]: true } as Record<string, true>)).not.toThrow();
      expect(() => s.partial()).not.toThrow();
    }
    // The trap this guards against: one object-level refinement and `.pick()` throws
    const refined = z.object({ a: z.string() }).refine(() => true) as unknown as z.ZodObject;
    expect(() => refined.pick({ a: true })).toThrow();
  });
});

describe("defaults for a new project (plan §3.9)", () => {
  it("view config: comfortable grid, automatic columns, workflow order, three fields, no filters", () => {
    const config = schema.defaultViewConfig();
    expect(config).toEqual({
      density: "comfortable",
      layout: "grid",
      columns: null,
      sort: "manual",
      hideDone: false,
      highlightUrgent: false,
      fields: { priority: true, estimate: true, progress: true, owner: false, due: false, cost: false },
      filters: { ownerIds: [], statuses: [], priorities: [], tags: [], due: "any" },
      focusPin: null,
      brief: { audience: "client", short: false },
    });
    expect(schema.ViewConfigSchema.parse(config)).toEqual(config);
    expect(schema.DEFAULT_VIEW_CONFIG).toEqual(config);
    // Fresh objects, and a frozen shared default
    expect(schema.defaultViewConfig()).not.toBe(config);
    expect(Object.isFrozen(schema.DEFAULT_VIEW_CONFIG.filters.ownerIds)).toBe(true);
  });

  it("blocks and the brief", () => {
    expect(schema.DEFAULT_BLOCKS).toEqual(["header", "metrics", "collection"]);
    expect(schema.PROTECTED_BLOCKS).toEqual(["header", "collection"]);
    expect(schema.emptyBriefState()).toEqual({ edits: {}, lines: [], sent: [], sharing: { showBudgetToClient: false } });
  });
});

describe("ProjectDraftSchema", () => {
  const draft = {
    title: "Ceramica Bassi website",
    client: { name: "Ceramica Bassi", contactName: null, contactEmail: "studio@example.com" },
    kind: "website",
    goal: "A site that sells the spring collection.",
    startDate: "2026-11-02",
    startConfirmed: true,
    deadline: "2026-11-30",
    deadlineKind: "hard",
    currency: "EUR",
    budgetCents: 1_200_000,
    leadId: DEMO_PEOPLE.marta,
    memberIds: [DEMO_PEOPLE.marta, DEMO_PEOPLE.luca],
    requireReview: false,
    autoChain: true,
    calendarOverride: null,
    links: [],
    tags: ["client"],
    startAs: "timeline",
  };

  it("imports cleanly and parses a draft", () => {
    expect(schema.ProjectDraftSchema).toBe(ProjectDraftSchema);
    ok(ProjectDraftSchema, draft);
    expect(Object.keys(ProjectDraftSchema.shape).sort()).toEqual([...Object.keys(draft)].sort());
  });

  it("is strict and needs a birth view", () => {
    bad(ProjectDraftSchema, { ...draft, tasks: {} });
    bad(ProjectDraftSchema, { ...draft, startAs: "team" });
    const { startAs, ...noView } = draft;
    expect(startAs).toBe("timeline");
    bad(ProjectDraftSchema, noView);
    bad(ProjectDraftSchema, { ...draft, title: x(PROJECT_TITLE + 1) });
  });
});

describe("limits at +1", () => {
  it("titles, names and texts", () => {
    limit((n) => project((p) => void (p.title = x(n))), PROJECT_TITLE);
    limit((n) => project((_, t) => void (t("UI Design").title = x(n))), TASK_TITLE);
    limit((n) => project((_, t) => void (t("UI Design").steps = [{ id: StepId.parse("stp_step0000000001"), title: x(n), done: false, ownerId: null, estimateDays: null }])), STEP_TITLE);
    limit((n) => project((p) => void (p.goal = x(n))), PROJECT_GOAL);
    limit((n) => project((_, t) => void (t("UI Design").description = x(n))), TASK_DESCRIPTION);
    ok(WorkspaceDocSchema, workspace((w) => void (w.people[DEMO_PEOPLE.marta].name = x(PERSON_NAME))));
    bad(WorkspaceDocSchema, workspace((w) => void (w.people[DEMO_PEOPLE.marta].name = x(PERSON_NAME + 1))));
    ok(WorkspaceDocSchema, workspace((w) => void (w.name = x(WORKSPACE_NAME))));
    bad(WorkspaceDocSchema, workspace((w) => void (w.name = x(WORKSPACE_NAME + 1))));
  });

  it("lines are trimmed and single, tags carry no commas", () => {
    bad(ProjectDocSchema, project((p) => void (p.title = " Website")));
    bad(ProjectDocSchema, project((p) => void (p.title = "Web\nsite")));
    bad(ProjectDocSchema, project((p) => void (p.title = "")));
    limit((n) => project((p) => void (p.tags = [x(n)])), TAG);
    bad(ProjectDocSchema, project((p) => void (p.tags = ["a,b"])));
  });

  it("lists on tasks", () => {
    limit((n) => project((_, t) => void (t("UI Design").tags = list(n, (i) => `tag${i}`))), TAGS_MAX);
    limit((n) => project((_, t) => void (t("UI Design").links = list(n, (i) => ({ id: `lnk_link${String(i).padStart(8, "0")}` as never, label: "Figma", url: "https://figma.com" })))), LINKS_MAX);
    limit(
      (n) => project((_, t) => void (t("UI Design").steps = list(n, (i) => ({ id: StepId.parse(`stp_${String(i).padStart(8, "0")}`), title: "Step", done: false, ownerId: null, estimateDays: null })))),
      STEPS_MAX,
    );
    limit((n) => project((_, t) => void (t("UI Design").dependsOn = list(n, (i) => TaskId.parse(`tsk_${String(i).padStart(8, "0")}`)))), DEPS_MAX);
  });

  it("lists on projects", () => {
    limit((n) => project((p) => void (p.memberIds = list(n, (i) => PersonId.parse(`per_${String(i).padStart(8, "0")}`)))), MEMBERS_MAX);
    ok(ProjectDocSchema, project((p) => void (p.views = ["cards", "board", "timeline", "team", "focus", "brief"])));
    bad(ProjectDocSchema, project((p) => void (p.views = ["cards", "board", "timeline", "team", "focus", "brief", "cards"])));
    bad(ProjectDocSchema, project((p) => void (p.views = [])));
    ok(ProjectDocSchema, project((p) => void (p.blocks = [...schema.BLOCK_ORDER])));
    bad(ProjectDocSchema, project((p) => void (p.blocks = [...schema.BLOCK_ORDER, "header"])));
    bad(ProjectDocSchema, project((p) => void (p.blocks = ["header"])));
  });

  it("the brief", () => {
    const line = (i: number, text = "Preview on Friday") => ({ id: `brl_${String(i).padStart(8, "0")}` as never, audience: "client" as const, section: "next" as const, text });
    limit((n) => project((p) => void (p.brief.lines = list(n, (i) => line(i)))), BRIEF_LINES_MAX);
    limit((n) => project((p) => void (p.brief.lines = [line(0, x(n))])), BRIEF_TEXT_MAX);
    limit((n) => project((p) => void (p.brief.edits = { "client:head:status": { text: x(n), basis: "" } })), BRIEF_TEXT_MAX);
    limit((n) => project((p) => void (p.brief.edits = { "client:head:status": { text: "", basis: x(n) } })), BRIEF_BASIS);
    limit((n) => project((p) => void (p.brief.edits = { [`client:risks:${"a".repeat(n - "client:risks:".length)}`]: { text: "", basis: "" } })), BRIEF_EDIT_KEY);
    bad(ProjectDocSchema, project((p) => void (p.brief.edits = { "boss:head:status": { text: "", basis: "" } })));
    bad(ProjectDocSchema, project((p) => void (p.brief.edits = { "client:Head": { text: "", basis: "" } })));
    limit((n) => project((p) => void (p.brief.sent = list(n, (i) => ({ snapshotId: `snp_${String(i).padStart(8, "0")}` as never, audience: "client", sentAt: FIXTURE_NOW })))), BRIEF_SENT_MAX);
  });

  it("the moodboard", () => {
    const item = (o: Partial<MoodItem>) =>
      project((p) => void (p.moodboard.items = { ["mdi_item00000001" as never]: { id: "mdi_item00000001", kind: "note", x: 0, y: 0, w: 0.2, h: 0.1, r: 0, z: "a0", assetId: null, hex: null, text: "warm", ...o } as MoodItem }));
    ok(ProjectDocSchema, item({ x: 0, y: 20, w: 1, h: 3, r: 15 }));
    ok(ProjectDocSchema, item({ w: 0.04, h: 0.03, r: -15 }));
    for (const o of [{ x: 1.01 }, { x: -0.01 }, { y: 20.01 }, { w: 0.039 }, { w: 1.01 }, { h: 0.029 }, { h: 3.01 }, { r: 15.1 }, { r: -15.1 }]) bad(ProjectDocSchema, item(o));
    limit((n) => item({ text: x(n) }), MOOD_TEXT);
    ok(ProjectDocSchema, item({ kind: "color", hex: "#c65d3b" }));
    bad(ProjectDocSchema, item({ kind: "color", hex: "#C65D3B" }));
    bad(ProjectDocSchema, item({ kind: "color", hex: "#c65" }));
  });

  it("numbers: half days, progress, allocation, columns, capacity", () => {
    const ui = (o: Partial<ProjectDoc["tasks"][TaskId]>) => project((_, t) => void Object.assign(t("UI Design"), o));
    ok(ProjectDocSchema, ui({ estimateDays: 2.5 }));
    ok(ProjectDocSchema, ui({ estimateDays: 250 }));
    for (const estimateDays of [2.7, 250.5, -0.5]) bad(ProjectDocSchema, ui({ estimateDays }));
    for (const progress of [101, -1, 50.5]) bad(ProjectDocSchema, ui({ progress }));
    for (const allocation of [0.3, 0, 1.5]) bad(ProjectDocSchema, ui({ allocation: allocation as never }));
    bad(ProjectDocSchema, ui({ steps: [{ id: StepId.parse("stp_step0000000001"), title: "QA", done: false, ownerId: null, estimateDays: 0 }] }));
    bad(ProjectDocSchema, ui({ costCents: 10.5 }));
    bad(ProjectDocSchema, ui({ costCents: -1 }));
    ok(ProjectDocSchema, project((p) => void (p.viewConfig.columns = 4)));
    bad(ProjectDocSchema, project((p) => void (p.viewConfig.columns = 5)));
    bad(ProjectDocSchema, project((p) => void (p.viewConfig.columns = 0)));
    ok(WorkspaceDocSchema, workspace((w) => void (w.people[DEMO_PEOPLE.marta].capacityDaysPerWeek = 7)));
    for (const c of [7.5, 3.3, -0.5]) bad(WorkspaceDocSchema, workspace((w) => void (w.people[DEMO_PEOPLE.marta].capacityDaysPerWeek = c)));
  });

  it("ids, dates, timestamps and codes", () => {
    bad(ProjectDocSchema, project((p, t) => void (p.tasks = { ["t-ui" as TaskId]: t("UI Design") })));
    bad(ProjectDocSchema, project((_, t) => void (t("Development").dependsOn = ["per_demomarta" as TaskId])));
    bad(ProjectDocSchema, project((_, t) => void (t("UI Design").ownerId = "p-marta" as PersonId)));
    bad(ProjectDocSchema, project((p) => void (p.startDate = "2026-02-30" as never)));
    bad(ProjectDocSchema, project((p) => void (p.createdAt = "2026-10-14T11:00:00+02:00" as never)));
    bad(ProjectDocSchema, project((p) => void (p.currency = "eur")));
    bad(ProjectDocSchema, project((p) => void (p.client = { name: null, contactName: null, contactEmail: "not an email" })));
    bad(ProjectDocSchema, project((p) => void (p.links = [{ id: "lnk_link00000001" as never, label: "x", url: "javascript:alert(1)" }])));
    bad(WorkspaceDocSchema, workspace((w) => void (w.holidayPreset = "ITA")));
    bad(WorkspaceDocSchema, workspace((w) => void (w.timezone = "Mars/Olympus")));
    bad(WorkspaceDocSchema, workspace((w) => void (w.workingDays = [])));
    bad(WorkspaceDocSchema, workspace((w) => void (w.workingDays = [0, 1])));
  });
});

describe("proposals", () => {
  const ui = TaskId.parse("tsk_proposals00001");
  const base = { id: "prp_proposal000001", createdAt: FIXTURE_NOW, source: "agent" };
  const seed = (i: number) => ({
    taskId: `tsk_${String(i).padStart(8, "0")}`,
    title: "Copywriting",
    kind: "task",
    estimateDays: null,
    dependsOn: [],
    status: "todo",
    priority: "medium",
    progress: 0,
    ownerId: null,
    emphasis: false,
    steps: [],
  });
  const step = (i: number) => ({ stepId: `stp_${String(i).padStart(8, "0")}`, title: "Wireframes", estimateDays: 1.5 });
  const shift = (i: number) => ({ taskId: `tsk_${String(i).padStart(8, "0")}`, pinnedStart: "2026-10-19", days: 3, why: "Shift by 3 days" });

  it("parse every kind", () => {
    const all: Proposal[] = [
      { ...base, kind: "subtasks", taskId: ui, items: [step(0)] },
      {
        ...base,
        kind: "reassign",
        moves: [
          { type: "owner", taskId: ui, from: DEMO_PEOPLE.marta, to: DEMO_PEOPLE.sara, why: "Marta is 4d over capacity. Sara has room for its 6d." },
          { type: "shift", ...shift(1), why: "Shift Copywriting by 3 days: it has 5 days of float" },
        ],
      },
      { ...base, kind: "leveling", moves: [shift(0)] },
      { ...base, kind: "estimates", items: [{ taskId: ui, estimateDays: 2 }] },
      { ...base, kind: "plan", tasks: [seed(0)] },
    ] as Proposal[];
    for (const p of all) ok(ProposalSchema, p);
  });

  it("hold their limits", () => {
    const sized = (kind: string, key: string, n: number, f: (i: number) => unknown, extra = {}) => ({ ...base, kind, ...extra, [key]: list(n, f) });
    const cases: [string, string, number, (i: number) => unknown, object?][] = [
      ["subtasks", "items", PROPOSAL_ITEMS_MAX, step, { taskId: ui }],
      ["plan", "tasks", PROPOSAL_ITEMS_MAX, seed],
      ["leveling", "moves", PROPOSAL_BULK_MAX, shift],
      ["estimates", "items", PROPOSAL_BULK_MAX, (i) => ({ taskId: `tsk_${String(i).padStart(8, "0")}`, estimateDays: 1 })],
      ["reassign", "moves", PROPOSAL_ITEMS_MAX, (i) => ({ type: "owner", taskId: `tsk_${String(i).padStart(8, "0")}`, from: null, to: DEMO_PEOPLE.sara, why: "" })],
    ];
    for (const [kind, key, max, f, extra] of cases) {
      ok(ProposalSchema, sized(kind, key, max, f, extra));
      bad(ProposalSchema, sized(kind, key, max + 1, f, extra));
      bad(ProposalSchema, sized(kind, key, 0, f, extra));
    }
    bad(ProposalSchema, { ...base, kind: "leveling", moves: [{ ...shift(0), why: x(PROPOSAL_WHY + 1) }] });
    bad(ProposalSchema, { ...base, kind: "leveling", moves: [{ ...shift(0), days: 0 }] });
    bad(ProposalSchema, { ...base, kind: "leveling", moves: [{ ...shift(0), days: 251 }] });
    bad(ProposalSchema, { ...base, kind: "estimates", items: [{ taskId: ui, estimateDays: 0 }] });
    bad(ProposalSchema, { ...base, kind: "subtasks", taskId: ui, items: [step(0)], extra: true });
    bad(ProposalSchema, { ...base, kind: "unknown" });
  });
});

describe("templates", () => {
  const template = (tasks: unknown[]): unknown => ({ id: "tpl_template000001", name: "Website", kind: "website", tasks, createdAt: FIXTURE_NOW });
  const task = { title: "Discovery", kind: "task", estimateDays: null, dependsOn: [], steps: [], roleHint: null };

  it("hold 1–150 tasks", () => {
    ok(TemplateSchema, template(list(TEMPLATE_TASKS_MAX, () => task)));
    bad(TemplateSchema, template(list(TEMPLATE_TASKS_MAX + 1, () => task)));
    bad(TemplateSchema, template([]));
    bad(TemplateSchema, template([{ ...task, dependsOn: [-1] }]));
    bad(TemplateSchema, template([{ ...task, dependsOn: [0.5] }]));
  });

  it("live in the workspace", () => {
    ok(WorkspaceDocSchema, workspace((w) => void (w.templates = { ["tpl_template000001" as never]: template([task]) as Template })));
  });
});

describe("CommitSchema", () => {
  const commit = (o: object = {}) => ({
    id: randomUUID(),
    groupId: randomUUID(),
    docId: "prj_project00000001",
    baseVersion: 0,
    ops: [{ op: "updateTask" }],
    source: "direct",
    command: "Mark it done",
    createdAt: FIXTURE_NOW,
    actorId: null,
    ...o,
  });

  it("parses the wire shape", () => {
    ok(CommitSchema, commit());
    ok(CommitSchema, commit({ docId: "wsp_demoworkspace", command: null, source: "system" }));
    ok(CommitSchema, commit({ ops: list(COMMIT_OPS_MAX, () => ({})) }));
  });

  it("rejects what the wire never carries", () => {
    bad(CommitSchema, commit({ ops: [] }));
    bad(CommitSchema, commit({ ops: list(COMMIT_OPS_MAX + 1, () => ({})) }));
    bad(CommitSchema, commit({ command: x(COMMAND_TEXT + 1) }));
    bad(CommitSchema, commit({ id: "commit-1" }));
    bad(CommitSchema, commit({ docId: "tsk_task0000000001" }));
    bad(CommitSchema, commit({ baseVersion: -1 }));
    bad(CommitSchema, commit({ source: "parser" }));
    bad(CommitSchema, commit({ local: [] }));
  });
});

describe("DemoEnvelopeSchema", () => {
  const envelope = (): DemoEnvelope => {
    const state = demoState();
    return {
      schemaVersion: 2,
      workspace: state.workspace,
      projects: state.projects,
      activeProjectId: state.projectId,
      lastView: "cards",
      changes: 3,
      notices: { weekendsPending: true },
      assetAliases: { ["ast_image0000000001" as never]: "img-k3j2h1" },
      migratedFrom: "v0-main",
    };
  };

  it("parses a save", () => {
    ok(DemoEnvelopeSchema, envelope());
    ok(DemoEnvelopeSchema, { ...envelope(), projects: {}, activeProjectId: null, lastView: null, migratedFrom: null, assetAliases: {} });
  });

  it("is strict and validates the documents inside", () => {
    bad(DemoEnvelopeSchema, { ...envelope(), log: [] });
    bad(DemoEnvelopeSchema, { ...envelope(), changes: -1 });
    bad(DemoEnvelopeSchema, { ...envelope(), migratedFrom: "v1" });
    bad(DemoEnvelopeSchema, { ...envelope(), assetAliases: { "img-1": "img-1" } });
    const broken = envelope();
    Object.values(broken.projects)[0].title = "";
    bad(DemoEnvelopeSchema, broken);
  });
});
