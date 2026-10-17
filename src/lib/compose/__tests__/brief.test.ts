// Brief composer v2 (plan §6.9, §10.2): the demo's sentence ids per audience and length, the new
// ids (questions:unknown, risks:deadline), the short-version rules, edits, the plan-driven
// wording (risks, load, dates), and the text export. The golden test compares the wording with
// the frozen v0 composer (test/golden/brief.golden.test.ts).
import { describe, expect, it } from "vitest";
import { briefHtml, briefPlainText, lineText, plainText } from "@/lib/compose/brief-export";
import { composeBrief, type Brief, type BriefInput, type BriefLine } from "@/lib/compose/brief";
import { seededMinter } from "@/lib/domain/ids";
import { nKeys } from "@/lib/domain/order";
import { type Audience, BriefEditKey, IsoDate, type MoodItem, type PersonId, type ProjectDoc, type Task } from "@/lib/domain/schema";
import { laneLoads, planProject, weeklyLoad } from "@/lib/planning";
import {
  activeProject,
  byId,
  DEMO_PEOPLE,
  demoState,
  FIXTURE_TODAY,
  type FixtureState,
  generated,
  makeTask,
  taskByTitle,
} from "../../../../test/fixtures/v2/build";

const d = (s: string) => IsoDate.parse(s);

/** Replaces the active project of a state */
function edit(state: FixtureState, change: (p: ProjectDoc) => ProjectDoc): FixtureState {
  const project = activeProject(state);
  return { ...state, projects: { ...state.projects, [project.id]: change(project) } };
}

/** Changes the named tasks of the active project */
function editTasks(state: FixtureState, changes: Record<string, Partial<Task>>): FixtureState {
  return edit(state, (p) => {
    const tasks = { ...p.tasks };
    for (const [title, patch] of Object.entries(changes)) {
      const t = taskByTitle(p, title);
      tasks[t.id] = { ...t, ...patch };
    }
    return { ...p, tasks };
  });
}

function input(state: FixtureState, audience: Audience = "client", short = false, today = FIXTURE_TODAY): BriefInput {
  const plans = Object.values(state.projects).map((p) => planProject(p, state.workspace, today));
  const plan = plans.find((p) => p.project.id === state.projectId)!;
  return { plan, ws: state.workspace, audience, short, today, lanes: laneLoads(plan, weeklyLoad(state.workspace, plans), state.workspace) };
}

function brief(state: FixtureState, audience: Audience = "client", short = false, today = FIXTURE_TODAY): Brief {
  const b = composeBrief(input(state, audience, short, today));
  if (b === null) throw new Error("No brief");
  return b;
}

const linesOf = (b: Brief): BriefLine[] => [...b.headline, ...b.sections.flatMap((s) => s.lines)];
const ids = (b: Brief) => linesOf(b).map((l) => l.id);
/** Sentence id → its composed wording */
const textById = (b: Brief) => Object.fromEntries(linesOf(b).map((l) => [l.id, l.kind === "custom" ? String(l.runs[0]) : l.composed]));
const section = (b: Brief, key: string) => b.sections.find((s) => s.key === key);

/* ------------------------------------------------------------------
   The demo
   ------------------------------------------------------------------ */

