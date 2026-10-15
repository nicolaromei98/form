// The step 10b ops (plan §11 row 10): views, blocks, setFocus and the brief. For each op: the
// happy path with its exact caption, the no-op (same reference plus noopCaption), every rejection
// it can produce, and undo by patches. Then the completeness checks on a fixture that holds brief
// content, and properties 1–9 over this family's ops (the brief ops that no named fixture can
// sample yet sit out of reducer.property.test.ts, so this run covers them).
import fc from "fast-check";
import { applyPatches, type Patch } from "immer";
import { describe, expect, it } from "vitest";
import { seededMinter } from "@/lib/domain/ids";
import { checkProject, docBytes } from "@/lib/domain/invariants/check";
import { BRIEF_BASIS, BRIEF_LINES_MAX, BRIEF_SENT_MAX, BRIEF_TEXT_MAX, DOC_BYTES_MAX } from "@/lib/domain/limits";
import { compareKeys, keyAfter, sortedByOrder } from "@/lib/domain/order";
import type { BriefLineId, SnapshotId, TaskId } from "@/lib/domain/schema/ids";
import { defaultLocalViewState } from "@/lib/domain/schema/local";
import type { BlockKind, ViewKind } from "@/lib/domain/schema/primitives";
import { type ProjectDoc, ProjectDocSchema } from "@/lib/domain/schema/project";
import type { CaptionPlanning } from "@/lib/ops/caption-env";
import { applyOp } from "@/lib/ops/reduce";
import { type OpName, REGISTRY } from "@/lib/ops/registry";
import { FIXTURE_NOW, generated, makeTask, taskByTitle } from "../../../../../test/fixtures/v2/build";
import { type NamedFixture, docsOf, namedFixture } from "../../../../../test/fixtures/v2/named";
import { materialise } from "../../../../../test/property/materialise";
import {
  apply,
  captionOf,
  deepFreeze,
  expectApplied,
  expectInverse,
  expectNoop,
  expectRejection,
  projectOf,
  reduceCtx,
  run,
  type TestState,
  withDoc,
} from "./support";

const mint = seededMinter(1010);
const project = (s: TestState) => projectOf(s);
const after = (r: { result: { doc: unknown } }) => r.result.doc as ProjectDoc;
const fixture = (name: Parameters<typeof namedFixture>[0]): TestState => deepFreeze(namedFixture(name));
const demo = () => fixture("demo");
const id = (s: TestState, title: string): TaskId => taskByTitle(project(s), title).id;

/** Mood items bottom to top */
const sortedByZ = (p: ProjectDoc) => Object.values(p.moodboard.items).sort((a, b) => compareKeys(a.z, b.z));

/** A state whose active project is edited by `edit` */
function edited(state: TestState, edit: (p: ProjectDoc) => ProjectDoc): TestState {
  return deepFreeze(withDoc(state, edit(project(state))));
}

/* ------------------------------------------------------------------
   Brief content: two edits and two lines, one of each per audience
   ------------------------------------------------------------------ */

const L1 = mint("briefLine");
const L2 = mint("briefLine");
const CLIENT_EDIT = "client:head:status";

/** The state with brief content in its active project; the team edit names the first task */
function withBrief<S extends TestState>(state: S): S {
  const p = projectOf(state);
  const first = sortedByOrder(p.tasks)[0]?.id ?? "none";
  const brief = {
    ...p.brief,
    edits: {
      ...p.brief.edits,
      [CLIENT_EDIT]: { text: "All good this week.", basis: "On track." },
      [`team:moving:${first}`]: { text: "", basis: "Research is done." },
    },
    lines: [
      ...p.brief.lines,
      { id: L1, audience: "client" as const, section: "next" as const, text: "Homepage preview on Friday." },
      { id: L2, audience: "team" as const, section: "risks" as const, text: "Copy is late." },
    ],
  };
  return { ...state, projects: { ...state.projects, [p.id]: { ...p, brief } } } as S;
}

const briefDemo = (): TestState => deepFreeze(withBrief(namedFixture("demo")));
const teamEdit = (s: TestState) => `team:moving:${sortedByOrder(project(s).tasks)[0].id}`;

/**
 * The state padded with hidden brief edits until its project is exactly `DOC_BYTES_MAX - slack`
 * bytes of JSON, so an op that adds more than `slack` bytes passes the 1 MB limit.
 */
function nearlyFull(state: TestState, slack: number): TestState {
  const p = project(state);
  const target = DOC_BYTES_MAX - slack;
  const edits: Record<string, { text: string; basis: string }> = { ...p.brief.edits };
  const doc = (): ProjectDoc => ({ ...p, brief: { ...p.brief, edits } });
  const key = (n: number) => `client:pad:${String(n).padStart(4, "0")}`;
  const full = "y".repeat(BRIEF_BASIS);
  let n = 0;
  edits[key(n++)] = { text: "", basis: full };
  const one = docBytes(doc());
  edits[key(n++)] = { text: "", basis: full };
  // Every further entry of the same shape costs the same: `,"client:pad:0002":{"text":"","basis":"yyy…"}`
  const per = docBytes(doc()) - one;
  let room = target - one - per;
  for (; room > per; room -= per) edits[key(n++)] = { text: "", basis: full };
  // The last bytes: a shorter entry, or the text of the last full one when not even an empty entry fits
  const overhead = per - BRIEF_BASIS;
  if (room >= overhead) edits[key(n)] = { text: "", basis: "y".repeat(room - overhead) };
  else edits[key(n - 1)] = { text: "t".repeat(room), basis: full };
  const padded = doc();
  expect(docBytes(padded)).toBe(target);
  return deepFreeze(withDoc(state, padded));
}

