// The v0 → v2 migration case by case (plan §7, §10.6): what each fixture becomes and what the
// report says about it, the template's working-day calendar, readV0 and the storage spy, import
// mode (Q4), the salvage rules, brief key rewriting and the schema upgrade chain.
import { describe, expect, it } from "vitest";
import { isoWeekday } from "@/lib/domain/dates";
import { seededMinter } from "@/lib/domain/ids";
import { nKeys, sortedByOrder, sortedByZ } from "@/lib/domain/order";
import { defaultViewConfig, type PersonId, type ProjectDoc, type Task, type TaskId } from "@/lib/domain/schema";
import { SAMPLE_PEOPLE, SAMPLE_PERSON_IDS } from "@/lib/demo/sample";
import {
  assetAliases,
  CURRENT_SCHEMA,
  detectV0,
  type MigrateV0Options,
  type MigrateV0Result,
  migrateV0,
  readV0,
  rewriteBriefKey,
  UpgradeError,
  upgradeProjectDoc,
  upgradeWorkspaceDoc,
  V0_BACKUP_KEY,
  V0_KEY,
} from "@/lib/migrate";
import { planProject } from "@/lib/planning";
import { activeProject, demoState, FIXTURE_NOW, FIXTURE_TODAY, makePerson } from "../../../../test/fixtures/v2/build";
import { demoOptions, importOptions, MANIFEST, mergedWorkspace, problemsOf, readFixture, readFixtureInput, spyStorage, storageOf } from "./support";

/* ------------------------------------------------------------------
   Helpers
   ------------------------------------------------------------------ */

function entry(name: string) {
  const e = MANIFEST.find((m) => m.name === name);
  if (!e) throw new Error(`No v0 fixture ${name}`);
  return e;
}

/** A fixture through readV0 and migrateV0, checked valid */
function migrate(name: string, o: MigrateV0Options = demoOptions()): MigrateV0Result {
  const input = readFixtureInput(entry(name))!;
  const result = migrateV0(input.raw, { ...o, source: input.source });
  expect(problemsOf(result, o.workspace)).toEqual([]);
  return result;
}

/** A fixture's v0 document, to perturb */
function v0Doc(name: string): Record<string, unknown> {
  return structuredClone((readFixture(name) as { state: { doc: Record<string, unknown> } }).state.doc);
}

/** A perturbed v0 document through migrateV0, checked valid */
function migrateDoc(doc: unknown, o: MigrateV0Options = demoOptions()): MigrateV0Result {
  const result = migrateV0(doc, o);
  expect(problemsOf(result, o.workspace)).toEqual([]);
  return result;
}

const projectOf = (r: MigrateV0Result): ProjectDoc => {
  if (!r.project) throw new Error("No project");
  return r.project;
};
const inOrder = (r: MigrateV0Result): Task[] => sortedByOrder(projectOf(r).tasks);
const titled = (r: MigrateV0Result, title: string): Task => {
  const t = Object.values(projectOf(r).tasks).find((x) => x.title === title);
  if (!t) throw new Error(`No task ${title}`);
  return t;
};
const v0Tasks = (doc: Record<string, unknown>) => doc.tasks as Record<string, Record<string, unknown>>;

/* ------------------------------------------------------------------
   The template
   ------------------------------------------------------------------ */