describe("the demo brief", () => {
  const state = demoState();
  const p = activeProject(state);
  const id = (title: string) => taskByTitle(p, title).id;

  it("composes v0's sentence ids for the client", () => {
    expect(ids(brief(state, "client"))).toEqual([
      "head:status",
      "head:focus",
      "done:all",
      `moving:${id("Visual Direction")}`,
      `moving:${id("UI Design")}`,
      "next:up",
      "next:end",
      `risks:${id("UI Design")}`,
      "questions:start",
    ]);
  });

  it("adds the owners, the load line and the costs question for the team", () => {
    const b = brief(state, "team");
    expect(ids(b)).toEqual([
      "head:status",
      "head:focus",
      "done:all",
      `moving:${id("Visual Direction")}`,
      `moving:${id("UI Design")}`,
      "next:up",
      "next:end",
      `risks:${id("UI Design")}`,
      `risks:load:${DEMO_PEOPLE.marta}`,
      "questions:start",
      "questions:costs",
    ]);
    expect(textById(b)).toMatchObject({
      "head:status": "New website is 39% done.",
      "head:focus": "UI Design is the one to watch.",
      "done:all": "Research is done.",
      [`moving:${id("Visual Direction")}`]: "Visual Direction is in review, with Marta.",
      [`moving:${id("UI Design")}`]: "UI Design is 30% in, with Marta.",
      "next:up": "Development starts after UI Design, about 8 days of work, with Luca.",
      "next:end": "On the sample schedule, the last task ends 26 Oct.",
      [`risks:${id("UI Design")}`]: "UI Design is urgent.",
      [`risks:load:${DEMO_PEOPLE.marta}`]: "Marta is 4 days over capacity.",
      "questions:start": "The start date is still the sample date: confirm it to make the dates real.",
      "questions:costs": "No costs have been estimated yet.",
    });
  });

  it("keys every composed line by audience, and mentions entities instead of copying their names", () => {
    const b = brief(state, "team");
    for (const l of linesOf(b)) expect(l.key).toBe(`team:${l.id}`);
    const moving = linesOf(b).find((l) => l.id === `moving:${id("UI Design")}`)!;
    expect(moving.runs).toEqual([{ task: id("UI Design") }, " is 30% in", ", with ", { person: DEMO_PEOPLE.marta }, "."]);
  });

  it("has the v0 eyebrow, progress and empty palette", () => {
    const b = brief(state, "client");
    expect(b.eyebrow).toEqual(["Status", "14 Oct", "For the client", "Sample schedule"]);
    expect(b.progress).toBe(39);
    expect(b.palette).toEqual([]);
    expect(b.changes).toBe(0);
    expect(b.hidden).toEqual([]);
    expect(brief(state, "team").eyebrow[2]).toBe("For the team");
  });

  it("is null without a project", () => {
    expect(composeBrief({ ...input(state), plan: null })).toBeNull();
  });

  it("doesn't depend on the order of the task and people records (jsonb)", () => {
    const reversed = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).reverse());
    const shuffled: FixtureState = {
      ...edit(state, (x) => ({ ...x, tasks: reversed(x.tasks) as ProjectDoc["tasks"] })),
      workspace: { ...state.workspace, people: reversed(state.workspace.people) as typeof state.workspace.people },
    };
    for (const audience of ["client", "team"] as const) expect(brief(shuffled, audience)).toEqual(brief(state, audience));
  });
});

/* ------------------------------------------------------------------
   The short version
   ------------------------------------------------------------------ */

describe("the short version (v0's rules)", () => {
  const mint = seededMinter(5);
  const state = edit(demoState(), (p) => ({
    ...p,
    brief: {
      ...p.brief,
      lines: [
        { id: mint("briefLine"), audience: "team", section: "done", text: "Kick-off went well." },
        { id: mint("briefLine"), audience: "team", section: "next", text: "Copy deck by Friday." },
        { id: mint("briefLine"), audience: "team", section: "next", text: "Photo shoot on the 20th." },
      ],
    },
  }));

  it("drops FORM's done lines but keeps every line the user wrote", () => {
    const short = brief(state, "team", true);
    expect(section(short, "done")!.lines.map((l) => [l.kind, l.runs[0]])).toEqual([["custom", "Kick-off went well."]]);
    expect(section(short, "next")!.lines.map((l) => l.kind)).toEqual(["composed", "composed", "custom", "custom"]);
    // With no line of the user's, the short version has no done section at all
    expect(section(brief(demoState(), "team", true), "done")).toBeUndefined();
    expect(section(brief(demoState(), "team"), "done")).toBeDefined();
  });

  it("keeps at most two composed lines per section", () => {
    const full = brief(state, "team");
    const short = brief(state, "team", true);
    for (const s of short.sections.filter((x) => x.key !== "done")) {
      const composed = s.lines.filter((l) => l.kind === "composed");
      expect(composed.length).toBeLessThanOrEqual(2);
      const all = section(full, s.key)!.lines.filter((l) => l.kind === "composed");
      expect(composed).toEqual(all.slice(0, 2));
    }
    // The team's questions: start and costs both fit
    expect(section(short, "questions")!.lines.map((l) => l.id)).toEqual(["questions:start", "questions:costs"]);
  });

  it("keeps the headline whole", () => {
    expect(brief(state, "client", true).headline).toEqual(brief(state, "client").headline);
  });
});

/* ------------------------------------------------------------------
   Edits
   ------------------------------------------------------------------ */

