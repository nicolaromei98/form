// Every invariant of plan §3.8 is caught by checkProject or checkWorkspace on a hand-built broken
// document; each case starts from a valid fixture and breaks exactly one thing.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  checkProject,
  checkTemplateTasks,
  checkWorkspace,
  derivedCost,
  docBytes,
  resolveOwner,
  resolvePerson,
  utf8Length,
  type Violation,
  type ViolationCode,
} from "@/lib/domain/invariants/check";
import { DOC_BYTES_MAX, MOOD_MAX, TASKS_MAX } from "@/lib/domain/limits";
import { nKeys } from "@/lib/domain/order";
import {
  AssetId,
  type ClosureId,
  IsoDate,
  type MoodItem,
  type MoodItemId,
  PersonId,
  ProjectDocSchema,
  type ProjectDoc,
  type ProjectId,
  type Proposal,
  StepId,
  type Task,
  TaskId,
  type Template,
  TemplateId,
  type TimeOffId,
  WorkspaceDocSchema,
  type WorkspaceDoc,
} from "@/lib/domain/schema";
import {
  activeProject,
  byId,
  DEMO_PEOPLE,
  demoState,
  FIXTURE_NOW,
  generated,
  indexEntry,
  makePerson,
  makeTask,
  taskByTitle,
} from "../../../../test/fixtures/v2/build";

const codes = (violations: Violation[]) => [...new Set(violations.map((v) => v.code))].sort();

/** The demo project, freshly built, with its tasks by title */
function demo() {
  const project = activeProject(demoState());
  const t = (title: string) => taskByTitle(project, title);
  return { project, t, research: t("Research"), visual: t("Visual Direction"), ui: t("UI Design"), dev: t("Development") };
}

/** Breaks a fresh demo project and returns the violation codes */
function broken(edit: (d: ReturnType<typeof demo>) => void): ViolationCode[] {
  const d = demo();
  expect(checkProject(d.project)).toEqual([]);
  edit(d);
  // Still schema-valid: only the invariant is broken
  const parsed = ProjectDocSchema.safeParse(d.project);
  expect(parsed.success, parsed.error?.message).toBe(true);
  return codes(checkProject(d.project));
}

const step = (id: string, title = "QA pass") => ({ id: StepId.parse(id), title, done: false, ownerId: null, estimateDays: null });
const link = (id: string) => ({ id: id as never, label: "Figma", url: "https://www.figma.com/file/form" });
const mood = (id: string, z: string, o: Partial<MoodItem> = {}): MoodItem => ({
  id: id as MoodItemId,
  kind: "note",
  x: 0.03,
  y: 0.03,
  w: 0.22,
  h: 0.12,
  r: 0,
  z,
  assetId: null,
  hex: null,
  text: "warm",
  ...o,
});
const proposal = (p: Record<string, unknown>) => ({ id: "prp_proposal000001", createdAt: FIXTURE_NOW, source: "parser", ...p }) as Proposal;
const seed = (taskId: string, o: Record<string, unknown> = {}) => ({
  taskId: TaskId.parse(taskId),
  title: "Copywriting",
  kind: "task" as const,
  estimateDays: null,
  dependsOn: [] as TaskId[],
  status: "todo" as const,
  priority: "medium" as const,
  progress: 0,
  ownerId: null,
  emphasis: false,
  steps: [] as { stepId: StepId; title: string; estimateDays: null }[],
  ...o,
});