describe("the template as created (docTracker)", () => {
  const result = migrate("docTracker");
  const project = projectOf(result);

  it("maps the sample team to the demo people, with weekly capacities 2/4/5", () => {
    expect(result.people.map((p) => [p.id, p.name, p.role, p.capacityDaysPerWeek])).toEqual(
      SAMPLE_PEOPLE.map((p) => [p.id, p.name, p.role, p.capacityDaysPerWeek]),
    );
    for (const p of result.people) expect(p).toMatchObject({ email: null, userId: null, dayRateCents: null, timeOff: {}, archived: false, createdAt: FIXTURE_NOW });
    expect(result.report.capacityUnknown).toEqual([]);
    expect(project.memberIds).toEqual(SAMPLE_PEOPLE.map((p) => p.id));
  });

  it("keeps the project as v0 had it, with the plan §7.2 defaults", () => {
    expect(project).toMatchObject({
      schemaVersion: 2,
      docType: "project",
      workspaceId: "wsp_demoworkspace",
      title: "New website",
      kind: "website",
      status: "active",
      startDate: "2026-09-28",
      startConfirmed: false,
      deadline: null,
      deadlineKind: "soft",
      currency: "EUR",
      budgetCents: null,
      client: null,
      goal: null,
      leadId: null,
      requireReview: false,
      autoChain: true,
      calendarOverride: null,
      links: [],
      tags: [],
      views: ["cards"],
      blocks: ["header", "metrics", "collection"],
      proposal: null,
      createdAt: FIXTURE_NOW,
    });
    expect(project.viewConfig).toEqual(defaultViewConfig());
    expect(project.brief).toEqual({ edits: {}, lines: [], sent: [], sharing: { showBudgetToClient: false } });
    expect(result.local).toEqual({ activeView: "cards" });
  });

  it("chains the tasks in workflow order, estimates read as working days", () => {
    const tasks = inOrder(result);
    expect(tasks.map((t) => [t.title, t.status, t.priority, t.progress, t.estimateDays])).toEqual([
      ["Research", "done", "low", 100, 3],
      ["Visual Direction", "review", "high", 85, 4],
      ["UI Design", "active", "urgent", 30, 6],
      ["Development", "todo", "medium", 0, 8],
    ]);
    expect(tasks.map((t) => t.dependsOn)).toEqual([[], [tasks[0].id], [tasks[1].id], [tasks[2].id]]);
    expect(tasks.map((t) => t.ownerId)).toEqual([SAMPLE_PERSON_IDS.sara, SAMPLE_PERSON_IDS.marta, SAMPLE_PERSON_IDS.marta, SAMPLE_PERSON_IDS.luca]);
    for (const t of tasks) {
      expect(t).toMatchObject({ kind: "task", allocation: 1, completedAt: null, createdAt: FIXTURE_NOW, costCents: null, steps: [], emphasis: false });
    }
  });

  it("reports nothing but the weekends notice, the sample data and the change count", () => {
    expect(result.report).toEqual({
      source: "main",
      salvaged: [],
      dropped: [],
      promoted: 0,
      repaired: [],
      notices: ["weekendsNow"],
      sample: { team: true, start: true },
      assets: { referenced: [] },
      capacityUnknown: [],
      changes: 1,
    });
  });

  it("schedules on working days: 28–30 Sep, 1–6 Oct, 7–14 Oct, 15–26 Oct (plan §10.6)", () => {
    const ws = mergedWorkspace(result, demoOptions().workspace);
    const plan = planProject(project, ws, FIXTURE_TODAY);
    const spans = inOrder(result).map((t) => {
      const timing = plan.schedule.timings.get(t.id);
      if (timing?.kind !== "scheduled") throw new Error(`${t.title} isn't scheduled`);
      return { title: t.title, start: timing.start!, end: timing.end!, duration: timing.duration, estimate: t.estimateDays };
    });
    expect(spans.map((s) => [s.title, s.start, s.end])).toEqual([
      ["Research", "2026-09-28", "2026-09-30"],
      ["Visual Direction", "2026-10-01", "2026-10-06"],
      ["UI Design", "2026-10-07", "2026-10-14"],
      ["Development", "2026-10-15", "2026-10-26"],
    ]);
    // No weekend day inside any task: it starts and ends on a weekday, and counts only its estimate in working days
    for (const s of spans) {
      expect(isoWeekday(s.start)).toBeLessThanOrEqual(5);
      expect(isoWeekday(s.end)).toBeLessThanOrEqual(5);
      expect(s.duration).toBe(s.estimate);
    }
    expect(plan.schedule.anchor.mode).toBe("provisional");
    expect(result.report.notices).toContain("weekendsNow");
  });

  it("gives the same project as the demo with all six views (docDemo), apart from the views", () => {
    const demo = projectOf(migrate("docDemo"));
    expect(demo.views).toEqual(["cards", "board", "timeline", "team", "focus", "brief"]);
    expect({ ...demo, views: project.views }).toEqual(project);
  });

  it("builds the same tasks as the v2 demo fixture, apart from ids and timestamps", () => {
    const fixture = activeProject(demoState());
    const shape = (p: ProjectDoc) =>
      sortedByOrder(p.tasks).map((t) => ({ ...t, id: null, dependsOn: t.dependsOn.length, createdAt: null }));
    expect(shape(project)).toEqual(shape(fixture));
  });
});

/* ------------------------------------------------------------------
   Legacy shapes and over-limit values
   ------------------------------------------------------------------ */

describe("a save from before views, team, moodboard and brief (legacyMinimal)", () => {
  const result = migrate("legacyMinimal");

  it("keeps the view on screen as the only view, as v0's migrateViews did", () => {
    expect(projectOf(result).views).toEqual(["cards"]);
    expect(result.report.salvaged).toEqual([{ path: "tool.views", was: "missing", now: "[cards]" }]);
  });

  it("defaults the rest: no people, owners, mood, plan or brief", () => {
    expect(result.people).toEqual([]);
    expect(projectOf(result).memberIds).toEqual([]);
    expect(inOrder(result).map((t) => t.ownerId)).toEqual([null, null, null, null]);
    expect(projectOf(result).moodboard.items).toEqual({});
    expect(result.report.dropped).toEqual([]);
    expect(result.report.sample).toEqual({ team: false, start: true });
  });
});

describe("over-limit values", () => {
  it("cuts a 140-character project title to 80 (overTitle140)", () => {
    const result = migrate("overTitle140");
    const title = "Website relaunch for the Fondazione Arte Contemporanea, with the new visual identity, the online shop and the archive of all its exhibitions";
    expect(projectOf(result).title).toBe(title.slice(0, 80));
    expect(result.report.salvaged).toEqual([{ path: "tool.title", was: JSON.stringify(title), now: JSON.stringify(title.slice(0, 80)) }]);
  });

  it("keeps the first 20 of 21 people, the rest with an unknown capacity (over21People)", () => {
    const result = migrate("over21People");
    expect(result.people).toHaveLength(20);
    expect(result.people.slice(0, 3).map((p) => p.id)).toEqual(SAMPLE_PEOPLE.map((p) => p.id));
    expect(result.people.slice(3).every((p) => p.capacityDaysPerWeek === null && p.id.startsWith("per_"))).toBe(true);
    expect(result.report.capacityUnknown).toEqual(result.people.slice(3).map((p) => p.id));
    expect(result.report.dropped).toEqual([{ what: "person Person 21", why: "the v0 team holds at most 20 people" }]);
    expect(projectOf(result).memberIds).toEqual(result.people.map((p) => p.id));
    // Team rows keep the v0 order
    expect(sortedByOrder(result.people).map((p) => p.name)).toEqual(result.people.map((p) => p.name));
  });

  it("keeps the first 200 of 216 mood items, stacked as before (over216Mood)", () => {
    const result = migrate("over216Mood");
    const items = sortedByZ(projectOf(result).moodboard.items);
    expect(items).toHaveLength(200);
    expect(result.report.dropped).toEqual([{ what: "16 moodboard items", why: "a moodboard holds at most 200; the last ones added go" }]);
    expect(result.report.assets.referenced).toHaveLength(200);
    // Stacking: z keys follow the v0 array order (last on top)
    const v0 = (v0Doc("over216Mood").mood as { id: string; asset: string }[]).slice(0, 200);
    expect(items.map((m) => m.id)).toEqual(v0.map((m) => result.idMap.moodItems[m.id]));
    const aliases = assetAliases(result.idMap);
    expect(items.map((m) => aliases[m.assetId!])).toEqual(v0.map((m) => m.asset));
  });

  it("clamps tall notes into the board (overMasonryTallNotes)", () => {
    const result = migrate("overMasonryTallNotes");
    const items = Object.values(projectOf(result).moodboard.items);
    expect(items.every((m) => m.h <= 3 && m.y <= 20 && m.x + m.w <= 1 + 1e-9)).toBe(true);
    expect(result.report.salvaged.filter((s) => s.path.endsWith(".h"))).toHaveLength(14);
    expect(result.report.salvaged.filter((s) => s.path.endsWith(".y")).map((s) => s.now)).toEqual(Array(6).fill("20"));
  });

  it("widens a 0.0076-wide note to the 0.04 minimum (overNarrowNote)", () => {
    const result = migrate("overNarrowNote");
    const note = Object.values(projectOf(result).moodboard.items).find((m) => m.kind === "note")!;
    expect(note.w).toBe(0.04);
    expect(note.x + note.w).toBeLessThanOrEqual(1);
    expect(result.report.salvaged).toEqual([{ path: "mood[0].w", was: "0.007560399999999999", now: "0.04" }]);
  });
});