/* ------------------------------------------------------------------
   addView
   ------------------------------------------------------------------ */

describe("addView", () => {
  const add = (view: string) => ({ op: "addView", view });

  it("appends a view, so existing tabs never move, and says so", () => {
    const s = demo();
    const r = apply(s, add("timeline"));
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).views).toEqual(["cards", "timeline"]);
    expect(after(apply(withDoc(s, after(r)), add("board"))).views).toEqual(["cards", "timeline", "board"]);
    expect(captionOf(s, add("timeline"))).toBe("Timeline view added");
    expect(REGISTRY.get("addView")!.activity).toBe("show");
  });

  it("folds its part into the show caption (announceView)", () => {
    const s = demo();
    const show = (view: ViewKind) => ({ local: [{ kind: "show" as const, view }] });
    expect(captionOf(s, add("timeline"), show("timeline"))).toBe("Timeline view added · sample dates, sequenced from estimates");
    expect(captionOf(s, add("board"), show("board"))).toBe("Board view added");
    expect(captionOf(s, add("brief"), show("brief"))).toBe("Brief view added · for the client · composed from the project, nothing invented");
    // Undoing the command removes the tab: the runner records the local state before it
    const result = run(s, [add("board")], show("board"));
    expect(result.local.activeView).toBe("board");
    expect(result.addedViews).toEqual(["board"]);
  });

  it("is a no-op for a view the project has, which lets the show caption speak alone", () => {
    const s = demo();
    const r = apply(s, add("cards"));
    expectNoop(r.result, r.before);
    expect(REGISTRY.get("addView")!.idempotent).toBe(true);
    // noopCaption is null: alone, the no-op says nothing
    expect(captionOf(s, add("cards"))).toBeNull();
    expect(run(s, [add("cards")], { local: [{ kind: "show", view: "cards" }] }).caption).toEqual({ text: "Tracker", tone: "info", undoable: false });
    const all = fixture("generated60");
    const again = apply(all, add("focus"));
    expectNoop(again.result, again.before);
  });

  it("refuses an unknown view, and a project op with no project", () => {
    expectRejection(apply(demo(), add("gantt")).result, "invalid_payload");
    expectRejection(apply(demo(), { op: "addView" }).result, "invalid_payload");
    const none = run(fixture("empty"), [add("board")]);
    expectRejection(none.outcomes[0].result, "no_project");
  });
});

/* ------------------------------------------------------------------
   removeView
   ------------------------------------------------------------------ */

describe("removeView", () => {
  const remove = (view: string) => ({ op: "removeView", view });

  it("closes a tab and keeps everything in the project", () => {
    const s = fixture("generated60");
    const r = apply(s, remove("board"));
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).views).toEqual(["cards", "timeline", "team", "focus", "brief"]);
    expect(after(r).tasks).toBe(project(s).tasks);
    expect(captionOf(s, remove("board"))).toBe("Board view removed · nothing in the project is deleted");
  });

  it("hands the screen to the left neighbour when the removed view was on it", () => {
    const s = fixture("generated60");
    const local = { ...defaultLocalViewState(project(s)), activeView: "team" as const };
    expect(run(s, [remove("team")], { ctx: { local } }).local.activeView).toBe("timeline");
    const first = { ...local, activeView: "cards" as const };
    expect(run(s, [remove("cards")], { ctx: { local: first } }).local.activeView).toBe("board");
  });

  it("is a no-op for a view the project doesn't have", () => {
    const s = demo();
    const r = apply(s, remove("board"));
    expectNoop(r.result, r.before);
    expect(captionOf(s, remove("board"))).toBe("There's no Board view in this project");
    const once = withDoc(fixture("generated60"), after(apply(fixture("generated60"), remove("board"))));
    const again = apply(once, remove("board"));
    expectNoop(again.result, again.before);
    expect(REGISTRY.get("removeView")!.idempotent).toBe(true);
  });

  it("never removes the last view", () => {
    const s = demo();
    const r = expectRejection(apply(s, remove("cards")).result, "last_view");
    expect(r.message).toBe("The Tracker is this project's only view · add another before removing it.");
    expect(captionOf(s, remove("cards"))).toBe("Couldn't apply that: The Tracker is this project's only view · add another before removing it.");
    expectRejection(apply(s, remove("kanban")).result, "invalid_payload");
  });
});

/* ------------------------------------------------------------------
   setFocus
   ------------------------------------------------------------------ */