describe("checkProject", () => {
  it("passes the valid fixtures", () => {
    expect(checkProject(demo().project)).toEqual([]);
    expect(checkProject(activeProject(generated(150)))).toEqual([]);
  });

  it("P1: record keys equal ids", () => {
    expect(
      broken(({ project, dev }) => {
        delete project.tasks[dev.id];
        project.tasks[TaskId.parse("tsk_elsewhere000001")] = dev;
      }),
    ).toEqual(["record_key"]);
    expect(
      broken(({ project }) => {
        project.moodboard.items["mdi_keyed0000000001" as MoodItemId] = mood("mdi_other0000000001", "a0");
      }),
    ).toEqual(["record_key"]);
    expect(
      broken(({ project }) => {
        const closure = { id: "cls_closure00000001" as ClosureId, from: IsoDate.parse("2026-12-24"), to: IsoDate.parse("2027-01-06"), label: "Holidays" };
        project.calendarOverride = { workingDays: null, closures: { ["cls_closure00000002" as ClosureId]: closure } };
      }),
    ).toEqual(["record_key"]);
  });

  it("P1: at most 500 tasks and 200 mood items", () => {
    const tasks = activeProject(generated(TASKS_MAX + 1, { stepsPerTask: 0 }));
    expect(codes(checkProject(tasks))).toEqual(["too_many"]);
    expect(checkProject(activeProject(generated(TASKS_MAX, { stepsPerTask: 0 })))).toEqual([]);
    const items = activeProject(generated(4, { moodItems: MOOD_MAX + 1 }));
    expect(codes(checkProject(items))).toEqual(["too_many"]);
  });

  it("P2: order keys are unique among tasks, z keys among mood items", () => {
    expect(broken(({ dev, ui }) => void (dev.order = ui.order))).toEqual(["duplicate_order"]);
    expect(
      broken(({ project }) => {
        project.moodboard.items = byId([mood("mdi_note00000000001", "a0"), mood("mdi_note00000000002", "a0")]);
      }),
    ).toEqual(["duplicate_z"]);
  });

  it("P3: step, brief line and link ids are unique", () => {
    expect(
      broken(({ ui, dev }) => {
        ui.steps = [step("stp_shared000000001")];
        dev.steps = [step("stp_shared000000001")];
      }),
    ).toEqual(["duplicate_id"]);
    expect(
      broken(({ project }) => {
        const line = { id: "brl_line00000000001" as never, audience: "client" as const, section: "next" as const, text: "Preview on Friday" };
        project.brief.lines = [line, { ...line, audience: "team" }];
      }),
    ).toEqual(["duplicate_id"]);
    expect(
      broken(({ project, ui }) => {
        project.links = [link("lnk_figma0000000001")];
        ui.links = [link("lnk_figma0000000001")];
      }),
    ).toEqual(["duplicate_id"]);
  });

  it("P3: ids inside a proposal are unique, and the ids it would create are fresh", () => {
    expect(
      broken(({ project, ui }) => {
        project.proposal = proposal({
          kind: "subtasks",
          taskId: ui.id,
          items: [
            { stepId: "stp_proposed0000001", title: "Wireframes", estimateDays: null },
            { stepId: "stp_proposed0000001", title: "Mockups", estimateDays: null },
          ],
        });
      }),
    ).toEqual(["duplicate_id"]);
    expect(
      broken(({ project, ui, dev }) => {
        dev.steps = [step("stp_existing0000001")];
        project.proposal = proposal({ kind: "subtasks", taskId: ui.id, items: [{ stepId: "stp_existing0000001", title: "Wireframes", estimateDays: null }] });
      }),
    ).toEqual(["id_taken"]);
    expect(
      broken(({ project, dev }) => {
        project.proposal = proposal({ kind: "plan", tasks: [seed(dev.id)] });
      }),
    ).toEqual(["id_taken"]);
    expect(
      broken(({ project, ui }) => {
        ui.steps = [step("stp_existing0000001")];
        project.proposal = proposal({
          kind: "plan",
          tasks: [seed("tsk_planned00000001", { steps: [{ stepId: "stp_existing0000001", title: "Draft", estimateDays: null }] })],
        });
      }),
    ).toEqual(["id_taken"]);
    expect(
      broken(({ project, ui }) => {
        const move = { type: "owner", taskId: ui.id, from: DEMO_PEOPLE.marta, to: DEMO_PEOPLE.sara, why: "" };
        project.proposal = proposal({ kind: "reassign", moves: [move, { ...move, to: DEMO_PEOPLE.luca }] });
      }),
    ).toEqual(["duplicate_id"]);
  });

  it("P4: dependencies exist, are unique, never self, never loop", () => {
    expect(broken(({ dev }) => void dev.dependsOn.push(TaskId.parse("tsk_missing00000001")))).toEqual(["missing_dependency"]);
    expect(broken(({ dev, ui }) => void (dev.dependsOn = [ui.id, ui.id]))).toEqual(["duplicate_dependency"]);
    expect(broken(({ dev }) => void dev.dependsOn.push(dev.id))).toEqual(["cycle", "self_dependency"]);
    expect(broken(({ research, dev }) => void research.dependsOn.push(dev.id))).toEqual(["cycle"]);
  });

  it("P5: status and progress agree", () => {
    const at = (status: Task["status"], progress: number, requireReview = false) =>
      broken(({ project, ui }) => {
        project.requireReview = requireReview;
        ui.status = status;
        ui.progress = progress;
      });
    expect(at("done", 40)).toEqual(["status_progress"]);
    expect(at("todo", 30)).toEqual(["status_progress"]);
    expect(at("active", 100)).toEqual(["status_progress"]);
    expect(at("review", 100)).toEqual(["status_progress"]);
    expect(at("review", 100, true)).toEqual([]);
    expect(broken(({ ui }) => void (ui.completedAt = FIXTURE_NOW))).toEqual(["status_progress"]);
  });

  it("P6: milestones take no time and have no steps; a task's estimate is null or at least half a day", () => {
    const milestone = (edit: (t: Task) => void) =>
      broken(({ dev }) => {
        Object.assign(dev, { kind: "milestone", estimateDays: 0, status: "todo", progress: 0, allocation: 1, steps: [] });
        edit(dev);
      });
    expect(milestone(() => {})).toEqual([]);
    expect(milestone((t) => void (t.estimateDays = 3))).toEqual(["milestone"]);
    expect(milestone((t) => void (t.estimateDays = null))).toEqual(["milestone"]);
    expect(milestone((t) => void (t.steps = [step("stp_milestone000001")]))).toEqual(["milestone"]);
    expect(milestone((t) => void (t.allocation = 0.5))).toEqual(["milestone"]);
    expect(milestone((t) => Object.assign(t, { status: "active", progress: 30 }))).toEqual(["milestone"]);
    expect(broken(({ dev }) => void (dev.estimateDays = 0))).toEqual(["estimate"]);
  });

  it("P7: views and blocks are unique; blocks follow BLOCK_ORDER and keep header and collection", () => {
    expect(broken(({ project }) => void (project.views = ["cards", "board", "cards"]))).toEqual(["duplicate_view"]);
    expect(broken(({ project }) => void (project.blocks = ["header", "metrics", "metrics", "collection"]))).toEqual(["duplicate_block"]);
    expect(broken(({ project }) => void (project.blocks = ["header", "collection", "metrics"]))).toEqual(["block_order"]);
    expect(broken(({ project }) => void (project.blocks = ["header", "metrics"]))).toEqual(["missing_block"]);
    expect(broken(({ project }) => void (project.blocks = ["metrics", "collection"]))).toEqual(["missing_block"]);
  });

  it("P8: the focus pin names a task", () => {
    expect(broken(({ project, ui }) => void (project.viewConfig.focusPin = ui.id))).toEqual([]);
    expect(broken(({ project }) => void (project.viewConfig.focusPin = TaskId.parse("tsk_gone0000000001")))).toEqual(["focus_pin"]);
  });

  it("P9: proposal targets exist; steps and estimates go to tasks", () => {
    const missing = TaskId.parse("tsk_gone0000000001");
    const items = [{ stepId: "stp_proposed0000001", title: "Wireframes", estimateDays: null }];
    expect(broken(({ project, ui }) => void (project.proposal = proposal({ kind: "subtasks", taskId: ui.id, items })))).toEqual([]);
    expect(broken(({ project }) => void (project.proposal = proposal({ kind: "subtasks", taskId: missing, items })))).toEqual(["proposal_target"]);
    expect(
      broken(({ project, dev }) => {
        Object.assign(dev, { kind: "milestone", estimateDays: 0 });
        project.proposal = proposal({ kind: "subtasks", taskId: dev.id, items });
      }),
    ).toEqual(["proposal_target"]);
    const move = { type: "owner", taskId: missing, from: null, to: DEMO_PEOPLE.sara, why: "" };
    expect(broken(({ project }) => void (project.proposal = proposal({ kind: "reassign", moves: [move] })))).toEqual(["proposal_target"]);
    const shift = { taskId: missing, pinnedStart: "2026-10-19", days: 3, why: "" };
    expect(broken(({ project }) => void (project.proposal = proposal({ kind: "leveling", moves: [shift] })))).toEqual(["proposal_target"]);
    expect(
      broken(({ project }) => void (project.proposal = proposal({ kind: "estimates", items: [{ taskId: missing, estimateDays: 2 }] }))),
    ).toEqual(["proposal_target"]);
    expect(
      broken(({ project, dev }) => {
        Object.assign(dev, { kind: "milestone", estimateDays: 0 });
        project.proposal = proposal({ kind: "estimates", items: [{ taskId: dev.id, estimateDays: 2 }] });
      }),
    ).toEqual(["proposal_target"]);
    // A seed waits on an earlier seed or an existing task, never a later seed or a missing one
    const a = "tsk_planned00000001";
    const b = "tsk_planned00000002";
    expect(broken(({ project, dev }) => void (project.proposal = proposal({ kind: "plan", tasks: [seed(a, { dependsOn: [dev.id] }), seed(b, { dependsOn: [a] })] })))).toEqual([]);
    expect(broken(({ project }) => void (project.proposal = proposal({ kind: "plan", tasks: [seed(a, { dependsOn: [b] }), seed(b)] })))).toEqual([
      "proposal_target",
    ]);
    expect(broken(({ project }) => void (project.proposal = proposal({ kind: "plan", tasks: [seed(a, { dependsOn: [missing] })] })))).toEqual([
      "proposal_target",
    ]);
  });

  it("P10: mood items carry their content and stay on the board", () => {
    const item = (o: Partial<MoodItem>) =>
      broken(({ project }) => void (project.moodboard.items = byId([mood("mdi_item00000000001", "a0", o)])));
    expect(item({})).toEqual([]);
    expect(item({ kind: "image", assetId: AssetId.parse("ast_image0000000001") })).toEqual([]);
    expect(item({ kind: "image" })).toEqual(["mood_item"]);
    expect(item({ kind: "color" })).toEqual(["mood_item"]);
    expect(item({ kind: "color", hex: "#c65d3b" })).toEqual([]);
    expect(item({ text: null })).toEqual(["mood_item"]);
    expect(item({ x: 0.8, w: 0.3 })).toEqual(["mood_item"]);
    expect(item({ x: 0.7, w: 0.3 })).toEqual([]);
  });

  it("P11: members and tags hold no duplicates", () => {
    expect(broken(({ project }) => void project.memberIds.push(DEMO_PEOPLE.marta))).toEqual(["duplicate_member"]);
    expect(broken(({ project }) => void (project.tags = ["client", "client"]))).toEqual(["duplicate_tag"]);
    expect(broken(({ ui }) => void (ui.tags = ["design", "design"]))).toEqual(["duplicate_tag"]);
  });

  it("P12: the start comes before the deadline; the calendar override is well-formed", () => {
    expect(broken(({ project }) => void (project.deadline = IsoDate.parse("2026-09-28")))).toEqual([]);
    expect(broken(({ project }) => void (project.deadline = IsoDate.parse("2026-09-27")))).toEqual(["date_order"]);
    expect(broken(({ project }) => void (project.calendarOverride = { workingDays: [1, 2, 3, 4], closures: null }))).toEqual([]);
    expect(broken(({ project }) => void (project.calendarOverride = { workingDays: [2, 1], closures: null }))).toEqual(["working_days"]);
    expect(broken(({ project }) => void (project.calendarOverride = { workingDays: [1, 1, 2], closures: null }))).toEqual(["working_days"]);
    expect(
      broken(({ project }) => {
        const closure = { id: "cls_closure00000001" as ClosureId, from: IsoDate.parse("2027-01-06"), to: IsoDate.parse("2026-12-24"), label: "Holidays" };
        project.calendarOverride = { workingDays: null, closures: byId([closure]) };
      }),
    ).toEqual(["range_order"]);
  });

  it("P13: a document holds at most 1,000,000 bytes of JSON", () => {
    const big = activeProject(generated(220, { stepsPerTask: 0 }));
    for (const t of Object.values(big.tasks)) t.description = "é".repeat(2500); // 5,000 bytes each
    expect(ProjectDocSchema.safeParse(big).success).toBe(true);
    expect(docBytes(big)).toBeGreaterThan(DOC_BYTES_MAX);
    expect(codes(checkProject(big))).toEqual(["doc_size"]);
  });

  it("reports in an order that never depends on record key order", () => {
    const d = demo();
    d.dev.order = d.ui.order;
    d.research.dependsOn.push(d.dev.id);
    d.ui.status = "done";
    const reversed: ProjectDoc = { ...d.project, tasks: Object.fromEntries(Object.entries(d.project.tasks).reverse()) as ProjectDoc["tasks"] };
    expect(checkProject(reversed)).toEqual(checkProject(d.project));
  });
});