describe("the user's edits", () => {
  const base = demoState();
  const composedOf = (state: FixtureState, audience: Audience, sentence: string) => linesOf(brief(state, audience)).find((l) => l.id === sentence)!.composed;
  const withEdits = (edits: ProjectDoc["brief"]["edits"], state = base) => edit(state, (p) => ({ ...p, brief: { ...p.brief, edits } }));

  it("rewrites a line and counts the change", () => {
    const state = withEdits({ "client:next:up": { text: "Development follows the screens.", basis: composedOf(base, "client", "next:up") } });
    const b = brief(state);
    const line = linesOf(b).find((l) => l.id === "next:up")!;
    expect(line).toMatchObject({ edited: "Development follows the screens.", stale: false, composed: "Development starts after UI Design, about 8 days of work." });
    expect(b.changes).toBe(1);
    expect(lineText(line, activeProject(state), state.workspace)).toBe("Development follows the screens.");
    // The other audience keeps FORM's wording
    expect(linesOf(brief(state, "team")).find((l) => l.id === "next:up")!.edited).toBeNull();
  });

  it("flags a rewrite as stale once FORM's wording moves on", () => {
    const state = withEdits({ "client:next:up": { text: "Development follows the screens.", basis: composedOf(base, "client", "next:up") } });
    const moved = editTasks(state, { Development: { estimateDays: 10 } });
    const line = linesOf(brief(moved)).find((l) => l.id === "next:up")!;
    expect(line).toMatchObject({ stale: true, composed: "Development starts after UI Design, about 10 days of work." });
  });

  it("flags v0-era edits of the dates as stale (the working-day end moved, ED-5)", () => {
    const state = withEdits({ "client:next:end": { text: "We launch on the 18th.", basis: "On the sample schedule, the last task ends 18 Oct." } });
    expect(linesOf(brief(state)).find((l) => l.id === "next:end")).toMatchObject({ edited: "We launch on the 18th.", stale: true });
  });

  it("hides a line while FORM would say the same thing, and shows it again when it wouldn't", () => {
    const state = withEdits({ "client:done:all": { text: "", basis: composedOf(base, "client", "done:all") } });
    const b = brief(state);
    expect(ids(b)).not.toContain("done:all");
    expect(b.hidden).toEqual(["client:done:all"]);
    expect(b.changes).toBe(1);
    // The section stays, empty, so "Show 1 hidden" has a place
    expect(section(b, "done")!.lines).toEqual([]);

    const moved = editTasks(state, { "Visual Direction": { status: "done", progress: 100 } });
    const shown = brief(moved);
    expect(linesOf(shown).find((l) => l.id === "done:all")).toMatchObject({ composed: "Research and Visual Direction are done.", edited: null, stale: false });
    expect(shown.hidden).toEqual([]);
    expect(shown.changes).toBe(0);
  });

  it("leaves edits of sentences FORM no longer writes dormant", () => {
    const state = withEdits({ "client:risks:tsk_0000000000000000": { text: "Gone.", basis: "Gone." } });
    expect(brief(state).changes).toBe(0);
  });

  it("adds the user's lines to their section, after FORM's, and counts them", () => {
    const mint = seededMinter(9);
    const line = { id: mint("briefLine"), audience: "client" as const, section: "note" as const, text: "Launch party on Friday." };
    const state = edit(base, (p) => ({ ...p, brief: { ...p.brief, lines: [line] } }));
    const b = brief(state);
    expect(b.sections[0]).toEqual({
      key: "note",
      label: "Note",
      lines: [{ id: line.id, key: line.id, kind: "custom", runs: ["Launch party on Friday."], composed: "", edited: null, stale: false }],
    });
    expect(b.changes).toBe(1);
    // No note section without a note, and none for the other audience
    expect(section(brief(base), "note")).toBeUndefined();
    expect(section(brief(state, "team"), "note")).toBeUndefined();
  });
});

/* ------------------------------------------------------------------
   Headline
   ------------------------------------------------------------------ */