describe("setFocus", () => {
  const focus = (taskId: TaskId | null) => ({ op: "setFocus", taskId });
  /** A planning stand-in for captions: the pin when there is one, else UI Design for its priority */
  const planning: CaptionPlanning = {
    plan: () => null,
    lanes: () => [],
    focus: (p) => {
      const pin = p.viewConfig.focusPin;
      if (pin) return { pick: { taskId: pin, chosenBy: "you", reasons: [] } };
      return { pick: { taskId: taskByTitle(p, "UI Design").id, chosenBy: "form", reasons: [{ text: "Urgent priority" }] } };
    },
  };

  it("pins the task Focus shows, as view config hidden from Activity", () => {
    const s = demo();
    const r = apply(s, focus(id(s, "Development")));
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).viewConfig.focusPin).toBe(id(s, "Development"));
    expect(captionOf(s, focus(id(s, "Development")))).toBe("Focus · Development");
    expect(REGISTRY.get("setFocus")!.activity).toBe("hide");
  });

  it("hands the choice back to FORM with null", () => {
    const pinned = edited(demo(), (p) => ({ ...p, viewConfig: { ...p.viewConfig, focusPin: taskByTitle(p, "Development").id } }));
    const r = apply(pinned, focus(null));
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).viewConfig.focusPin).toBeNull();
    expect(captionOf(pinned, focus(null))).toBe("Focus · FORM picks the next task");
    // "What should I work on now?": the show caption names FORM's pick and replaces the op's part
    expect(captionOf(pinned, focus(null), { local: [{ kind: "show", view: "focus" }], ctx: { planning } })).toBe(
      "Focus · UI Design — urgent priority",
    );
  });

  it("reads as one part with the show caption, and as the announcement when Focus is new", () => {
    const s = demo();
    const ops = [{ op: "addView", view: "focus" }, focus(id(s, "Development"))];
    const result = run(s, ops, { local: [{ kind: "show", view: "focus" }], ctx: { planning } });
    expect(result.caption?.text).toBe("Focus view added · Development");
    expect(project({ ...s, projects: result.state.projects as TestState["projects"] }).views).toEqual(["cards", "focus"]);
  });

  it("is a no-op on the same pin, and says nothing when there is no pin to clear", () => {
    const s = demo();
    const dev = id(s, "Development");
    const once = withDoc(s, after(apply(s, focus(dev))));
    const again = apply(once, focus(dev));
    expectNoop(again.result, again.before);
    expect(captionOf(once, focus(dev))).toBe("Focus is already on Development");
    const clear = apply(s, focus(null));
    expectNoop(clear.result, clear.before);
    expect(captionOf(s, focus(null))).toBeNull();
    expect(REGISTRY.get("setFocus")!.idempotent).toBe(true);
  });

  it("refuses a task that isn't in the project", () => {
    const s = demo();
    const r = expectRejection(apply(s, focus(mint("task"))).result, "not_found");
    expect(r.message).toBe("That task isn't in this project anymore.");
    expectRejection(apply(s, { op: "setFocus" }).result, "invalid_payload");
    expectRejection(apply(s, { op: "setFocus", taskId: "Development" }).result, "invalid_payload");
  });
});

/* ------------------------------------------------------------------
   addBlock
   ------------------------------------------------------------------ */

describe("addBlock", () => {
  const add = (block: BlockKind) => ({ op: "addBlock", block });
  const blocks = (s: TestState) => project(s).blocks;

  it("shows a block in its canonical place", () => {
    const s = demo();
    const r = apply(s, add("progress"));
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).blocks).toEqual(["header", "metrics", "progress", "collection"]);
    expect(captionOf(s, add("progress"))).toBe("Project progress indicator added");

    const withActivity = withDoc(s, after(apply(s, add("activity"))));
    const withBudget = withDoc(withActivity, after(apply(withActivity, add("budget"))));
    expect(blocks(withBudget)).toEqual(["header", "metrics", "collection", "budget", "activity"]);
    expect(after(apply(withBudget, add("moodboard"))).blocks).toEqual(["header", "metrics", "collection", "moodboard", "budget", "activity"]);
    expect(captionOf(s, add("activity"))).toBe("Activity added");
    expect(captionOf(s, add("budget"))).toBe("Budget added");
  });

  it("says what a moodboard holds when it comes back", () => {
    expect(captionOf(demo(), add("moodboard"))).toBe("Moodboard added · drop, paste or browse images");
    const hidden = edited(fixture("demoMood3"), (p) => ({ ...p, blocks: ["header", "metrics", "collection"] }));
    expect(captionOf(hidden, add("moodboard"))).toBe("Moodboard back · 3 references");
    const noMetrics = edited(demo(), (p) => ({ ...p, blocks: ["header", "collection"] }));
    expect(captionOf(noMetrics, add("metrics"))).toBe("Metrics added");
  });

  it("is a no-op for a block already shown", () => {
    const s = demo();
    const r = apply(s, add("metrics"));
    expectNoop(r.result, r.before);
    expect(captionOf(s, add("metrics"))).toBe("The metrics are already shown");
    expect(captionOf(s, add("header"))).toBe("The project header is always shown");
    expect(captionOf(s, add("collection"))).toBe("The tasks are always shown");
    expect(captionOf(fixture("demoMood3"), add("moodboard"))).toBe("The moodboard is already shown");
    expect(REGISTRY.get("addBlock")!.idempotent).toBe(true);
  });

  it("refuses an unknown block", () => {
    expectRejection(apply(demo(), { op: "addBlock", block: "gallery" }).result, "invalid_payload");
  });
});

/* ------------------------------------------------------------------
   removeBlock
   ------------------------------------------------------------------ */

