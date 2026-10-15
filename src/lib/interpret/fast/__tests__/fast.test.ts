// The fast parser's own rules (plan §8.4): Q17 tiers, the §9.2 result shapes, minted ids, the
// changes from v0 ("N weeks", weekly capacities, addView only when missing, setFocus, proposal ids),
// the honest breakdown caption and the runner's command. Parity with v0 is the golden corpus
// (test/golden/parser.golden.test.ts); the palette is test/golden/palette.test.ts.
import { describe, expect, it } from "vitest";
import { breakdownFor } from "@/lib/demo/library";
import { addSampleTeam, createDemoProject } from "@/lib/demo/seed";
import { seededMinter } from "@/lib/domain/ids";
import { idIndex } from "@/lib/ops/registry/_helpers";
import { type FastContext, type FastResult, fastParse, paletteKey, replacesProject, toCommand } from "@/lib/interpret/fast";
import { type Command, runCommand } from "@/lib/ops/command";
import type { Op } from "@/lib/ops/build";
import { paletteEntries } from "@/lib/ops/palette";
import type { FixtureName } from "@/lib/ops/registry/_contract";
import type { ProjectDoc, TaskId } from "@/lib/domain/schema";
import { FIXTURE_NOW, FIXTURE_TODAY, taskByTitle } from "../../../../../test/fixtures/v2/build";
import { namedFixture, type NamedFixture } from "../../../../../test/fixtures/v2/named";

const PALETTE = new Set(paletteEntries().map((e) => paletteKey(e.phrase)));

function ctxOf(f: NamedFixture, o: { selected?: string; view?: ProjectDoc["views"][number]; seed?: number } = {}): FastContext {
  const project = f.projectId !== null ? f.projects[f.projectId] : null;
  const selectedTaskId = o.selected && project ? taskByTitle(project, o.selected).id : f.selectedTaskId;
  return {
    ws: f.workspace,
    project,
    projects: Object.values(f.projects),
    local: { activeView: o.view ?? project?.views[0] ?? "cards", selectedTaskId, timelineZoom: "day" },
    selectedTaskId,
    mint: seededMinter(o.seed ?? 1),
    today: FIXTURE_TODAY,
    palette: PALETTE,
    breakdown: breakdownFor,
    demo: { createProject: createDemoProject, sampleTeam: addSampleTeam },
  };
}

const parse = (say: string, fixture: FixtureName, o?: Parameters<typeof ctxOf>[1]) => fastParse(say, ctxOf(namedFixture(fixture), o));

function matched(r: FastResult) {
  if (r.status !== "matched" || "control" in r) throw new Error(`Expected a matched intent, got ${JSON.stringify(r)}`);
  return r;
}

const ops = (r: FastResult): Op[] => matched(r).ops;
const opOf = <N extends Op["op"]>(r: FastResult, name: N) => ops(r).find((o): o is Extract<Op, { op: N }> => o.op === name);

/** Runs a parse on its fixture and returns the caption */
function captionOf(say: string, f: NamedFixture, o?: Parameters<typeof ctxOf>[1]): string | undefined {
  const ctx = ctxOf(f, o);
  const cmd = toCommand(fastParse(say, ctx), say) as Command;
  let n = 0;
  const r = runCommand({ workspace: f.workspace, projects: f.projects }, cmd, {
    now: FIXTURE_NOW,
    actorId: null,
    projectId: f.projectId,
    local: ctx.local,
    today: FIXTURE_TODAY,
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  });
  return r.caption?.text;
}

describe("confidence tiers (Q17)", () => {
  it("is 1 for an exact palette phrase, whatever its case and closing punctuation", () => {
    expect(matched(parse("Add a timeline", "demo")).confidence).toBe(1);
    expect(matched(parse("  add a TIMELINE!! ", "demo")).confidence).toBe(1);
  });

  it("is 0.9 for an anchored template that covers the whole command", () => {
    expect(matched(parse("Remove the board", "generated60")).confidence).toBe(0.9);
    expect(matched(parse("Accept them", "demoProposal")).confidence).toBe(0.9);
    expect(matched(parse("Add to the team brief under risks: copy is late", "demo")).confidence).toBe(0.9);
  });

  it("is 0.5 for a keyword rule", () => {
    expect(matched(parse("Show it as a kanban", "demo")).confidence).toBe(0.5);
    expect(matched(parse("yes, go on then", "demoProposal")).confidence).toBe(0.5);
  });

  it("is 1 for a control word, which carries no ops", () => {
    expect(parse("undo", "demo")).toEqual({ status: "matched", confidence: 1, control: "undo" });
    expect(parse("Reset the demo", "demo")).toEqual({ status: "matched", confidence: 1, control: "reset" });
  });
});