/* ------------------------------------------------------------------
   Coherence (Q2)
   ------------------------------------------------------------------ */

describe("incoherent status and progress, repaired with status first (Q2)", () => {
  it.each([
    ["incoherentDone40", "UI Design", "done@40", "done@100"],
    ["incoherentTodo30", "UI Design", "todo@30", "active@30"],
    ["incoherentReview100", "Research", "review@100", "review@95"],
    ["incoherentActive100", "Research", "active@100", "active@95"],
    ["incoherentTodo100", "Development", "todo@100", "active@95"],
  ])("%s: %s %s → %s", (name, title, from, to) => {
    const result = migrate(name);
    expect(result.report.repaired).toEqual([{ title, from, to }]);
    const task = titled(result, title);
    expect(`${task.status}@${task.progress}`).toBe(to);
    expect(task.completedAt).toBeNull();
  });

  it("leaves the coherent active@90 of a slider pass alone (sliderReview90)", () => {
    const result = migrate("sliderReview90");
    expect(result.report.repaired).toEqual([]);
    expect(titled(result, "Visual Direction")).toMatchObject({ status: "active", progress: 90 });
  });
});

/* ------------------------------------------------------------------
   Steps
   ------------------------------------------------------------------ */

describe("steps", () => {
  it("flattens a grandchild onto its top-level task, after the direct steps (stepGrandchild)", () => {
    const result = migrate("stepGrandchild");
    const ui = titled(result, "UI Design");
    expect(ui.steps.map((s) => [s.title, s.done, s.estimateDays, s.ownerId])).toEqual([
      ["Wireframes", false, 2, null],
      ["Mobile wireframes", false, 1, null],
    ]);
    expect(result.report.salvaged).toEqual([{ path: "tasks.t-9otpbh.parentId", was: '"t-0aj20u"', now: '"t-ui"' }]);
    expect(Object.keys(projectOf(result).tasks)).toHaveLength(4);
    expect(result.idMap.steps).toEqual({ "t-0aj20u": ui.steps[0].id, "t-9otpbh": ui.steps[1].id });
  });

  it("promotes an orphan step to a task at the end, with no dependencies (stepOrphan)", () => {
    const result = migrate("stepOrphan");
    const tasks = inOrder(result);
    expect(tasks.map((t) => t.title)).toEqual(["Research", "Visual Direction", "UI Design", "Development", "Hero line"]);
    expect(tasks[4]).toMatchObject({ dependsOn: [], estimateDays: 0.5, status: "todo", steps: [] });
    expect(result.report.promoted).toBe(1);
    expect(result.report.salvaged).toEqual([{ path: "tasks.t-4mzl0a.parentId", was: '"t-f9n4uk"', now: "null" }]);
  });

  it("keeps accepted steps with their estimates, one of them done (stepsWithEstimates)", () => {
    const result = migrate("stepsWithEstimates");
    expect(titled(result, "UI Design").steps.map((s) => [s.title, s.done, s.estimateDays])).toEqual([
      ["Wireframes & flows", true, 1.5],
      ["Key screens", false, 2],
      ["Component library", false, 1.5],
      ["Prototype & handoff", false, 1],
    ]);
    expect(result.report.dropped).toEqual([]);
  });

  it("promotes steps past 40 to tasks, and reports what a step can't keep", () => {
    const doc = v0Doc("docTracker");
    const tasks = v0Tasks(doc);
    for (let i = 0; i < 45; i++) {
      tasks[`s-${i}`] = { ...tasks["t-dev"], id: `s-${i}`, title: `Step ${i + 1}`, parentId: "t-ui", owner: null, status: "todo", progress: 0, priority: "urgent" };
    }
    tasks["s-0"] = { ...tasks["s-0"], status: "active", progress: 30, cost: 12, emphasis: true, priority: "low" };
    const result = migrateDoc(doc);
    expect(titled(result, "UI Design").steps).toHaveLength(40);
    expect(inOrder(result).slice(4).map((t) => [t.title, t.dependsOn])).toEqual([41, 42, 43, 44, 45].map((n) => [`Step ${n}`, []]));
    expect(result.report.promoted).toBe(5);
    expect(result.report.dropped).toEqual([
      { what: 'step "Step 1": In progress at 30%, Low priority, its cost, its emphasis', why: "a step keeps only its title, its estimate and whether it's done" },
    ]);
  });

  it("breaks a parentId loop at its first task in record order, and keeps the rest as its steps", () => {
    const doc = v0Doc("docTracker");
    const tasks = v0Tasks(doc);
    tasks["s-a"] = { ...tasks["t-dev"], id: "s-a", title: "Loop A", parentId: "s-b", owner: null };
    tasks["s-b"] = { ...tasks["t-dev"], id: "s-b", title: "Loop B", parentId: "s-a", owner: null };
    tasks["s-c"] = { ...tasks["t-dev"], id: "s-c", title: "Under B", parentId: "s-b", owner: null };
    tasks["s-self"] = { ...tasks["t-dev"], id: "s-self", title: "Own parent", parentId: "s-self", owner: null };
    const result = migrateDoc(doc);
    expect(inOrder(result).slice(4).map((t) => [t.title, t.steps.map((s) => s.title)])).toEqual([
      ["Loop A", ["Loop B", "Under B"]],
      ["Own parent", []],
    ]);
    expect(result.report.promoted).toBe(2);
  });
});