describe("removeBlock", () => {
  const remove = (block: BlockKind) => ({ op: "removeBlock", block });

  it("hides the moodboard and keeps its references", () => {
    const s = fixture("demoMood3");
    const r = apply(s, remove("moodboard"));
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).blocks).toEqual(["header", "metrics", "collection"]);
    expect(after(r).moodboard).toBe(project(s).moodboard);
    expect(captionOf(s, remove("moodboard"))).toBe("Moodboard hidden · its 3 references are kept");
    const one = edited(s, (p) => {
      const first = sortedByZ(p)[0];
      return { ...p, moodboard: { items: { [first.id]: first } } };
    });
    expect(captionOf(one, remove("moodboard"))).toBe("Moodboard hidden · its 1 reference is kept");
    expect(captionOf(fixture("demoMoodShown"), remove("moodboard"))).toBe("Moodboard hidden");
  });

  it("hides the other blocks in the v0 wording", () => {
    const s = edited(demo(), (p) => ({ ...p, blocks: ["header", "metrics", "progress", "collection", "budget", "activity"] }));
    expect(captionOf(s, remove("metrics"))).toBe("Metrics removed");
    expect(captionOf(s, remove("progress"))).toBe("Progress hidden");
    expect(captionOf(s, remove("budget"))).toBe("Budget hidden");
    expect(captionOf(s, remove("activity"))).toBe("Activity hidden");
    // "Hide the progress" hides the bars and the indicator: one part
    expect(run(s, [{ op: "setView", patch: { fields: { progress: false } } }, remove("progress")]).caption?.text).toBe("Progress hidden");
  });

  it("is a no-op for a block already hidden", () => {
    const s = demo();
    const r = apply(s, remove("moodboard"));
    expectNoop(r.result, r.before);
    expect(captionOf(s, remove("moodboard"))).toBe("The moodboard is already hidden");
    expect(captionOf(s, remove("progress"))).toBe("The progress indicator is already hidden");
    expect(REGISTRY.get("removeBlock")!.idempotent).toBe(true);
  });

  it("never hides the header or the tasks", () => {
    const s = demo();
    expect(expectRejection(apply(s, remove("header")).result, "protected_block").message).toBe("The project header always stays on the page.");
    expect(expectRejection(apply(s, remove("collection")).result, "protected_block").message).toBe("The tasks always stay on the page.");
    expect(captionOf(s, remove("collection"))).toBe("Couldn't apply that: The tasks always stay on the page.");
    expectRejection(apply(s, { op: "removeBlock", block: "sidebar" }).result, "invalid_payload");
  });
});

/* ------------------------------------------------------------------
   editBriefLine
   ------------------------------------------------------------------ */

describe("editBriefLine", () => {
  const edit = (key: string, text: string, basis: string) => ({ op: "editBriefLine", key, text, basis });
  const moving = (s: TestState) => `client:moving:${id(s, "UI Design")}`;
  const BASIS = "UI Design is 30% in, with Marta.";

  it("keeps the user's wording for a sentence, with FORM's wording as its basis", () => {
    const s = demo();
    const op = edit(moving(s), "UI Design is well under way.", BASIS);
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).brief.edits).toEqual({ [moving(s)]: { text: "UI Design is well under way.", basis: BASIS } });
    expect(captionOf(s, op)).toBe("Brief line edited");
    expect(captionOf(s, edit(moving(s), "", BASIS))).toBe("Brief line hidden");
    // People live in the workspace: a key naming one is never refused here
    expect(after(apply(s, edit("team:risks:load:per_demomarta", "Marta is busy.", "Marta is 4 days over capacity."))).brief.edits).toHaveProperty(
      ["team:risks:load:per_demomarta"],
    );
  });

  it("restores FORM's wording when the user writes it back", () => {
    const s = briefDemo();
    const r = apply(s, edit(CLIENT_EDIT, "On track.", " On track. "));
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).brief.edits).not.toHaveProperty([CLIENT_EDIT]);
    expect(captionOf(s, edit(CLIENT_EDIT, "On track.", "On track."))).toBe("FORM's wording restored");
  });

  it("is a no-op when the line already reads like that", () => {
    const s = briefDemo();
    const same = apply(s, edit(CLIENT_EDIT, "All good this week.", "On track."));
    expectNoop(same.result, same.before);
    expect(captionOf(s, edit(CLIENT_EDIT, "All good this week.", "On track."))).toBe("That line already reads like that");
    expect(captionOf(s, edit(teamEdit(s), "", "Research is done."))).toBe("That line is already hidden");
    const plain = apply(s, edit("client:next:up", "Next up: UI Design.", "Next up: UI Design."));
    expectNoop(plain.result, plain.before);
    expect(captionOf(s, edit("client:next:up", "Next up: UI Design.", "Next up: UI Design."))).toBe("That line already reads as FORM wrote it");
    expect(REGISTRY.get("editBriefLine")!.idempotent).toBe(true);
  });

  it("refuses a sentence about a task or step the project doesn't have", () => {
    const s = demo();
    const r = expectRejection(apply(s, edit(`client:moving:${mint("task")}`, "Gone.", "Gone.")).result, "not_found");
    expect(r.message).toBe("That sentence's task isn't in this project anymore.");
    expectRejection(apply(s, edit(`team:next:step:${mint("step")}`, "Gone.", "Next step.")).result, "not_found");
    const g = fixture("generated60");
    const step = sortedByOrder(project(g).tasks).find((t) => t.steps.length > 0)!.steps[0].id;
    expectApplied(apply(g, edit(`team:next:step:${step}`, "Then the next step.", "Next step.")).result);
  });

  it("refuses text that isn't one trimmed line, keys of no audience, and a document past 1 MB", () => {
    const s = demo();
    expectRejection(apply(s, edit(moving(s), " padded", BASIS)).result, "invalid_payload");
    expectRejection(apply(s, edit(moving(s), "two\nlines", BASIS)).result, "invalid_payload");
    expectRejection(apply(s, edit(moving(s), "x".repeat(BRIEF_TEXT_MAX + 1), BASIS)).result, "invalid_payload");
    expectRejection(apply(s, edit("boss:head:status", "Hi.", "Hello.")).result, "invalid_payload");

    // A new edit adds `,"client:head:focus":{"text":"…","basis":""}`: 43 bytes plus its text.
    // Exactly the room left still fits; one byte more doesn't.
    const room = 60;
    const full = nearlyFull(s, room);
    const applied = apply(full, edit("client:head:focus", "a".repeat(room - 43), ""));
    expectApplied(applied.result);
    expect(docBytes(after(applied))).toBe(DOC_BYTES_MAX);
    const r = expectRejection(apply(full, edit("client:head:focus", "a".repeat(room - 42), "")).result, "limit");
    expect(r.message).toBe("That would take the project past its 1 MB limit.");
  });
});