describe("checkWorkspace", () => {
  const ws = () => demoState().workspace;
  const brokenWs = (edit: (w: WorkspaceDoc) => void): ViolationCode[] => {
    const w = ws();
    expect(checkWorkspace(w)).toEqual([]);
    edit(w);
    const parsed = WorkspaceDocSchema.safeParse(w);
    expect(parsed.success, parsed.error?.message).toBe(true);
    return codes(checkWorkspace(w));
  };
  const day = (s: string) => IsoDate.parse(s);
  const template = (id: string, tasks: Template["tasks"]): Template => ({ id: TemplateId.parse(id), name: "Website", kind: "website", tasks, createdAt: FIXTURE_NOW });
  const ttask = (o: Partial<Template["tasks"][number]> = {}): Template["tasks"][number] => ({
    title: "Discovery",
    kind: "task",
    estimateDays: null,
    dependsOn: [],
    steps: [],
    roleHint: null,
    ...o,
  });
  const nPeople = (n: number) => {
    const keys = nKeys(n);
    return byId(Array.from({ length: n }, (_, i) => makePerson({ id: PersonId.parse(`per_person${String(i).padStart(6, "0")}`), name: `Person ${i}`, order: keys[i] })));
  };

  it("W1: record keys equal ids", () => {
    expect(
      brokenWs((w) => {
        const marta = w.people[DEMO_PEOPLE.marta];
        delete w.people[DEMO_PEOPLE.marta];
        w.people[PersonId.parse("per_elsewhere00001")] = marta;
      }),
    ).toEqual(["record_key"]);
    expect(
      brokenWs((w) => {
        const off = { id: "off_timeoff00000001" as TimeOffId, from: day("2026-11-02"), to: day("2026-11-06"), label: null };
        w.people[DEMO_PEOPLE.marta].timeOff = { ["off_timeoff00000002" as TimeOffId]: off };
      }),
    ).toEqual(["record_key"]);
    expect(brokenWs((w) => void (w.templates = { [TemplateId.parse("tpl_template000002")]: template("tpl_template000001", [ttask()]) }))).toEqual([
      "record_key",
    ]);
    expect(
      brokenWs((w) => {
        w.closures = { ["cls_closure00000002" as ClosureId]: { id: "cls_closure00000001" as ClosureId, from: day("2026-12-24"), to: day("2027-01-06"), label: "Holidays" } };
      }),
    ).toEqual(["record_key"]);
    expect(brokenWs((w) => void (w.projects = { ["prj_project00000002" as ProjectId]: indexEntry("prj_project00000001" as ProjectId) }))).toEqual(["record_key"]);
  });

  it("W1: at most 100 people, 50 templates, 200 closures, 100 time-off entries each and 500 projects", () => {
    expect(brokenWs((w) => void (w.people = nPeople(100)))).toEqual([]);
    expect(brokenWs((w) => void (w.people = nPeople(101)))).toEqual(["too_many"]);
    const templates = (n: number) => byId(Array.from({ length: n }, (_, i) => template(`tpl_template${String(i).padStart(6, "0")}`, [ttask()])));
    expect(brokenWs((w) => void (w.templates = templates(51)))).toEqual(["too_many"]);
    const ranges = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `${String(i).padStart(8, "0")}`, from: day("2027-01-01"), to: day("2027-01-02") }));
    expect(
      brokenWs((w) => void (w.closures = byId(ranges(201).map((r) => ({ ...r, id: `cls_${r.id}` as ClosureId, label: "Closed" }))))),
    ).toEqual(["too_many"]);
    expect(
      brokenWs((w) => void (w.people[DEMO_PEOPLE.luca].timeOff = byId(ranges(101).map((r) => ({ ...r, id: `off_${r.id}` as TimeOffId, label: null }))))),
    ).toEqual(["too_many"]);
    expect(
      brokenWs((w) => void (w.projects = byId(Array.from({ length: 501 }, (_, i) => indexEntry(`prj_${String(i).padStart(8, "0")}` as ProjectId))))),
    ).toEqual(["too_many"]);
  });

  it("W2: active names are unique, case-insensitive; one person per account", () => {
    expect(brokenWs((w) => void (w.people[DEMO_PEOPLE.sara].name = "marta"))).toEqual(["duplicate_name"]);
    expect(
      brokenWs((w) => {
        w.people[DEMO_PEOPLE.sara].name = "Marta";
        w.people[DEMO_PEOPLE.sara].archived = true;
      }),
    ).toEqual([]);
    expect(
      brokenWs((w) => {
        w.people[DEMO_PEOPLE.sara].userId = "user_1";
        w.people[DEMO_PEOPLE.luca].userId = "user_1";
      }),
    ).toEqual(["duplicate_user"]);
  });

  it("W3: person order keys are unique, working days sorted and unique, ranges forwards", () => {
    expect(brokenWs((w) => void (w.people[DEMO_PEOPLE.luca].order = w.people[DEMO_PEOPLE.marta].order))).toEqual(["duplicate_order"]);
    expect(brokenWs((w) => void (w.workingDays = [1, 3, 2]))).toEqual(["working_days"]);
    expect(brokenWs((w) => void (w.workingDays = [1, 1, 2]))).toEqual(["working_days"]);
    expect(
      brokenWs((w) => {
        w.closures = byId([{ id: "cls_closure00000001" as ClosureId, from: day("2027-01-06"), to: day("2026-12-24"), label: "Holidays" }]);
      }),
    ).toEqual(["range_order"]);
    expect(
      brokenWs((w) => {
        w.people[DEMO_PEOPLE.marta].timeOff = byId([{ id: "off_timeoff00000001" as TimeOffId, from: day("2026-11-06"), to: day("2026-11-02"), label: null }]);
      }),
    ).toEqual(["range_order"]);
  });

  it("W4: template tasks depend only on earlier tasks; milestones take no time", () => {
    const withTemplate = (tasks: Template["tasks"]) => brokenWs((w) => void (w.templates = byId([template("tpl_template000001", tasks)])));
    expect(withTemplate([ttask(), ttask({ dependsOn: [0] }), ttask({ kind: "milestone", estimateDays: 0, dependsOn: [0, 1] })])).toEqual([]);
    expect(withTemplate([ttask({ dependsOn: [0] })])).toEqual(["template_dependency"]);
    expect(withTemplate([ttask(), ttask({ dependsOn: [2] }), ttask()])).toEqual(["template_dependency"]);
    expect(withTemplate([ttask(), ttask({ dependsOn: [0, 0] })])).toEqual(["duplicate_dependency"]);
    expect(withTemplate([ttask({ kind: "milestone", estimateDays: 3 })])).toEqual(["milestone"]);
    expect(withTemplate([ttask({ kind: "milestone", estimateDays: null })])).toEqual(["milestone"]);
    expect(withTemplate([ttask({ kind: "milestone", estimateDays: 0, steps: ["Check"] })])).toEqual(["milestone"]);
    expect(withTemplate([ttask({ estimateDays: 0 })])).toEqual(["estimate"]);
    expect(codes(checkTemplateTasks({ tasks: [ttask({ dependsOn: [0] })] }))).toEqual(["template_dependency"]);
  });

  it("holds at most 1,000,000 bytes of JSON", () => {
    const tasks = Array.from({ length: 150 }, () => ttask({ title: "x".repeat(140) }));
    expect(
      brokenWs((w) => void (w.templates = byId(Array.from({ length: 50 }, (_, i) => template(`tpl_template${String(i).padStart(6, "0")}`, tasks))))),
    ).toEqual(["doc_size"]);
  });
});