describe("result shapes (§9.2)", () => {
  it("answers 'none' with v0's unsupported wording", () => {
    expect(parse("Compare the two options", "demo")).toEqual({
      status: "none",
      reply: { tone: "unsupported", text: "Comparison tools aren't in this build yet — the project tracker is the live tool family." },
    });
    expect(parse("Make it fly", "demoSelected")).toMatchObject({ status: "none", reply: { text: expect.stringContaining("I understood you mean UI Design") } });
  });

  it("asks back with v0's clarify wording and no ops", () => {
    const r = matched(parse("Tidy up the moodboard", "demo"));
    expect(r.ops).toEqual([]);
    expect(r.reply).toEqual({ tone: "clarify", text: "Add a few references first — drop images onto the moodboard, or add notes and colours." });
    expect(toCommand(r, "Tidy up the moodboard")).toBeNull();
  });

  it("turns a match into the runner's command, and nothing else", () => {
    const r = parse("Add a board", "demo");
    expect(toCommand(r, "Add a board")).toMatchObject({ ops: [{ op: "addView", view: "board" }], local: [{ kind: "show", view: "board" }], source: "direct", text: "Add a board" });
    expect(toCommand(parse("redo", "demo"), "redo")).toBeNull();
    expect(toCommand(parse("Make it purple", "demo"), "Make it purple")).toBeNull();
  });
});

describe("ids", () => {
  it("are minted with ctx.mint: the same seed gives the same result, and every id is fresh", () => {
    const f = namedFixture("demo");
    const say = "Add Giulia and Paolo to the team";
    const a = fastParse(say, ctxOf(f, { seed: 9 }));
    expect(fastParse(say, ctxOf(f, { seed: 9 }))).toEqual(a);
    expect(fastParse(say, ctxOf(f, { seed: 10 }))).not.toEqual(a);
    const taken = idIndex(f.workspace);
    for (const op of ops(a)) if (op.op === "addPerson") expect(taken.has(op.personId)).toBe(false);
  });

  it("name the pending proposal in its follow-ups", () => {
    const f = namedFixture("demoPlan");
    const id = f.projects[f.projectId!].proposal!.id;
    expect(ops(fastParse("Accept the plan", ctxOf(f)))).toEqual([{ op: "acceptProposal", proposalId: id }]);
    expect(ops(fastParse("no", ctxOf(f)))).toEqual([{ op: "discardProposal", proposalId: id }]);
  });
});

