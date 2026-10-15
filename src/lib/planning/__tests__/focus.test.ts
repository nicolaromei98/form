// Focus v2 (plan §6.7): the demo pick and its why, every reason with its points and wording,
// blocked exclusion, the pin, ties, the "me" scope, the weights file and the plan's getter.
import { describe, expect, it } from "vitest";
import { IsoDate, type PersonId, type ProjectDoc, type Task, type TaskId, type Timestamp } from "@/lib/domain/schema";
import { planProject } from "@/lib/planning";
import { focus, FOCUS_REASON_ORDER, type FocusReason, whyOf } from "@/lib/planning/focus";
import { FOCUS_WEIGHTS } from "@/lib/planning/focus.weights";
import {
  activeProject,
  byId,
  DEMO_PEOPLE,
  demoState,
  emptyWorkspace,
  FIXTURE_TODAY,
  makeProject,
  makeTask,
  taskByTitle,
} from "../../../../test/fixtures/v2/build";

const d = (s: string) => IsoDate.parse(s);
const ws = demoState().workspace;
const tid = (name: string) => `tsk_${name.toLowerCase().replace(/\W/g, "").padEnd(12, "x")}` as TaskId;

type Spec = Partial<Task> & { name: string; deps?: string[] };

/** A project from specs, in workflow order, on a confirmed start of today (Wednesday 14 October 2026), so nothing is late */
function project(specs: Spec[], o: Partial<ProjectDoc> = {}): ProjectDoc {
  return makeProject({
    id: (o.id ?? "prj_focusfocus01") as ProjectDoc["id"],
    workspaceId: emptyWorkspace().id,
    title: "Focus",
    status: "active",
    startDate: FIXTURE_TODAY,
    startConfirmed: true,
    tasks: byId(
      specs.map(({ name, deps, ...t }, i) =>
        makeTask({ id: tid(name), title: name, order: `a${i}`, estimateDays: 2, dependsOn: (deps ?? []).map(tid), ...t }),
      ),
    ),
    ...o,
  });
}

const planOf = (p: ProjectDoc, today = FIXTURE_TODAY) => planProject(p, ws, today);
const keys = (reasons: readonly FocusReason[]) => reasons.map((r) => [r.key, r.points]);

describe("the demo at 2026-10-14", () => {
  const state = demoState();
  const p = activeProject(state);
  const plan = planProject(p, state.workspace, FIXTURE_TODAY);
  const result = plan.focus;
  const id = (title: string) => taskByTitle(p, title).id;

  it("picks UI Design with 83 points (40 + 15 + 15 + 8 + 5)", () => {
    expect(result.pick).toMatchObject({ taskId: id("UI Design"), projectId: p.id, score: 83, chosenBy: "form", nextStepId: null });
    expect(keys(result.pick!.reasons)).toEqual([
      ["priority", 40],
      ["active", 15],
      ["critical", 15],
      ["tightFloat", 8],
      ["waiting", 5],
    ]);
    expect(result.pick!.reasons.map((r) => r.text)).toEqual([
      "Urgent priority",
      "In progress · 30%",
      "On the critical path",
      "No float",
      "Development waits on it",
    ]);
  });

  it('explains it as "Urgent and on the critical path."', () => {
    expect(result.pick!.why).toBe("Urgent and on the critical path.");
  });

  it("ranks Visual Direction second with 68 (25 + 10 + 15 + 8 + 10)", () => {
    expect(result.ranked.map((c) => [c.taskId, c.score])).toEqual([
      [id("UI Design"), 83],
      [id("Visual Direction"), 68],
    ]);
    const vd = result.ranked[1];
    expect(keys(vd.reasons)).toEqual([
      ["priority", 25],
      ["critical", 15],
      ["review", 10],
      ["waiting", 10],
      ["tightFloat", 8],
    ]);
    expect(vd.reasons.find((r) => r.key === "waiting")?.text).toBe("2 tasks wait for it");
    expect(vd.why).toBe("High priority and on the critical path.");
  });

  it("blocks Development and leaves Research out (done)", () => {
    expect([...result.blocked]).toEqual([id("Development")]);
    expect(result.ranked.some((c) => c.taskId === id("Research"))).toBe(false);
  });

  it("is never late on the sample (unconfirmed) start", () => {
    const later = planProject(p, state.workspace, d("2026-11-30")).focus;
    expect(later.pick!.reasons.some((r) => r.key === "late")).toBe(false);
  });

  it("lets a pinned task win while it is open, even a blocked one", () => {
    const pinned: ProjectDoc = { ...p, viewConfig: { ...p.viewConfig, focusPin: id("Development") } };
    const f = planProject(pinned, state.workspace, FIXTURE_TODAY).focus;
    expect(f.pick).toMatchObject({ taskId: id("Development"), chosenBy: "you", why: "Waits on UI Design." });
    // FORM's own ranking is unchanged
    expect(f.ranked[0].taskId).toBe(id("UI Design"));
    const done: ProjectDoc = { ...p, viewConfig: { ...p.viewConfig, focusPin: id("Research") } };
    expect(planProject(done, state.workspace, FIXTURE_TODAY).focus.pick).toMatchObject({ taskId: id("UI Design"), chosenBy: "form" });
    const missing: ProjectDoc = { ...p, viewConfig: { ...p.viewConfig, focusPin: "tsk_missingmissing" as TaskId } };
    expect(planProject(missing, state.workspace, FIXTURE_TODAY).focus.pick).toMatchObject({ taskId: id("UI Design"), chosenBy: "form" });
  });
});