/* ------------------------------------------------------------------
   resetBriefLine
   ------------------------------------------------------------------ */

describe("resetBriefLine", () => {
  const reset = (...keys: string[]) => ({ op: "resetBriefLine", keys });

  it("restores FORM's wording on one line or several, skipping keys with no edit", () => {
    const s = briefDemo();
    const r = apply(s, reset(CLIENT_EDIT));
    expectInverse(r.before, expectApplied(r.result));
    expect(Object.keys(after(r).brief.edits)).toEqual([teamEdit(s)]);
    expect(captionOf(s, reset(CLIENT_EDIT))).toBe("FORM's wording restored");
    const all = apply(s, reset(teamEdit(s), "client:next:up", CLIENT_EDIT, CLIENT_EDIT));
    expect(after(all).brief.edits).toEqual({});
    expect(captionOf(s, reset(teamEdit(s), "client:next:up", CLIENT_EDIT))).toBe("FORM's wording restored on 2 lines");
  });

  it("is a no-op when no key has an edit", () => {
    const s = briefDemo();
    const r = apply(s, reset("client:next:up"));
    expectNoop(r.result, r.before);
    expect(captionOf(s, reset("client:next:up"))).toBe("That line already reads as FORM wrote it");
    expect(captionOf(s, reset("client:next:up", "team:next:up"))).toBe("Those lines already read as FORM wrote them");
    const once = withDoc(s, after(apply(s, reset(CLIENT_EDIT))));
    const again = apply(once, reset(CLIENT_EDIT));
    expectNoop(again.result, again.before);
  });

  it("takes one to 80 keys", () => {
    const s = briefDemo();
    expectRejection(apply(s, reset()).result, "invalid_payload");
    expectRejection(apply(s, reset(...Array.from({ length: 81 }, () => CLIENT_EDIT))).result, "invalid_payload");
    expectRejection(apply(s, reset("client head")).result, "invalid_payload");
  });
});

/* ------------------------------------------------------------------
   addBriefLine
   ------------------------------------------------------------------ */

describe("addBriefLine", () => {
  const add = (o: Record<string, unknown> = {}) => ({
    op: "addBriefLine",
    lineId: mint("briefLine"),
    audience: "client",
    section: "next",
    text: "Homepage preview on Friday.",
    ...o,
  });

  it("appends a line in the user's words, under a section of one audience's brief", () => {
    const s = briefDemo();
    const op = add({ audience: "team", section: "questions", text: "Who signs off the copy?" });
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).brief.lines.at(-1)).toEqual({ id: op.lineId, audience: "team", section: "questions", text: "Who signs off the copy?" });
    expect(after(r).brief.lines.slice(0, 2)).toEqual(project(s).brief.lines);
    expect(captionOf(s, add())).toBe("Added to the client brief · Next");
    expect(captionOf(s, op)).toBe("Added to the team brief · Open questions");
    expect(captionOf(s, add({ section: "moving" }))).toBe("Added to the client brief · In progress");
    expect(captionOf(s, add({ section: "note" }))).toBe("Added to the client brief · Note");
  });

  it("refuses a taken id, never re-minting it (not idempotent)", () => {
    const s = briefDemo();
    expectRejection(apply(s, add({ lineId: L1 })).result, "duplicate_id");
    const op = add();
    const once = withDoc(s, after(apply(s, op)));
    expect(REGISTRY.get("addBriefLine")!.idempotent).toBe(false);
    expectRejection(apply(once, op).result, "duplicate_id");
  });

  it("refuses an 81st line, empty or untrimmed text, and a document past 1 MB", () => {
    const lines = Array.from({ length: BRIEF_LINES_MAX }, (_, i) => ({
      id: mint("briefLine"),
      audience: "client" as const,
      section: "note" as const,
      text: `Line ${i + 1}.`,
    }));
    const s = edited(demo(), (p) => ({ ...p, brief: { ...p.brief, lines } }));
    expect(expectRejection(apply(s, add()).result, "limit").message).toBe("The brief holds at most 80 lines of your own.");
    expectRejection(apply(demo(), add({ text: "" })).result, "invalid_payload");
    expectRejection(apply(demo(), add({ text: " Friday " })).result, "invalid_payload");
    expectRejection(apply(demo(), add({ section: "later" })).result, "invalid_payload");
    expectRejection(apply(nearlyFull(briefDemo(), 50), add()).result, "limit");
  });
});