/* ------------------------------------------------------------------
   Proposals, focus, brief, moodboard
   ------------------------------------------------------------------ */

describe("proposals", () => {
  it("keeps the subtasks proposal over a pending plan, with fresh step ids (proposalAndPlan)", () => {
    const result = migrate("proposalAndPlan");
    const proposal = projectOf(result).proposal;
    expect(proposal).toMatchObject({ kind: "subtasks", taskId: titled(result, "UI Design").id, source: "parser", createdAt: FIXTURE_NOW });
    if (proposal?.kind !== "subtasks") throw new Error("Not a subtasks proposal");
    expect(proposal.items.map((i) => [i.title, i.estimateDays])).toEqual([
      ["Wireframes & flows", 1.5],
      ["Key screens", 2],
      ["Component library", 1.5],
      ["Prototype & handoff", 1],
    ]);
    expect(proposal.items.every((i) => i.stepId.startsWith("stp_"))).toBe(true);
    expect(result.idMap.proposal).toBe(proposal.id);
    expect(Object.keys(result.idMap.proposalItems)).toEqual(["p-gn9zwd", "p-7eu76g", "p-gsoiln", "p-uo1rfh"]);
    expect(result.report.dropped).toEqual([
      { what: "the pending workload plan", why: "one proposal is kept, the breakdown; Balance the workload makes the plan again" },
    ]);
  });

  it("turns a plan alone into an owner move, with from filled in", () => {
    const doc = v0Doc("proposalAndPlan");
    doc.proposal = null;
    (doc.plan as { moves: unknown[] }).moves.push({ taskId: "t-dev", to: null }, { taskId: "t-gone", to: "p-sara" }, { taskId: "t-research", to: "p-sara" });
    const result = migrateDoc(doc);
    expect(projectOf(result).proposal).toMatchObject({
      kind: "reassign",
      moves: [{ type: "owner", taskId: titled(result, "UI Design").id, from: SAMPLE_PERSON_IDS.marta, to: SAMPLE_PERSON_IDS.sara, why: "" }],
    });
    expect(result.report.dropped.map((d) => d.why)).toEqual(["it leaves the task with nobody", "its task is gone", "the task already belongs to them"]);
  });

  it("drops a breakdown of a step, and of a task that is gone", () => {
    const doc = v0Doc("stepsWithEstimates");
    doc.proposal = { parentId: "p-gz9lga", items: [{ id: "p-x", title: "Detail", estimate: 1 }] };
    expect(migrateDoc(doc).report.dropped).toEqual([{ what: "the pending breakdown", why: "it breaks down a step, and steps have no steps" }]);
    doc.proposal = { parentId: "t-gone", items: [{ id: "p-x", title: "Detail", estimate: 1 }] };
    expect(migrateDoc(doc).report.dropped).toEqual([{ what: "the pending breakdown", why: 'its task, "t-gone", is gone' }]);
  });
});

describe("the focus pin", () => {
  it("drops a pin on a deleted task, and keeps the focus view on screen (danglingFocus)", () => {
    const result = migrate("danglingFocus");
    expect(projectOf(result).viewConfig.focusPin).toBeNull();
    expect(result.report.dropped).toEqual([{ what: "the focus pin", why: '"t-dev" isn\'t a task in the project, so FORM picks again' }]);
    expect(result.local.activeView).toBe("focus");
  });

  it("maps a pin on an existing task", () => {
    const doc = v0Doc("danglingFocus");
    (doc.view as Record<string, unknown>).focusId = "t-ui";
    const result = migrateDoc(doc);
    expect(projectOf(result).viewConfig.focusPin).toBe(titled(result, "UI Design").id);
  });
});

describe("the brief (briefEdits)", () => {
  const result = migrate("briefEdits");
  const project = projectOf(result);

  it("rewrites keys that embed a task or a person, and drops the edit whose task is gone", () => {
    expect(project.brief.edits).toEqual({
      [`client:risks:${titled(result, "UI Design").id}`]: {
        text: "UI Design is the priority this week.",
        basis: "UI Design is urgent and overdue on the sample schedule since 10 Oct.",
      },
      [`team:risks:load:${SAMPLE_PERSON_IDS.marta}`]: { text: "Marta needs help on UI Design.", basis: "Marta is 3 days over capacity." },
    });
    expect(result.report.dropped).toEqual([
      { what: 'the brief edit "client:moving:t-copy"', why: 'the task it is about, "t-copy", is no longer a task in the project' },
    ]);
  });

  it("keeps the added lines with fresh ids, and the team audience on screen", () => {
    expect(project.brief.lines.map((l) => [l.audience, l.section, l.text])).toEqual([
      ["client", "note", "Homepage preview on Friday."],
      ["team", "note", "Standup moved to 10."],
    ]);
    expect(project.brief.lines.map((l) => l.id)).toEqual([result.idMap.briefLines["b-k9zloy"], result.idMap.briefLines["b-n4od1g"]]);
    expect(project.viewConfig.brief).toEqual({ audience: "team", short: false });
    expect(result.local.activeView).toBe("brief");
    expect(result.report.changes).toBe(12);
  });
});