describe("reasons", () => {
  it("scores priority alone: 40 / 25 / 12 / 4, with phrases only for urgent and high", () => {
    const p = project([
      { name: "U", priority: "urgent" },
      { name: "H", priority: "high" },
      { name: "M", priority: "medium" },
      { name: "L", priority: "low" },
    ]);
    const f = focus([planOf(p)], { today: FIXTURE_TODAY });
    const byName = Object.fromEntries(f.ranked.map((c) => [p.tasks[c.taskId].title, c]));
    expect([byName.U, byName.H, byName.M, byName.L].map((c) => c.reasons.find((x) => x.key === "priority"))).toEqual([
      { key: "priority", points: 40, text: "Urgent priority", phrase: "urgent", clause: false, risk: true },
      { key: "priority", points: 25, text: "High priority", phrase: "high priority", clause: false, risk: false },
      { key: "priority", points: 12, text: "Medium priority", phrase: null, clause: false, risk: false },
      { key: "priority", points: 4, text: "Low priority", phrase: null, clause: false, risk: false },
    ]);
    // Four parallel 2-day tasks: all critical with no float
    expect(byName.M.why).toBe("On the critical path.");
  });

  it("scores lateness on a confirmed start: 35 + 3 a working day, at most 30 more", () => {
    // Started Monday 5 Oct, ends Tuesday 6 Oct; today Thursday 8 Oct is 2 working days late
    const p = project([{ name: "Late", status: "active", progress: 40 }], { startDate: d("2026-10-05") });
    const late = focus([planOf(p, d("2026-10-08"))], { today: d("2026-10-08") }).pick!;
    expect(late.reasons.find((r) => r.key === "late")).toEqual({
      key: "late",
      points: 41,
      text: "Late · 2 working days",
      phrase: "late by 2 working days",
      clause: true,
      risk: true,
    });
    // Strongest first: the clause leads, the adjective follows
    expect(late.why).toBe("Late by 2 working days; on the critical path.");
    const veryLate = focus([planOf(p, d("2026-12-31"))], { today: d("2026-12-31") }).pick!;
    expect(veryLate.reasons.find((r) => r.key === "late")?.points).toBe(65);
  });

  it("scores a due date within 3 working days, or past", () => {
    const p = project([
      { name: "Soon", dueDate: d("2026-10-19") },
      { name: "Later", dueDate: d("2026-10-20") },
      { name: "Today", dueDate: d("2026-10-14") },
      { name: "Past", dueDate: d("2026-10-09") },
    ]);
    const f = focus([planOf(p)], { today: FIXTURE_TODAY });
    const due = (name: string) => f.ranked.find((c) => c.taskId === tid(name))!.reasons.find((r) => r.key === "dueSoon");
    // Wed 14 → Mon 19 is 3 working days ahead; Tue 20 is 4
    expect(due("Soon")).toEqual({ key: "dueSoon", points: 20, text: "Due 19 Oct", phrase: "due 19 Oct", clause: false, risk: true });
    expect(due("Later")).toBeUndefined();
    expect(due("Today")).toMatchObject({ text: "Due today", phrase: "due today" });
    expect(due("Past")).toMatchObject({ text: "Past due · 9 Oct", phrase: "past due" });
  });

  it("scores review, float and the critical path from the schedule", () => {
    // A → C (3 days) and B (6 days) in parallel: A and C have 3 days of float
    const p = project([
      { name: "A", status: "review", progress: 80 },
      { name: "B", estimateDays: 6 },
      { name: "C", deps: ["A"], estimateDays: 0.5 },
    ]);
    const f = focus([planOf(p)], { today: FIXTURE_TODAY });
    const a = f.ranked.find((c) => c.taskId === tid("A"))!;
    expect(keys(a.reasons)).toEqual([
      ["priority", 12],
      ["review", 10],
      ["waiting", 5],
    ]);
    expect(a.reasons.find((r) => r.key === "review")?.text).toBe("In review, close to done");
    // 2 days of float: tight
    const q = project([{ name: "A" }, { name: "B", estimateDays: 4 }]);
    const qa = focus([planOf(q)], { today: FIXTURE_TODAY }).ranked.find((c) => c.taskId === tid("A"))!;
    expect(qa.reasons.find((r) => r.key === "tightFloat")).toMatchObject({ points: 8, text: "2 days of float", phrase: null });
    expect(qa.reasons.some((r) => r.key === "critical")).toBe(false);
  });

  it("counts open tasks waiting on it, directly or not, 5 each up to 25", () => {
    const chain = Array.from({ length: 8 }, (_, i) => ({ name: `T${i}`, deps: i === 0 ? [] : [`T${i - 1}`] }));
    const p = project([...chain.slice(0, 2), { ...chain[2], status: "done" as const, progress: 100 }, ...chain.slice(3)]);
    const f = focus([planOf(p)], { today: FIXTURE_TODAY });
    const head = f.pick!;
    expect(head.taskId).toBe(tid("T0"));
    // T1 and T3 … T7 are open (6), T2 is done: capped at 25
    expect(head.reasons.find((r) => r.key === "waiting")).toEqual({
      key: "waiting",
      points: 25,
      text: "6 tasks wait for it",
      phrase: "6 tasks wait for it",
      clause: true,
      risk: false,
    });
    expect(head.why).toBe("6 tasks wait for it; on the critical path.");
  });

  it("orders equal points by the fixed key order", () => {
    expect(FOCUS_REASON_ORDER).toEqual(["priority", "late", "dueSoon", "active", "review", "critical", "waiting", "tightFloat"]);
  });
});