/* ------------------------------------------------------------------
   updateBriefLine
   ------------------------------------------------------------------ */

describe("updateBriefLine", () => {
  const update = (lineId: BriefLineId, text: string) => ({ op: "updateBriefLine", lineId, text });

  it("rewrites one of the user's lines in place", () => {
    const s = briefDemo();
    const r = apply(s, update(L1, "Homepage preview moves to Monday."));
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).brief.lines.map((l) => l.text)).toEqual(["Homepage preview moves to Monday.", "Copy is late."]);
    expect(captionOf(s, update(L1, "Homepage preview moves to Monday."))).toBe("Brief line updated");
  });

  it("is a no-op when the line already says that", () => {
    const s = briefDemo();
    const r = apply(s, update(L2, "Copy is late."));
    expectNoop(r.result, r.before);
    expect(captionOf(s, update(L2, "Copy is late."))).toBe("That line already says that");
    expect(REGISTRY.get("updateBriefLine")!.idempotent).toBe(true);
  });

  it("refuses a missing line, empty text (the producer removes the line instead) and a document past 1 MB", () => {
    const s = briefDemo();
    expect(expectRejection(apply(s, update(mint("briefLine"), "Hello.")).result, "not_found").message).toBe("That brief line isn't there anymore.");
    expectRejection(apply(s, update(L1, "")).result, "invalid_payload");
    const full = nearlyFull(s, 10);
    // Same length: no growth, so it fits; ten more characters than the room left don't
    expectApplied(apply(full, update(L1, "Homepage preview on Monday.")).result);
    expectRejection(apply(full, update(L1, `Homepage preview on Friday.${"!".repeat(11)}`)).result, "limit");
  });
});

/* ------------------------------------------------------------------
   removeBriefLine
   ------------------------------------------------------------------ */

describe("removeBriefLine", () => {
  const remove = (lineId: BriefLineId) => ({ op: "removeBriefLine", lineId });

  it("removes one of the user's lines", () => {
    const s = briefDemo();
    const r = apply(s, remove(L1));
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).brief.lines.map((l) => l.id)).toEqual([L2]);
    expect(captionOf(s, remove(L1))).toBe("Brief line removed");
  });

  it("refuses a line that isn't there, so removing twice is refused (not idempotent)", () => {
    const s = briefDemo();
    const once = withDoc(s, after(apply(s, remove(L2))));
    expect(expectRejection(apply(once, remove(L2)).result, "not_found").message).toBe("That brief line isn't there anymore.");
    expect(REGISTRY.get("removeBriefLine")!.idempotent).toBe(false);
    expectRejection(apply(s, remove("L2" as BriefLineId)).result, "invalid_payload");
  });
});

/* ------------------------------------------------------------------
   resetBrief
   ------------------------------------------------------------------ */

describe("resetBrief", () => {
  const reset = (audience: string) => ({ op: "resetBrief", audience });

  it("clears one audience's edits and lines, and leaves the other's", () => {
    const s = briefDemo();
    const r = apply(s, reset("client"));
    expectInverse(r.before, expectApplied(r.result));
    expect(Object.keys(after(r).brief.edits)).toEqual([teamEdit(s)]);
    expect(after(r).brief.lines.map((l) => l.id)).toEqual([L2]);
    expect(captionOf(s, reset("client"))).toBe("Your edits to the client brief are cleared · FORM's version");
    const team = apply(s, reset("team"));
    expect(Object.keys(after(team).brief.edits)).toEqual([CLIENT_EDIT]);
    expect(after(team).brief.lines.map((l) => l.id)).toEqual([L1]);
    expect(captionOf(s, reset("team"))).toBe("Your edits to the team brief are cleared · FORM's version");
  });

  it("never depends on record key order", () => {
    const s = edited(briefDemo(), (p) => ({ ...p, brief: { ...p.brief, edits: { ...p.brief.edits, "client:next:up": { text: "Then QA.", basis: "Next up." } } } }));
    const reversed = edited(s, (p) => ({ ...p, brief: { ...p.brief, edits: Object.fromEntries(Object.entries(p.brief.edits).reverse()) } }));
    const a = expectApplied(apply(s, reset("client")).result);
    const b = expectApplied(apply(reversed, reset("client")).result);
    expect(b.doc).toEqual(a.doc);
    expect(b.patches).toEqual(a.patches);
  });

  it("is a no-op when the brief is already FORM's version", () => {
    const s = demo();
    const r = apply(s, reset("client"));
    expectNoop(r.result, r.before);
    expect(captionOf(s, reset("client"))).toBe("The client brief is already FORM's version");
    const once = withDoc(briefDemo(), after(apply(briefDemo(), reset("team"))));
    expect(captionOf(once, reset("team"))).toBe("The team brief is already FORM's version");
    expect(REGISTRY.get("resetBrief")!.idempotent).toBe(true);
  });

  it("refuses an unknown audience", () => {
    expectRejection(apply(demo(), reset("board")).result, "invalid_payload");
  });
});

/* ------------------------------------------------------------------
   markBriefSent
   ------------------------------------------------------------------ */