describe("a mood image whose blob is missing (moodImage)", () => {
  it("keeps the image under an alias of its IndexedDB key, and reports the key", () => {
    const result = migrate("moodImage");
    const [image] = Object.values(projectOf(result).moodboard.items);
    expect(image).toMatchObject({ kind: "image", x: 0.03, y: 0.03, w: 0.24, h: 0.18, r: 0, hex: null, text: null });
    expect(image.assetId).toBe(result.idMap.assets["img-fixture1"]);
    expect(assetAliases(result.idMap)).toEqual({ [image.assetId!]: "img-fixture1" });
    expect(result.report.assets.referenced).toEqual(["img-fixture1"]);
    expect(projectOf(result).blocks).toEqual(["header", "metrics", "collection", "moodboard"]);
  });
});

/* ------------------------------------------------------------------
   Storage: readV0 and the spy
   ------------------------------------------------------------------ */

describe("readV0", () => {
  it.each([
    ["corruptMainWithBackup", "backup"],
    ["shapeBackup", "backup"],
    ["shapeBare", "main"],
    ["shapeEnvelope", "main"],
    ["docTracker", "main"],
  ])("finds %s under the %s key", (name, source) => {
    expect(readFixtureInput(entry(name))?.source).toBe(source);
    expect(migrate(name).report.source).toBe(source);
  });

  it("migrates the same project from the envelope, the bare document and the backup", () => {
    const shapes = ["shapeEnvelope", "shapeBare", "shapeBackup"].map((n) => {
      const p = projectOf(migrate(n));
      return { ...p, id: null };
    });
    expect(shapes[1]).toEqual(shapes[0]);
    expect(shapes[2]).toEqual(shapes[0]);
  });

  it("returns null when neither key holds a v0 document", () => {
    expect(readV0(spyStorage({}))).toBeNull();
    expect(readV0(spyStorage({ [V0_KEY]: "{", [V0_BACKUP_KEY]: "[]" }))).toBeNull();
    expect(readV0(spyStorage({ [V0_KEY]: JSON.stringify({ schemaVersion: 2, tool: null, tasks: {} }) }))).toBeNull();
  });

  it("prefers the main key, and falls back when it holds no v0 document", () => {
    const backup = storageOf(entry("shapeBackup"))[V0_BACKUP_KEY];
    const main = storageOf(entry("toolNull"))[V0_KEY];
    expect(readV0(spyStorage({ [V0_KEY]: main, [V0_BACKUP_KEY]: backup }))?.source).toBe("main");
    expect(readV0(spyStorage({ [V0_KEY]: JSON.stringify({ state: { doc: "garbage" } }), [V0_BACKUP_KEY]: backup }))?.source).toBe("backup");
  });

  it("reads blocked storage as empty, never throwing", () => {
    const blocked = {
      getItem() {
        throw new Error("SecurityError");
      },
    };
    expect(readV0(blocked)).toBeNull();
  });

  it("recognises the three stored shapes, and nothing else, as v0", () => {
    const doc = v0Doc("docTracker");
    expect(detectV0(doc)).toBe(true);
    expect(detectV0({ state: { doc, log: [] }, version: 1 })).toBe(true);
    expect(detectV0({ doc, log: [] })).toBe(true);
    for (const raw of [null, 42, "x", [], {}, { tool: null }, { ...doc, schemaVersion: 2 }]) expect(detectV0(raw)).toBe(false);
  });
});

describe("the v0 keys are never written (storage spy)", () => {
  it.each(MANIFEST.map((e) => [e.name, e] as const))("%s", (_, e) => {
    const initial = storageOf(e);
    const storage = spyStorage(initial);
    const read = readV0(storage);
    migrateV0(read!.raw, demoOptions({ source: read!.source }));
    migrateV0(read!.raw, importOptions({ source: read!.source, includeSampleTeam: true }));
    expect(storage.calls.filter((c) => c.method !== "getItem")).toEqual([]);
    expect(new Set(storage.calls.map((c) => c.args[0]))).toEqual(new Set([V0_KEY, ...(read!.source === "backup" ? [V0_BACKUP_KEY] : [])]));
    expect(Object.fromEntries(storage.values)).toEqual(initial);
  });
});

describe("purity", () => {
  it("never changes its input, frozen or not", () => {
    const deepFreeze = (v: unknown): unknown => {
      if (v !== null && typeof v === "object") {
        for (const inner of Object.values(v)) deepFreeze(inner);
        Object.freeze(v);
      }
      return v;
    };
    for (const e of MANIFEST) {
      const input = readFixtureInput(e)!;
      const before = structuredClone(input.raw);
      const workspace = demoOptions().workspace;
      const frozenWorkspace = structuredClone(workspace);
      deepFreeze(input.raw);
      deepFreeze(frozenWorkspace);
      expect(() => migrateV0(input.raw, demoOptions({ workspace: frozenWorkspace }))).not.toThrow();
      expect(input.raw).toEqual(before);
    }
  });
});

describe("a project reset in v0 (toolNull)", () => {
  it("gives no project and no people, and keeps the change count", () => {
    const result = migrate("toolNull");
    expect(result).toMatchObject({ project: null, people: [], local: { activeView: null } });
    expect(result.report).toMatchObject({ changes: 8, dropped: [], notices: [], sample: { team: false, start: false } });
  });
});