describe("changes from v0 (plan §8.4)", () => {
  it('reads "N weeks" as N × 5 working days', () => {
    expect(opOf(parse("It takes 3 weeks", "demoSelected"), "updateTask")).toMatchObject({ field: "estimateDays", value: 15 });
    expect(opOf(parse("It takes 1.5 weeks", "demoSelected"), "updateTask")).toMatchObject({ value: 7.5 });
    expect(opOf(parse("Set the estimate to 2w", "demoSelected"), "updateTask")).toMatchObject({ value: 10 });
    expect(opOf(parse("It takes 4 days", "demoSelected"), "updateTask")).toMatchObject({ value: 4 });
  });

  it("reads capacities as days a week, in half days, and asks back past 7", () => {
    expect(matched(parse("Set Marta's capacity to 8 days", "demo")).reply).toEqual({ tone: "clarify", text: "Capacity is days per week, up to 7." });
    expect(opOf(parse("Marta has 2.3 days a week", "demo"), "updatePerson")).toMatchObject({ field: "capacityDaysPerWeek", value: 2.5 });
  });

  it("adds people with no capacity unless the command names one within the week, and makes them members", () => {
    const none = parse("Add Giulia to the team as a designer", "demo");
    expect(opOf(none, "addPerson")).toMatchObject({ name: "Giulia", role: "Designer", capacityDaysPerWeek: null });
    expect(opOf(none, "addMember")!.personId).toBe(opOf(none, "addPerson")!.personId);
    expect(opOf(parse("Add Giulia to the team with 3 days", "demo"), "addPerson")).toMatchObject({ capacityDaysPerWeek: 3 });
    expect(opOf(parse("Add Giulia to the team with 9 days", "demo"), "addPerson")).toMatchObject({ capacityDaysPerWeek: null });
    expect(captionOf("Add Giulia to the team", namedFixture("demo"))).toContain("Giulia added to the team · capacity not set");
  });

  it("adds a view only when the project lacks it, and always shows it", () => {
    expect(matched(parse("Add the tracker", "demo"))).toMatchObject({ ops: [], local: [{ kind: "show", view: "cards" }] });
    expect(matched(parse("Add a board", "demo"))).toMatchObject({ ops: [{ op: "addView", view: "board" }], local: [{ kind: "show", view: "board" }] });
  });

  it("pins Focus with setFocus, and hands the pick back to FORM", () => {
    const f = namedFixture("demo");
    const dev = taskByTitle(f.projects[f.projectId!], "Development").id;
    expect(opOf(parse("Focus on Development", "demo"), "setFocus")).toEqual({ op: "setFocus", taskId: dev });
    expect(opOf(parse("What should I work on now?", "demo"), "setFocus")).toEqual({ op: "setFocus", taskId: null });
  });

  it("opens a side-effect view only when it isn't on screen", () => {
    expect(matched(parse("Sara has 3 days a week", "demo", { view: "cards" })).local).toEqual([{ kind: "show", view: "team" }]);
    const onTeam = namedFixture("demo");
    const p = onTeam.projects[onTeam.projectId!];
    const withTeam = { ...onTeam, projects: { [p.id]: { ...p, views: ["cards", "team"] as ProjectDoc["views"] } } };
    expect(matched(fastParse("Sara has 3 days a week", ctxOf(withTeam, { view: "team" }))).local).toEqual([]);
  });

  it("chains a new task after the last one when the project chains its work", () => {
    const f = namedFixture("demo");
    const dev = taskByTitle(f.projects[f.projectId!], "Development").id;
    expect(opOf(parse("Add a task called Copywriting", "demo"), "addTask")).toMatchObject({ title: "Copywriting", place: "end", dependsOn: [dev] });
  });

  it("edits a named step: title, done and estimate; nothing else", () => {
    const f = namedFixture("demo");
    const p = f.projects[f.projectId!];
    const ui = taskByTitle(p, "UI Design");
    const qa = { id: "stp_0000000000qapass" as never, title: "QA pass", done: false, ownerId: null, estimateDays: null };
    const withStep = { ...f, projects: { [p.id]: { ...p, tasks: { ...p.tasks, [ui.id]: { ...ui, steps: [qa] } } } } };
    const ctx = ctxOf(withStep);
    expect(ops(fastParse("Mark QA pass done", ctx))).toEqual([{ op: "updateStep", taskId: ui.id, stepId: qa.id, field: "done", value: true }]);
    expect(ops(fastParse("QA pass takes 2 days", ctx))).toEqual([{ op: "updateStep", taskId: ui.id, stepId: qa.id, field: "estimateDays", value: 2 }]);
    expect(ops(fastParse("Delete the QA pass step", ctx))).toEqual([{ op: "removeStep", taskId: ui.id, stepId: qa.id }]);
    expect(fastParse("Make QA pass urgent", ctx).status).toBe("none");
  });

  it("keeps a title of spaces out of a rename, and names an empty new task", () => {
    expect(parse('Rename it to "  "', "demoSelected").status).toBe("none");
    expect(opOf(parse('Add a task called "  "', "demo"), "addTask")).toMatchObject({ title: "New task" });
  });
});

describe("the breakdown caption is honest (Q20)", () => {
  /** The demo with UI Design's estimate set */
  function withEstimate(days: number | null): NamedFixture {
    const f = namedFixture("demo");
    const p = f.projects[f.projectId!];
    const ui = taskByTitle(p, "UI Design");
    return { ...f, projects: { [p.id]: { ...p, tasks: { ...p.tasks, [ui.id as TaskId]: { ...ui, estimateDays: days } } } } };
  }

  it.each([2, 2.5, 5, 6, 7.5, 13, 40])("says the steps fit a %sd estimate, and they add up to it", (days) => {
    const f = withEstimate(days);
    const proposal = opOf(fastParse("Break UI Design into smaller steps", ctxOf(f)), "proposeSubtasks")!;
    expect(proposal.items.reduce((s, i) => s + (i.estimateDays ?? 0), 0)).toBe(days);
    expect(captionOf("Break UI Design into smaller steps", f)).toBe(`4 steps proposed for UI Design · fits its ${days}d estimate. Review them on the task.`);
  });

  it.each([null, 0.5, 1, 1.5])("says there are no estimates for %s days (fewer half days than steps)", (days) => {
    const f = withEstimate(days);
    expect(captionOf("Break UI Design into smaller steps", f)).toBe("4 steps proposed for UI Design · no estimates. Review them on the task.");
  });
});

describe("replacesProject (moved from v0 lib/views)", () => {
  it.each([
    ["create a new project", true],
    ["set up a project for the launch", true],
    ["new project", true],
    ["create a timeline for my project", false],
    ["create a project tracker for my new website", false],
    ["add a task called new project", false],
  ])("%s → %s", (say, replaces) => {
    expect(replacesProject(say)).toBe(replaces);
  });
});