describe("markBriefSent", () => {
  const sent = (audience: string, snapshotId: SnapshotId = mint("snapshot")) => ({ op: "markBriefSent", audience, snapshotId });

  it("records a reference to the sent brief, stamped with the commit time", () => {
    const s = demo();
    const op = sent("client");
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).brief.sent).toEqual([{ snapshotId: op.snapshotId, audience: "client", sentAt: FIXTURE_NOW }]);
    expect(captionOf(s, op)).toBe("Client brief marked as sent");
    expect(captionOf(s, sent("team"))).toBe("Team brief marked as sent");
  });

  it("refuses a snapshot already recorded (not idempotent)", () => {
    const s = demo();
    const op = sent("client");
    const once = withDoc(s, after(apply(s, op)));
    expectRejection(apply(once, op).result, "duplicate_id");
    expectRejection(apply(once, sent("team", op.snapshotId)).result, "duplicate_id");
    expect(REGISTRY.get("markBriefSent")!.idempotent).toBe(false);
  });

  it("keeps at most 200 references and stays within 1 MB", () => {
    const many = Array.from({ length: BRIEF_SENT_MAX }, () => ({ snapshotId: mint("snapshot"), audience: "team" as const, sentAt: FIXTURE_NOW }));
    const s = edited(demo(), (p) => ({ ...p, brief: { ...p.brief, sent: many } }));
    expect(expectRejection(apply(s, sent("client")).result, "limit").message).toBe("A project keeps at most 200 sent briefs.");
    expectRejection(apply(nearlyFull(demo(), 40), sent("client")).result, "limit");
    expectRejection(apply(demo(), sent("client", mint("briefLine") as unknown as SnapshotId)).result, "invalid_payload");
  });
});

/* ------------------------------------------------------------------
   setBriefSharing
   ------------------------------------------------------------------ */

describe("setBriefSharing", () => {
  const share = (value: unknown, field = "showBudgetToClient") => ({ op: "setBriefSharing", field, value });

  it("shows or hides the budget in the client's brief", () => {
    const s = demo();
    const r = apply(s, share(true));
    expectInverse(r.before, expectApplied(r.result));
    expect(after(r).brief.sharing).toEqual({ showBudgetToClient: true });
    expect(captionOf(s, share(true))).toBe("Budget shown to the client");
    expect(captionOf(withDoc(s, after(r)), share(false))).toBe("Budget hidden from the client");
  });

  it("is a no-op on the current value", () => {
    const s = demo();
    const r = apply(s, share(false));
    expectNoop(r.result, r.before);
    expect(captionOf(s, share(false))).toBe("The budget is already hidden from the client");
    const shown = withDoc(s, after(apply(s, share(true))));
    expect(captionOf(shown, share(true))).toBe("The budget is already shown to the client");
    expect(REGISTRY.get("setBriefSharing")!.idempotent).toBe(true);
  });

  it("refuses another field or a value that isn't a flag", () => {
    expectRejection(apply(demo(), share(true, "showCostsToClient")).result, "invalid_payload");
    expectRejection(apply(demo(), share("yes")).result, "invalid_payload");
  });
});

/* ------------------------------------------------------------------
   The family as a whole
   ------------------------------------------------------------------ */

const FAMILY = [
  "addView",
  "removeView",
  "setFocus",
  "addBlock",
  "removeBlock",
  "editBriefLine",
  "resetBriefLine",
  "addBriefLine",
  "updateBriefLine",
  "removeBriefLine",
  "resetBrief",
  "markBriefSent",
  "setBriefSharing",
] as const satisfies readonly OpName[];

describe("the 10b family", () => {
  it("folds in the v0 names it covers (plan §4.5)", () => {
    const deprecates = Object.fromEntries(FAMILY.map((n) => [n, REGISTRY.get(n)!.deprecates]));
    expect(deprecates).toEqual({
      addView: ["setRepresentation"],
      removeView: ["removeView"],
      setFocus: ["setView"],
      addBlock: ["addBlock"],
      removeBlock: ["removeBlock"],
      editBriefLine: ["editBriefLine"],
      resetBriefLine: ["resetBriefLine"],
      addBriefLine: ["addBriefLine"],
      updateBriefLine: ["updateBriefLine"],
      removeBriefLine: ["removeBriefLine"],
      resetBrief: ["resetBrief"],
      markBriefSent: [],
      setBriefSharing: [],
    });
  });

  // The completeness checks (plan §4.3 item 3) on the sample fixtures plus brief content, which
  // also covers the ops whose samples no named fixture can apply yet
  describe.each(FAMILY.map((n) => [n] as const))("%s, with brief content", (name) => {
    const def = REGISTRY.get(name)!;
    const base = namedFixture(def.sampleOn ?? "demo");
    const state: NamedFixture = deepFreeze({ ...withBrief(base), name: base.name, selectedTaskId: base.selectedTaskId });
    const sample = def.sample(docsOf(state), seededMinter(1));

    it("has a strict schema", () => {
      expect(def.schema.safeParse(sample).success).toBe(true);
      expect(def.schema.safeParse({ ...sample, unexpected: true }).success).toBe(false);
      expect(def.schema.safeParse({ op: name }).success).toBe(false);
    });

    it("applies its sample with a 1–280 character caption", () => {
      const result = run(state, [sample]);
      expect(result.outcomes[0].result.kind).toBe("applied");
      expect(result.caption!.text.length).toBeGreaterThan(0);
      expect(result.caption!.text.length).toBeLessThanOrEqual(280);
      expect(def.undoable).toBe(true);
    });
  });
});