describe("the headline", () => {
  const state = demoState();
  const head = (s: FixtureState, today = FIXTURE_TODAY) => {
    const t = textById(brief(s, "client", false, today));
    return [t["head:status"], t["head:focus"]];
  };

  it("names an empty project", () => {
    const empty = edit(state, (p) => ({ ...p, tasks: {} }));
    expect(head(empty)).toEqual(["New website has no tasks yet.", "Add tasks to start the brief."]);
    expect(brief(empty).progress).toBe(0);
  });

  it("names a complete project", () => {
    const done = editTasks(state, Object.fromEntries(["Visual Direction", "UI Design", "Development"].map((t) => [t, { status: "done" as const, progress: 100 }])));
    expect(head(done)).toEqual(["New website is complete.", "Everything has been delivered."]);
    expect(brief(done).progress).toBe(100);
  });

  it("names a project that hasn't started, and its first task", () => {
    const fresh = editTasks(
      state,
      Object.fromEntries(["Research", "Visual Direction", "UI Design", "Development"].map((t) => [t, { status: "todo" as const, progress: 0, priority: "medium" as const }])),
    );
    expect(head(fresh)).toEqual(["New website hasn't started yet.", "Research is up next."]);
    expect(brief(fresh).progress).toBe(0);
  });

  it("counts tasks when nothing open has a duration", () => {
    const unsized = editTasks(state, { "Visual Direction": { estimateDays: null }, "UI Design": { estimateDays: null }, Development: { estimateDays: null } });
    expect(head(unsized)[0]).toBe("1 of 4 tasks are done.");
    expect(brief(unsized).progress).toBe(25);
  });

  it("says where the work is, or what waits on review, when nothing is at risk", () => {
    const calm = editTasks(state, { "UI Design": { priority: "high" }, "Visual Direction": { priority: "medium" } });
    expect(head(calm)[1]).toBe("UI Design is where the work is.");
    const reviewing = editTasks(state, { "UI Design": { priority: "medium", status: "todo", progress: 0 }, "Visual Direction": { priority: "high" } });
    expect(head(reviewing)[1]).toBe("Visual Direction is waiting on review.");
  });

  it("says a pinned to-do that isn't next is the priority", () => {
    const pinned = edit(state, (p) => ({ ...p, viewConfig: { ...p.viewConfig, focusPin: taskByTitle(p, "Development").id } }));
    // Development is the first to-do, so it is "up next"; a later one is "the priority"
    expect(head(pinned)[1]).toBe("Development is up next.");
    const mint = seededMinter(3);
    const later = edit(pinned, (p) => {
      const launch = makeTask({ id: mint("task"), title: "Launch", order: `${taskByTitle(p, "Development").order}V`, estimateDays: 1 });
      return { ...p, tasks: { ...p.tasks, [launch.id]: launch }, viewConfig: { ...p.viewConfig, focusPin: launch.id } };
    });
    expect(head(later)[1]).toBe("Launch is the priority.");
  });
});

/* ------------------------------------------------------------------
   Plan-driven wording: next, risks, questions
   ------------------------------------------------------------------ */

describe("what comes next", () => {
  const state = demoState();

  it("names what the next task waits on from its dependencies, not from the workflow order", () => {
    const free = editTasks(state, { Development: { dependsOn: [] } });
    expect(textById(brief(free))["next:up"]).toBe("Development is next, about 8 days of work.");
  });

  it("lists the rest of the to-dos, and the next step of the task in focus", () => {
    const mint = seededMinter(4);
    const steps = [
      { id: mint("step"), title: "Wireframes", done: true, ownerId: null, estimateDays: 1 },
      { id: mint("step"), title: "Key screens", done: false, ownerId: null, estimateDays: 2 },
    ];
    const extra = makeTask({ id: mint("task"), title: "Launch", order: `${taskByTitle(activeProject(state), "Development").order}V`, kind: "milestone", estimateDays: 0 });
    const s = edit(editTasks(state, { "UI Design": { steps } }), (p) => ({ ...p, tasks: { ...p.tasks, [extra.id]: extra } }));
    const t = textById(brief(s));
    expect(t["next:then"]).toBe("Then Launch.");
    expect(t["next:step"]).toBe("Next step on UI Design: Key screens.");
    expect(ids(brief(s)).indexOf("next:step")).toBe(ids(brief(s)).indexOf("next:then") + 1);
  });

  it("gives a milestone that is next no amount of work", () => {
    const mint = seededMinter(6);
    const p = activeProject(state);
    const launch = makeTask({ id: mint("task"), title: "Launch", kind: "milestone", estimateDays: 0, order: `${taskByTitle(p, "UI Design").order}V`, dependsOn: [taskByTitle(p, "UI Design").id] });
    const s = edit(state, (x) => ({ ...x, tasks: { ...x.tasks, [launch.id]: launch } }));
    expect(textById(brief(s))["next:up"]).toBe("Launch starts after UI Design.");
  });

  it("states the planned end on working days, and when it has passed", () => {
    expect(textById(brief(state))["next:end"]).toBe("On the sample schedule, the last task ends 26 Oct.");
    expect(textById(brief(state, "client", false, d("2026-10-28")))["next:end"]).toBe("On the sample schedule, the last task was planned to end 26 Oct.");
    const confirmed = edit(state, (p) => ({ ...p, startConfirmed: true }));
    expect(textById(brief(confirmed))["next:end"]).toBe("The last task ends 26 Oct.");
  });

  it("leaves out tasks without dates, saying why", () => {
    const unsized = editTasks(state, { Development: { estimateDays: null } });
    expect(textById(brief(unsized))["next:end"]).toBe("On the sample schedule, scheduled work ends 14 Oct, leaving out tasks with no duration.");
    const waiting = editTasks(state, { "UI Design": { estimateDays: null } });
    expect(textById(brief(waiting))["next:end"]).toBe("On the sample schedule, scheduled work was planned to end 6 Oct, leaving out tasks without dates.");
  });

  it("states no end without a date to state", () => {
    const relative = edit(state, (p) => ({ ...p, startDate: null }));
    const b = brief(relative, "team");
    expect(ids(b)).not.toContain("next:end");
    expect(b.eyebrow).toEqual(["Status", "14 Oct", "For the team"]);
    expect(textById(b)["questions:start"]).toBe("There is no start date yet: set one to make the dates real.");
    expect(textById(brief(relative, "client"))["questions:start"]).toBe("Dates are indicative until the start date is confirmed.");
  });
});