describe("why", () => {
  const r = (key: FocusReason["key"], phrase: string | null, clause = false): FocusReason => ({ key, points: 1, text: "", phrase, clause, risk: false });

  it("joins two adjectives with and, a clause with a semicolon, strongest first, and skips context", () => {
    expect(whyOf([r("priority", "urgent"), r("active", null), r("critical", "on the critical path")])).toBe("Urgent and on the critical path.");
    expect(whyOf([r("priority", "urgent"), r("waiting", "Development waits on it", true)])).toBe("Urgent; Development waits on it.");
    expect(whyOf([r("waiting", "Development waits on it", true), r("priority", "urgent")])).toBe("Development waits on it; urgent.");
    expect(whyOf([r("critical", "on the critical path")])).toBe("On the critical path.");
    expect(whyOf([r("late", "late by 3 working days", true), r("waiting", "2 tasks wait for it", true)])).toBe(
      "Late by 3 working days; 2 tasks wait for it.",
    );
    expect(whyOf([r("priority", "urgent"), r("critical", "on the critical path"), r("dueSoon", "due 16 Oct")])).toBe(
      "Urgent and on the critical path.",
    );
    expect(whyOf([r("active", null)])).toBe("Nothing is blocking it.");
  });
});

describe("blocked, ties and scope", () => {
  it("blocks only To-do tasks with an unfinished predecessor; started work stays in focus", () => {
    const p = project([
      { name: "A" },
      { name: "Todo", deps: ["A"] },
      { name: "Started", deps: ["A"], status: "active", progress: 10 },
      { name: "Reviewing", deps: ["A"], status: "review", progress: 90 },
      { name: "Free", deps: ["Done"] },
      { name: "Done", status: "done", progress: 100 },
    ]);
    const f = focus([planOf(p)], { today: FIXTURE_TODAY });
    expect([...f.blocked]).toEqual([tid("Todo")]);
    expect(f.ranked.map((c) => c.taskId).sort()).toEqual([tid("A"), tid("Started"), tid("Reviewing"), tid("Free")].sort());
  });

  it("breaks ties by workflow order", () => {
    const p = project([{ name: "Second", order: "a2" }, { name: "First", order: "a1" }]);
    const f = focus([planOf(p)], { today: FIXTURE_TODAY });
    expect(f.ranked.map((c) => c.score)).toEqual([f.ranked[0].score, f.ranked[0].score]);
    expect(f.ranked.map((c) => c.taskId)).toEqual([tid("First"), tid("Second")]);
  });

  it("scopes 'My focus' to one owner across projects, ties going to the older project", () => {
    const older = project([{ name: "Old", ownerId: DEMO_PEOPLE.sara }, { name: "Theirs", ownerId: DEMO_PEOPLE.luca, priority: "urgent" }], {
      id: "prj_focusfocus01" as ProjectDoc["id"],
      createdAt: "2026-09-01T09:00:00Z" as Timestamp,
    });
    const newer = project([{ name: "New", ownerId: DEMO_PEOPLE.sara }], {
      id: "prj_focusfocus00" as ProjectDoc["id"],
      createdAt: "2026-10-01T09:00:00Z" as Timestamp,
    });
    const mine = focus([planOf(newer), planOf(older)], { today: FIXTURE_TODAY, ownerId: DEMO_PEOPLE.sara as PersonId });
    expect(mine.ranked.map((c) => [c.taskId, c.projectId])).toEqual([
      [tid("Old"), older.id],
      [tid("New"), newer.id],
    ]);
    expect(mine.pick).toMatchObject({ taskId: tid("Old"), chosenBy: "form" });
    const everyone = focus([planOf(newer), planOf(older)], { today: FIXTURE_TODAY });
    expect(everyone.pick?.taskId).toBe(tid("Theirs"));
  });

  it("names the first open step", () => {
    const p = project([
      {
        name: "Stepped",
        steps: [
          { id: "stp_one000000000" as never, title: "One", done: true, ownerId: null, estimateDays: null },
          { id: "stp_two000000000" as never, title: "Two", done: false, ownerId: null, estimateDays: null },
        ],
      },
    ]);
    expect(focus([planOf(p)], { today: FIXTURE_TODAY }).pick?.nextStepId).toBe("stp_two000000000");
  });

  it("picks nothing when nothing is open", () => {
    const p = project([{ name: "Done", status: "done", progress: 100 }]);
    expect(focus([planOf(p)], { today: FIXTURE_TODAY })).toMatchObject({ pick: null, ranked: [] });
    expect(focus([], { today: FIXTURE_TODAY }).pick).toBeNull();
  });
});