/* ------------------------------------------------------------------
   Properties 1–9 over the family's ops
   ------------------------------------------------------------------ */

/** A JSON copy with every object's keys reversed: what Postgres jsonb may hand back */
function reversedKeys<T>(value: T): T {
  const flip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(flip);
    if (v === null || typeof v !== "object") return v;
    return Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, flip(x)]));
  };
  return flip(JSON.parse(JSON.stringify(value))) as T;
}

describe("properties 1–9 over the family's ops, brief content included", () => {
  const starts = [briefDemo(), deepFreeze(withBrief(generated(60))), demo()];
  const stepArb = fc.record({
    op: fc.constantFrom<OpName>(...FAMILY),
    picks: fc.array(fc.nat(), { minLength: 6, maxLength: 6 }),
    text: fc.oneof(fc.string({ maxLength: 120 }), fc.constantFrom("", "  x", "Copy is late.", "x".repeat(601))),
    nums: fc.array(fc.double({ min: -10, max: 400, noNaN: true }), { minLength: 4, maxLength: 4 }),
    flags: fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
  });

  it("hold after every op, and undo and redo whole runs", () => {
    const seen = new Map<string, Set<string>>();
    fc.assert(
      fc.property(fc.nat(starts.length - 1), fc.array(stepArb, { maxLength: 20 }), (start, steps) => {
        const m = seededMinter(steps.length + 7);
        const initial = starts[start];
        let state = initial;
        const history: { patches: Patch[]; inverse: Patch[] }[] = [];
        for (const step of steps) {
          const raw = deepFreeze(materialise(step, state, m));
          if (raw === null) continue;
          const res = run(state, [raw]);
          const outcome = res.outcomes[0];
          const result = outcome.result;
          seen.set(step.op, (seen.get(step.op) ?? new Set()).add(result.kind));
          if (result.kind === "rejected") {
            expect(result.rejection.code).not.toBe("invalid_result");
            expect(result.rejection.message.length).toBeGreaterThan(0);
            expect(result.rejection.message.length).toBeLessThanOrEqual(140);
            expect(res.changed).toBe(false);
            continue;
          }
          if (result.kind === "noop") {
            expect(result.doc).toBe(outcome.before);
            expect(res.changed).toBe(false);
            continue;
          }
          const before = outcome.before as ProjectDoc;
          const next = result.doc as ProjectDoc;
          expect(ProjectDocSchema.safeParse(next).success).toBe(true);
          expect(checkProject(next)).toEqual([]);
          expect(docBytes(next)).toBeLessThanOrEqual(DOC_BYTES_MAX);
          expect(applyPatches(next, result.inverse)).toEqual(before);
          expect(applyPatches(before, result.patches)).toEqual(next);
          const ctx = reduceCtx(state);
          expect(applyOp(structuredClone(before), structuredClone(raw), ctx).doc).toEqual(next);
          expect(applyOp(reversedKeys(before), reversedKeys(raw), ctx).doc).toEqual(next);
          if (REGISTRY.get(step.op)!.idempotent) expect(applyOp(next, raw, ctx).kind).toBe("noop");
          expect(res.caption!.text.length).toBeGreaterThan(0);
          expect(res.caption!.text.length).toBeLessThanOrEqual(280);
          history.push({ patches: result.patches, inverse: result.inverse });
          state = withDoc(state, next);
        }
        let undone = project(state);
        for (const h of [...history].reverse()) undone = applyPatches(undone, h.inverse);
        expect(undone).toEqual(project(initial));
        let redone = undone;
        for (const h of history) redone = applyPatches(redone, h.patches);
        expect(redone).toEqual(project(state));
      }),
      { numRuns: 120 },
    );
    // Every op applied, and every idempotent op met a no-op (each rejection has its own test above)
    for (const name of FAMILY) {
      const kinds = seen.get(name) ?? new Set();
      expect(kinds.has("applied"), `${name} applied`).toBe(true);
      if (REGISTRY.get(name)!.idempotent) expect(kinds.has("noop"), `${name} no-op`).toBe(true);
    }
  });
});

describe("tasks the brief and focus name", () => {
  it("lose their pin and edits with the task, and undo brings them back", () => {
    const s = edited(briefDemo(), (p) => {
      const qa = makeTask({ id: mint("task"), title: "QA", order: keyAfter(sortedByOrder(p.tasks).at(-1)!.order) });
      return { ...p, tasks: { ...p.tasks, [qa.id]: qa } };
    });
    const qa = id(s, "QA");
    const prepared = run(s, [
      { op: "setFocus", taskId: qa },
      { op: "editBriefLine", key: `client:risks:${qa}`, text: "QA is tight.", basis: "QA is due soon." },
    ]);
    const ready = withDoc(s, prepared.state.projects[project(s).id]);
    const r = apply(ready, { op: "removeTask", taskId: qa });
    const applied = expectApplied(r.result);
    expect(after(r).viewConfig.focusPin).toBeNull();
    expect(after(r).brief.edits).not.toHaveProperty([`client:risks:${qa}`]);
    expectInverse(r.before, applied);
    // Nothing brings a dangling edit back
    expectRejection(apply(withDoc(ready, after(r)), { op: "editBriefLine", key: `client:risks:${qa}`, text: "x", basis: "y" }).result, "not_found");
  });
});