/* ------------------------------------------------------------------
   Import mode (Q4)
   ------------------------------------------------------------------ */

describe("import mode (Phase 2)", () => {
  it("leaves the sample team out unless asked, and their tasks lose their owner", () => {
    const result = migrate("docTracker", importOptions());
    expect(result.people).toEqual([]);
    expect(projectOf(result).memberIds).toEqual([]);
    expect(inOrder(result).map((t) => t.ownerId)).toEqual([null, null, null, null]);
    expect(result.report.dropped).toEqual([
      { what: "person Marta", why: "the sample team isn't included" },
      { what: "person Sara", why: "the sample team isn't included" },
      { what: "person Luca", why: "the sample team isn't included" },
      ...["Research", "Visual Direction", "UI Design", "Development"].map((t) => ({ what: `the owner of "${t}"`, why: "the sample team isn't included" })),
    ]);
  });

  it("imports the sample team as ordinary people when asked, capacities unknown", () => {
    const result = migrate("docTracker", importOptions({ includeSampleTeam: true }));
    expect(result.people.map((p) => [p.name, p.capacityDaysPerWeek])).toEqual([
      ["Marta", null],
      ["Sara", null],
      ["Luca", null],
    ]);
    expect(result.people.some((p) => SAMPLE_PEOPLE.some((s) => s.id === p.id))).toBe(false);
    expect(result.report.capacityUnknown).toEqual(result.people.map((p) => p.id));
    expect(titled(result, "Research").ownerId).toBe(result.people[1].id);
  });

  it("reuses a person the workspace already has, by case-insensitive name", () => {
    const sara = makePerson({ id: "per_existingsara" as PersonId, name: "sara", order: "a0", capacityDaysPerWeek: 3 });
    const archivedLuca = makePerson({ id: "per_archivedluca" as PersonId, name: "Luca", order: "a1", archived: true });
    const workspace = { ...demoOptions().workspace, people: { [sara.id]: sara, [archivedLuca.id]: archivedLuca } };
    const result = migrate("docTracker", importOptions({ includeSampleTeam: true, workspace }));
    expect(result.people.map((p) => p.name)).toEqual(["Marta", "Luca"]);
    expect(result.people.every((p) => p.order > "a1")).toBe(true);
    expect(titled(result, "Research").ownerId).toBe(sara.id);
    expect(projectOf(result).memberIds).toEqual([result.people[0].id, sara.id, result.people[1].id]);
    expect(result.idMap.people["p-sara"]).toBe(sara.id);
  });

  it("merges two v0 people with the same name onto the first", () => {
    const doc = v0Doc("docTracker");
    (doc.people as unknown[]).push({ id: "p-twin", name: " MARTA ", role: null, capacity: 5 });
    v0Tasks(doc)["t-dev"].owner = "p-twin";
    const result = migrateDoc(doc);
    expect(result.people).toHaveLength(3);
    expect(titled(result, "Development").ownerId).toBe(SAMPLE_PERSON_IDS.marta);
    expect(result.report.dropped).toEqual([{ what: "a second person called MARTA", why: "names are unique: their tasks go to the first" }]);
  });

  it("never passes the workspace's 100 people", () => {
    const orders = nKeys(99);
    const people = Object.fromEntries(
      orders.map((order, i) => {
        const p = makePerson({ id: `per_existing${String(i).padStart(4, "0")}` as PersonId, name: `Existing ${i}`, order });
        return [p.id, p];
      }),
    );
    const workspace = { ...demoOptions().workspace, people };
    const result = migrate("docTracker", importOptions({ includeSampleTeam: true, workspace }));
    expect(result.people.map((p) => p.name)).toEqual(["Marta"]);
    expect(result.report.dropped.map((d) => d.what)).toEqual(["person Sara", "person Luca", 'the owner of "Research"', 'the owner of "Development"']);
  });
});

/* ------------------------------------------------------------------
   Salvage
   ------------------------------------------------------------------ */