describe("across documents, at read time (Q7)", () => {
  const { workspace } = demoState();
  const ws = structuredClone(workspace);
  ws.people[DEMO_PEOPLE.luca].archived = true;
  ws.people[DEMO_PEOPLE.sara].dayRateCents = 40_000;
  const missing = PersonId.parse("per_missing0000001");

  it("resolves people as themselves, archived or missing", () => {
    expect(resolvePerson(DEMO_PEOPLE.marta, ws)).toBe(ws.people[DEMO_PEOPLE.marta]);
    expect(resolvePerson(DEMO_PEOPLE.luca, ws)).toBe("archived");
    expect(resolvePerson(missing, ws)).toBe("missing");
    expect(resolveOwner(null, ws)).toBeNull();
    expect(resolveOwner(DEMO_PEOPLE.luca, ws)).toBe("archived");
  });

  it("derives a cost from the owner's day rate, never over a manual cost", () => {
    const task = (o: Partial<Task>) => makeTask({ id: TaskId.parse("tsk_cost00000000001"), title: "UI Design", order: "a0", ...o });
    expect(derivedCost(task({ estimateDays: 6, ownerId: DEMO_PEOPLE.sara }), ws)).toBe(240_000);
    expect(derivedCost(task({ estimateDays: 2.5, ownerId: DEMO_PEOPLE.sara }), { people: { [DEMO_PEOPLE.sara]: { ...ws.people[DEMO_PEOPLE.sara], dayRateCents: 33_333 } } })).toBe(83_333);
    expect(derivedCost(task({ estimateDays: 6, ownerId: DEMO_PEOPLE.sara, costCents: 100_000 }), ws)).toBeNull();
    expect(derivedCost(task({ estimateDays: null, ownerId: DEMO_PEOPLE.sara }), ws)).toBeNull();
    expect(derivedCost(task({ estimateDays: 6, ownerId: DEMO_PEOPLE.marta }), ws)).toBeNull();
    expect(derivedCost(task({ estimateDays: 6, ownerId: DEMO_PEOPLE.luca }), { people: { [DEMO_PEOPLE.luca]: { ...ws.people[DEMO_PEOPLE.luca], dayRateCents: 50_000 } } })).toBeNull();
    expect(derivedCost(task({ estimateDays: 6, ownerId: missing }), ws)).toBeNull();
    expect(derivedCost(task({ estimateDays: 6, ownerId: null }), ws)).toBeNull();
  });
});

describe("docBytes", () => {
  it("counts UTF-8 bytes like Node's Buffer", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (s) => {
        expect(utf8Length(s)).toBe(Buffer.byteLength(s, "utf8"));
      }),
    );
    expect(utf8Length("é€😀")).toBe(2 + 3 + 4);
  });

  it("measures a document's JSON", () => {
    const project = activeProject(demoState());
    expect(docBytes(project)).toBe(Buffer.byteLength(JSON.stringify(project), "utf8"));
    project.title = "Caffè ☕ · 新しい";
    expect(docBytes(project)).toBe(Buffer.byteLength(JSON.stringify(project), "utf8"));
  });
});