describe("weights", () => {
  it("come from the single configuration file", () => {
    expect(FOCUS_WEIGHTS).toEqual({
      priority: { urgent: 40, high: 25, medium: 12, low: 4 },
      active: 15,
      review: 10,
      late: 35,
      latePerDay: 3,
      lateMax: 30,
      dueSoon: 20,
      dueSoonDays: 3,
      critical: 15,
      tightFloat: 8,
      tightFloatDays: 2,
      waitingEach: 5,
      waitingMax: 25,
    });
  });

  it("change the score with no other code change", () => {
    const state = demoState();
    const plan = planProject(activeProject(state), state.workspace, FIXTURE_TODAY);
    const f = focus([plan], { today: FIXTURE_TODAY, weights: { ...FOCUS_WEIGHTS, priority: { ...FOCUS_WEIGHTS.priority, urgent: 0 } } });
    expect(f.ranked.map((c) => [plan.project.tasks[c.taskId].title, c.score])).toEqual([
      ["Visual Direction", 68],
      ["UI Design", 43],
    ]);
  });
});

describe("the plan's focus getter", () => {
  it("is lazy, memoised, and survives a viewConfig change other than the pin", () => {
    const state = demoState();
    const p = activeProject(state);
    const plan = planProject(p, state.workspace, FIXTURE_TODAY);
    expect(plan.focus).toBe(plan.focus);
    const compact: ProjectDoc = { ...p, viewConfig: { ...p.viewConfig, density: "compact" } };
    expect(planProject(compact, state.workspace, FIXTURE_TODAY).focus).toBe(plan.focus);
    const pinned: ProjectDoc = { ...p, viewConfig: { ...p.viewConfig, focusPin: taskByTitle(p, "Visual Direction").id } };
    expect(planProject(pinned, state.workspace, FIXTURE_TODAY).focus.pick?.chosenBy).toBe("you");
  });
});