describe("salvage", () => {
  it("coerces each task field to the nearest value v2 accepts, and reports it", () => {
    const doc = v0Doc("docTracker");
    const tasks = v0Tasks(doc);
    Object.assign(tasks["t-research"], { status: "blocked", priority: "critical", title: "  Research\nand interviews  " });
    Object.assign(tasks["t-visual"], { progress: 33.6, estimate: 2.7, cost: 12.345 });
    Object.assign(tasks["t-ui"], { estimate: 400, cost: -5, title: " " });
    Object.assign(tasks["t-dev"], { estimate: 0.1, owner: 42, emphasis: "yes" });
    const result = migrateDoc(doc);
    expect(inOrder(result).map((t) => [t.title, t.status, t.priority, t.progress, t.estimateDays, t.costCents, t.ownerId, t.emphasis])).toEqual([
      ["Research and interviews", "active", "medium", 95, 3, null, SAMPLE_PERSON_IDS.sara, false],
      ["Visual Direction", "review", "high", 34, 2.5, 1235, SAMPLE_PERSON_IDS.marta, false],
      ["Untitled task", "active", "urgent", 30, 250, null, SAMPLE_PERSON_IDS.marta, false],
      ["Development", "todo", "medium", 0, 0.5, null, null, false],
    ]);
    expect(result.report.salvaged).toEqual([
      { path: "tasks.t-research.title", was: '"  Research\\nand interviews  "', now: '"Research and interviews"' },
      { path: "tasks.t-research.status", was: '"blocked"', now: '"todo"' },
      { path: "tasks.t-research.priority", was: '"critical"', now: '"medium"' },
      { path: "tasks.t-visual.progress", was: "33.6", now: "34" },
      { path: "tasks.t-visual.estimate", was: "2.7", now: "2.5" },
      { path: "tasks.t-ui.cost", was: "-5", now: "null" },
      { path: "tasks.t-ui.title", was: '" "', now: '"Untitled task"' },
      { path: "tasks.t-ui.estimate", was: "400", now: "250" },
      { path: "tasks.t-dev.estimate", was: "0.1", now: "0.5" },
      { path: "tasks.t-dev.emphasis", was: '"yes"', now: "false" },
      { path: "tasks.t-dev.owner", was: "42", now: "null" },
    ]);
    // Research was at 100%: its unknown status became To do, and To do at 100% is In progress at 95% (Q2)
    expect(result.report.repaired).toEqual([{ title: "Research and interviews", from: "todo@100", to: "active@95" }]);
  });

  it("filters the order to top-level tasks once each, and appends the ones it misses", () => {
    const doc = v0Doc("stepsWithEstimates");
    doc.order = ["t-ui", "t-ui", "t-gone", "p-gz9lga", 7, "t-research"];
    const result = migrateDoc(doc);
    expect(inOrder(result).map((t) => t.title)).toEqual(["UI Design", "Research", "Visual Direction", "Development"]);
    expect(result.report.dropped.map((d) => [d.what, d.why])).toEqual([
      ['the order entry "t-ui"', "it is listed twice"],
      ['the order entry "t-gone"', "it names no task"],
      ['the order entry "p-gz9lga"', "it names a step"],
    ]);
    expect(result.report.salvaged.map((s) => s.path)).toEqual(["order", "order[2]", "order[3]"]);
  });

  it("keeps a start date only inside the IsoDate window, so nothing is scheduled from it otherwise", () => {
    for (const startDate of ["2026-02-30", "2300-01-01", "1969-12-31", 20260928]) {
      const doc = v0Doc("docTracker");
      (doc.tool as Record<string, unknown>).startDate = startDate;
      const result = migrateDoc(doc);
      expect(projectOf(result)).toMatchObject({ startDate: null, startConfirmed: false });
      expect(result.report.notices).toEqual([]);
      expect(result.report.salvaged).toEqual([{ path: "tool.startDate", was: JSON.stringify(startDate), now: "null" }]);
    }
  });

  it("confirms a start date the user chose", () => {
    const doc = v0Doc("docTracker");
    Object.assign(doc.tool as Record<string, unknown>, { startDate: "2026-10-05", startDateIsSample: false });
    const result = migrateDoc(doc);
    expect(projectOf(result)).toMatchObject({ startDate: "2026-10-05", startConfirmed: true });
    expect(result.report.sample.start).toBe(false);
  });

  it("puts blocks in BLOCK_ORDER with header and collection, and keeps known views once each", () => {
    const doc = v0Doc("docTracker");
    Object.assign(doc.tool as Record<string, unknown>, { blocks: ["moodboard", "metrics", "budget", "metrics"], views: ["board", "nope", "board", "team"] });
    const result = migrateDoc(doc);
    expect(projectOf(result).blocks).toEqual(["header", "metrics", "collection", "moodboard"]);
    expect(projectOf(result).views).toEqual(["board", "team"]);
    // The view on screen (cards) is gone: the first view opens
    expect(result.local.activeView).toBe("board");
  });

  it("drops unusable mood items and fixes the rest", () => {
    const doc = v0Doc("moodImage");
    (doc.mood as unknown[]).push(
      { id: "m-1", kind: "color", x: 0.5, y: 0.1, w: 0.2, h: 0.2, r: 30, asset: null, hex: "#ABC", text: null },
      { id: "m-2", kind: "color", x: 0.5, y: 0.1, w: 0.2, h: 0.2, r: 0, asset: null, hex: "red", text: null },
      { id: "m-3", kind: "image", x: 0.5, y: 0.1, w: 0.2, h: 0.2, r: 0, asset: null, hex: null, text: null },
      { id: "m-4", kind: "note", x: "left", y: 0.1, w: 0.2, h: 0.2, r: 0, asset: null, hex: null, text: null },
      { id: "m-5", kind: "sticker" },
      { id: "m-6", kind: "image", x: 0.9, y: 0.1, w: 0.5, h: 0.2, r: 0, asset: "img-fixture1", hex: null, text: null },
    );
    const result = migrateDoc(doc);
    const items = sortedByZ(projectOf(result).moodboard.items);
    expect(items.map((m) => [m.kind, m.x, m.r, m.hex, m.text])).toEqual([
      ["image", 0.03, 0, null, null],
      ["color", 0.5, 15, "#aabbcc", null],
      ["note", 0.03, 0, null, ""],
      ["image", 0.5, 0, null, null],
    ]);
    // One alias for one stored file, however many items show it
    expect(items[0].assetId).toBe(items[3].assetId);
    expect(result.report.assets.referenced).toEqual(["img-fixture1"]);
    expect(result.report.dropped.map((d) => d.what)).toEqual(["moodboard item 3", "moodboard item 4", "moodboard item 6"]);
  });

  it("drops brief lines it can't place and cuts long edits", () => {
    const doc = v0Doc("briefEdits");
    const brief = doc.brief as { edits: Record<string, unknown>; lines: unknown[] };
    brief.edits["client:head:focus"] = { text: "x".repeat(700), basis: "b".repeat(5000) };
    brief.edits["client:moving:none"] = { text: "", basis: "Nothing is in progress right now." };
    brief.edits["boss:moving:t-ui"] = { text: "Hi", basis: "" };
    brief.edits["team:risks:load:p-ghost"] = { text: "Hi", basis: "" };
    brief.lines.push({ id: "b-1", audience: "boss", section: "note", text: "x" }, { id: "b-2", audience: "team", section: "gossip", text: "  Lunch  " }, { id: "b-3", audience: "team", section: "note", text: "   " });
    const result = migrateDoc(doc);
    const { edits, lines } = projectOf(result).brief;
    expect(edits["client:head:focus"]).toEqual({ text: "x".repeat(600), basis: "b".repeat(4000) });
    expect(edits["client:moving:none"]).toEqual({ text: "", basis: "Nothing is in progress right now." });
    expect(Object.keys(edits)).toHaveLength(4);
    expect(lines.map((l) => [l.audience, l.section, l.text]).slice(2)).toEqual([["team", "note", "Lunch"]]);
    expect(result.report.dropped.map((d) => d.what)).toEqual([
      "brief line 3",
      "brief line 5",
      'the brief edit "client:moving:t-copy"',
      'the brief edit "boss:moving:t-ui"',
      'the brief edit "team:risks:load:p-ghost"',
    ]);
  });

  it.each([
    ["a number", 42],
    ["a string", "form"],
    ["null", null],
    ["a list", []],
    ["a v2 document", { schemaVersion: 2, docType: "project" }],
    ["an envelope around nothing", { state: { doc: null, log: [1, 2] }, version: 1 }],
  ])("turns %s into no project, without throwing", (_, raw) => {
    const result = migrateDoc(raw);
    expect(result.project).toBeNull();
    expect(result.report.dropped).toHaveLength(1);
  });

  it("keeps the change count of an envelope whatever the document", () => {
    expect(migrateDoc({ state: { doc: null, log: [1, 2] }, version: 1 }).report.changes).toBe(2);
  });

  it("fits a document past 1 MB by dropping its brief edits, then its last tasks", () => {
    const doc = v0Doc("docTracker");
    const tasks = v0Tasks(doc);
    const order = doc.order as string[];
    for (let i = 0; i < 450; i++) {
      tasks[`t-big${i}`] = { ...tasks["t-dev"], id: `t-big${i}`, title: `Big ${i} ${"x".repeat(120)}`, owner: null };
      order.push(`t-big${i}`);
      for (let j = 0; j < 8; j++) tasks[`s-big${i}x${j}`] = { ...tasks[`t-big${i}`], id: `s-big${i}x${j}`, title: `Step ${"y".repeat(130)}`, parentId: `t-big${i}` };
    }
    (doc.view as Record<string, unknown>).focusId = "t-big449";
    doc.brief = { edits: { [`client:risks:t-big1`]: { text: "Note", basis: "z".repeat(3000) } }, lines: [] };
    const result = migrateDoc(doc);
    const project = projectOf(result);
    expect(JSON.stringify(project).length).toBeLessThanOrEqual(1_000_000);
    expect(project.brief.edits).toEqual({});
    expect(project.viewConfig.focusPin).toBeNull();
    const kept = Object.keys(project.tasks).length;
    expect(kept).toBeLessThan(454);
    expect(result.report.dropped.map((d) => d.what)).toEqual(["1 brief edit", `the last ${454 - kept} tasks`, "the focus pin"]);
    expect(Object.keys(result.idMap.tasks)).toHaveLength(kept);
  });
});