describe("risks", () => {
  const state = demoState();
  const p = activeProject(state);
  const id = (title: string) => taskByTitle(p, title).id;
  const confirmed = edit(state, (x) => ({ ...x, startConfirmed: true }));

  it("puts a missed deadline first (risks:deadline)", () => {
    const late = edit(state, (x) => ({ ...x, deadline: d("2026-10-20") }));
    const b = brief(late);
    expect(section(b, "risks")!.lines.map((l) => [l.id, l.composed])).toEqual([
      ["risks:deadline", "Planned end 26 Oct is 4 working days after the deadline."],
      [`risks:${id("UI Design")}`, "UI Design is urgent."],
    ]);
    // A deadline the plan meets is no risk
    expect(ids(brief(edit(state, (x) => ({ ...x, deadline: d("2026-10-26") }))))).not.toContain("risks:deadline");
  });

  it("calls a task late only on a confirmed start, strongest phrase first", () => {
    const t = textById(brief(confirmed));
    expect(t[`risks:${id("Visual Direction")}`]).toBe("Visual Direction is late by 6 working days.");
    expect(t[`risks:${id("UI Design")}`]).toBe("UI Design is urgent.");
    expect(t["questions:start"]).toBeUndefined();
    // Four working days late outweigh urgent (35 + 12 > 40)
    const later = textById(brief(confirmed, "client", false, d("2026-10-20")));
    expect(later[`risks:${id("UI Design")}`]).toBe("UI Design is late by 4 working days and urgent.");
  });

  it("names due dates: soon, today, past, and a plan that runs past them", () => {
    const due = (date: string) => textById(brief(editTasks(state, { Development: { dueDate: d(date) } })))[`risks:${id("Development")}`];
    expect(due("2026-10-16")).toBe("Development is due 16 Oct and planned to end 6 working days after its due date.");
    expect(due("2026-10-14")).toBe("Development is due today and planned to end 8 working days after its due date.");
    expect(due("2026-10-12")).toBe("Development is past due and planned to end 10 working days after its due date.");
    expect(due("2026-10-23")).toBe("Development is planned to end 1 working day after its due date.");
    expect(due("2026-10-30")).toBeUndefined();
  });

  it("reads the Team lanes for load, in the team version only", () => {
    const i = input(state, "team");
    const lanes = [
      { personId: DEMO_PEOPLE.marta, over: 2.5 },
      { personId: DEMO_PEOPLE.sara, over: 1 },
      { personId: DEMO_PEOPLE.luca, over: 0 },
      { personId: null, over: null },
    ];
    const t = textById(composeBrief({ ...i, lanes })!);
    expect(t[`risks:load:${DEMO_PEOPLE.marta}`]).toBe("Marta is 2.5 days over capacity.");
    expect(t[`risks:load:${DEMO_PEOPLE.sara}`]).toBe("Sara is 1 day over capacity.");
    expect(t[`risks:load:${DEMO_PEOPLE.luca}`]).toBeUndefined();
    expect(ids(composeBrief({ ...i, audience: "client", lanes })!).some((x) => x.startsWith("risks:load:"))).toBe(false);
  });

  it("says so when nothing is at risk", () => {
    const calm = editTasks(state, { "UI Design": { priority: "high" } });
    expect(section(brief(calm), "risks")!.lines.map((l) => [l.id, l.composed])).toEqual([["risks:none", "No risks flagged."]]);
  });
});