/* ------------------------------------------------------------------
   Brief keys and the upgrade chain
   ------------------------------------------------------------------ */

describe("rewriteBriefKey", () => {
  const lookup = {
    task: (id: string) => (id === "t-ui" ? ("tsk_aaaaaaaaaaaaaaaa" as TaskId) : undefined),
    person: (id: string) => (id === "p-marta" ? SAMPLE_PERSON_IDS.marta : undefined),
  };

  it.each([
    ["client:risks:t-ui", "client:risks:tsk_aaaaaaaaaaaaaaaa"],
    ["team:moving:t-ui", "team:moving:tsk_aaaaaaaaaaaaaaaa"],
    ["team:risks:load:p-marta", "team:risks:load:per_demomarta"],
    ["client:moving:none", "client:moving:none"],
    ["client:risks:none", "client:risks:none"],
    ["client:head:focus", "client:head:focus"],
    ["team:questions:owners", "team:questions:owners"],
  ])("%s → %s", (key, next) => {
    expect(rewriteBriefKey(key, lookup)).toEqual({ key: next });
  });

  it.each(["client:risks:t-gone", "team:risks:load:p-ghost", "boss:done:all", "client:Done:all", "client:next:up:x-y", "", "client"])("drops %j", (key) => {
    expect(rewriteBriefKey(key, lookup)).toHaveProperty("why");
  });
});

describe("the schema upgrade chain", () => {
  const state = demoState();
  const project = activeProject(state);

  it("is at version 2 with no step yet", () => {
    expect(CURRENT_SCHEMA).toBe(2);
  });

  it("passes current documents through a strict parse and the invariants", () => {
    expect(upgradeProjectDoc(structuredClone(project))).toEqual(project);
    expect(upgradeWorkspaceDoc(structuredClone(state.workspace))).toEqual(state.workspace);
  });

  it("refuses documents it can't read", () => {
    const cases: unknown[] = [
      v0Doc("docTracker"),
      { ...project, schemaVersion: 3 },
      { ...project, schemaVersion: 1 },
      { ...project, title: "" },
      { ...project, viewConfig: { ...project.viewConfig, focusPin: "tsk_missingmissing00" } },
      null,
    ];
    for (const doc of cases) expect(() => upgradeProjectDoc(doc)).toThrow(UpgradeError);
    expect(() => upgradeWorkspaceDoc({ ...state.workspace, schemaVersion: "2" })).toThrow(UpgradeError);
  });

  it("migrated documents read back unchanged", () => {
    for (const e of MANIFEST) {
      const input = readFixtureInput(e)!;
      const result = migrateV0(input.raw, demoOptions({ mint: seededMinter(7) }));
      if (result.project) expect(upgradeProjectDoc(result.project)).toEqual(result.project);
    }
  });
});