describe("open questions", () => {
  const state = demoState();

  it("names tasks without a duration, and the tasks waiting on them (questions:unknown)", () => {
    const waiting = editTasks(state, { "UI Design": { estimateDays: null } });
    const t = textById(brief(waiting));
    expect(t["questions:unsized"]).toBe("UI Design has no duration yet, so it isn't in the dates or the percentage.");
    expect(t["questions:unknown"]).toBe("Development has no dates until UI Design has a duration.");
    expect(ids(brief(waiting)).slice(-3)).toEqual(["questions:start", "questions:unsized", "questions:unknown"]);
  });

  it("lists several waiting tasks and several missing durations", () => {
    const mint = seededMinter(8);
    const p = activeProject(state);
    const copy = makeTask({ id: mint("task"), title: "Copywriting", order: `${taskByTitle(p, "Research").order}V`, estimateDays: null });
    const launch = makeTask({
      id: mint("task"),
      title: "Launch",
      order: `${taskByTitle(p, "Development").order}V`,
      estimateDays: 1,
      dependsOn: [copy.id, taskByTitle(p, "Development").id],
    });
    const s = editTasks(
      edit(state, (x) => ({ ...x, tasks: { ...x.tasks, [copy.id]: copy, [launch.id]: launch } })),
      { "UI Design": { estimateDays: null } },
    );
    const t = textById(brief(s));
    expect(t["questions:unsized"]).toBe("Copywriting and UI Design have no duration yet, so they aren't in the dates or the percentage.");
    expect(t["questions:unknown"]).toBe("Development and Launch have no dates until Copywriting and UI Design have durations.");
  });

  it("asks the team about owners only once there is a team, leaving milestones and archived people out", () => {
    const mint = seededMinter(10);
    const p = activeProject(state);
    const launch = makeTask({ id: mint("task"), title: "Launch", kind: "milestone", estimateDays: 0, order: `${taskByTitle(p, "Development").order}V` });
    const s = edit(editTasks(state, { Development: { ownerId: null } }), (x) => ({ ...x, tasks: { ...x.tasks, [launch.id]: launch } }));
    expect(textById(brief(s, "team"))["questions:owners"]).toBe("Development has no owner.");
    expect(textById(brief(s, "client"))["questions:owners"]).toBeUndefined();

    // Archived owners read as unassigned (Q7): no "with Marta", and her tasks need an owner
    const archived: FixtureState = { ...state, workspace: { ...state.workspace, people: { ...state.workspace.people, [DEMO_PEOPLE.marta]: { ...state.workspace.people[DEMO_PEOPLE.marta], archived: true } } } };
    const t = textById(brief(archived, "team"));
    expect(t["questions:owners"]).toBe("Visual Direction and UI Design have no owner.");
    expect(t[`moving:${taskByTitle(p, "UI Design").id}`]).toBe("UI Design is 30% in.");

    const nobody: FixtureState = { ...state, workspace: { ...state.workspace, people: {} } };
    expect(textById(brief(editTasks(nobody, { Development: { ownerId: null } }), "team"))["questions:owners"]).toBeUndefined();
  });

  it("counts manual and day-rate costs as known, milestones aside", () => {
    const mint = seededMinter(11);
    const p = activeProject(state);
    const launch = makeTask({ id: mint("task"), title: "Launch", kind: "milestone", estimateDays: 0, order: `${taskByTitle(p, "Development").order}V` });
    const costed = edit(editTasks(state, { Research: { costCents: 120_000 } }), (x) => ({ ...x, tasks: { ...x.tasks, [launch.id]: launch } }));
    const rated: FixtureState = {
      ...costed,
      workspace: { ...costed.workspace, people: { ...costed.workspace.people, [DEMO_PEOPLE.luca]: { ...costed.workspace.people[DEMO_PEOPLE.luca], dayRateCents: 40_000 } } },
    };
    expect(textById(brief(costed, "team"))["questions:costs"]).toBe("Costs are known for 1 of 4 tasks.");
    expect(textById(brief(rated, "team"))["questions:costs"]).toBe("Costs are known for 2 of 4 tasks.");
  });
});

/* ------------------------------------------------------------------
   Palette and export
   ------------------------------------------------------------------ */

describe("the palette strip", () => {
  it("takes up to eight colours from the moodboard, bottom of the stack first", () => {
    const mint = seededMinter(12);
    const zs = nKeys(12);
    const items: MoodItem[] = zs.map((z, i) => ({
      id: mint("moodItem"),
      kind: i === 3 ? "note" : "color",
      x: 0,
      y: 0,
      w: 0.2,
      h: 0.2,
      r: 0,
      z,
      assetId: null,
      hex: i === 3 ? null : `#0000${String(i).padStart(2, "0")}`,
      text: i === 3 ? "A note" : null,
    }));
    const state = edit(demoState(), (p) => ({ ...p, moodboard: { items: byId([...items].reverse()) } }));
    expect(brief(state).palette).toEqual(["#000000", "#000001", "#000002", "#000004", "#000005", "#000006", "#000007", "#000008"]);
  });
});

describe("the text export", () => {
  const state = demoState();
  const project = activeProject(state);
  const ws = state.workspace;

  it("resolves mentions, and reads a missing entity as nothing", () => {
    const ui = taskByTitle(project, "UI Design").id;
    expect(plainText([{ task: ui }, " is with ", { person: DEMO_PEOPLE.marta }, "."], project, ws)).toBe("UI Design is with Marta.");
    expect(plainText([{ task: "tsk_0000000000000000" as Task["id"] }, "|", { person: "per_0000000000000000" as PersonId }], project, ws)).toBe("|");
  });

  it("writes the brief as plain text for Mail", () => {
    const text = briefPlainText(brief(state, "team"), project, ws);
    expect(text.split("\n").slice(0, 6)).toEqual([
      "New website · Status · 14 Oct · For the team · Sample schedule",
      "",
      "New website is 39% done. UI Design is the one to watch.",
      "",
      "DONE",
      "– Research is done.",
    ]);
    expect(text.endsWith("\n\nComposed by FORM from the project data.")).toBe(true);
  });

  it("writes the brief as HTML, escaped", () => {
    const risky = edit(state, (p) => ({ ...p, title: "R&D <site>" }));
    const html = briefHtml(brief(risky), activeProject(risky), ws);
    expect(html.startsWith("<p><strong>R&amp;D &lt;site&gt;</strong> · Status · 14 Oct · For the client · Sample schedule</p>")).toBe(true);
    expect(html).toContain("<p><strong>Risks</strong></p><ul><li>UI Design is urgent.</li></ul>");
    expect(html.endsWith("<p><em>Composed by FORM from the project data.</em></p>")).toBe(true);
  });

  it("reads a custom line's text", () => {
    const line: BriefLine = { id: "bln_0000000000000000", key: "bln_0000000000000000", kind: "custom", runs: ["Our words."], composed: "", edited: null, stale: false };
    expect(lineText(line, project, ws)).toBe("Our words.");
  });
});

describe("a generated project", () => {
  const state = generated(150, { stepsPerTask: 3, predsMean: 1.5, people: 8 });
  const project = activeProject(state);

  it.each(["client", "team"] as const)("gives the %s brief unique ids, valid edit keys and mentions that resolve", (audience) => {
    for (const short of [false, true]) {
      const b = brief(state, audience, short);
      const lines = linesOf(b);
      expect(new Set(lines.map((l) => l.id)).size).toBe(lines.length);
      for (const l of lines) {
        expect(BriefEditKey.safeParse(l.key).success, l.key).toBe(true);
        for (const r of l.runs) {
          if (typeof r === "string") continue;
          if ("task" in r) expect(Object.hasOwn(project.tasks, r.task)).toBe(true);
          else expect(Object.hasOwn(state.workspace.people, r.person)).toBe(true);
        }
        expect(l.composed.length).toBeGreaterThan(0);
      }
    }
  });
});
