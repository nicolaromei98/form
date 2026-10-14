// The plan façade and its memos (plan §6.8): identity is the version, so the same documents on
// the same day return the same plan, and each stage recomputes only when what it reads changes.
// The spy wraps the real schedule, risks and metrics, so a call count is a recomputation count.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IsoDate, type ProjectDoc, type WorkspaceDoc } from "@/lib/domain/schema";
import { planProject } from "@/lib/planning";
import { memoByRef, RefCache } from "@/lib/planning/memo";
import * as metricsModule from "@/lib/planning/metrics";
import * as riskModule from "@/lib/planning/risk";
import * as scheduleModule from "@/lib/planning/schedule";
import { activeProject, DEMO_PEOPLE, demoState, FIXTURE_TODAY, taskByTitle } from "../../../../test/fixtures/v2/build";

vi.mock("@/lib/planning/schedule", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/planning/schedule")>();
  return { ...real, schedule: vi.fn(real.schedule) };
});
vi.mock("@/lib/planning/risk", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/planning/risk")>();
  return { ...real, risks: vi.fn(real.risks) };
});
vi.mock("@/lib/planning/metrics", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/planning/metrics")>();
  return { ...real, metrics: vi.fn(real.metrics) };
});

const scheduleSpy = vi.mocked(scheduleModule.schedule);
const risksSpy = vi.mocked(riskModule.risks);
const metricsSpy = vi.mocked(metricsModule.metrics);

/** Fresh documents per test, so no memo from another test can answer */
function fresh(): { project: ProjectDoc; ws: WorkspaceDoc } {
  const state = demoState();
  return { project: activeProject(state), ws: state.workspace };
}

/** Reads every part of a plan */
function touch(project: ProjectDoc, ws: WorkspaceDoc, today = FIXTURE_TODAY) {
  const plan = planProject(project, ws, today);
  void plan.schedule;
  void plan.risks;
  void plan.metrics;
  void plan.topo;
  return plan;
}

beforeEach(() => {
  scheduleSpy.mockClear();
  risksSpy.mockClear();
  metricsSpy.mockClear();
});

describe("planProject", () => {
  it("returns the same plan for the same documents on the same day", () => {
    const { project, ws } = fresh();
    const plan = touch(project, ws);
    expect(touch(project, ws)).toBe(plan);
    expect(scheduleSpy).toHaveBeenCalledTimes(1);
    expect(risksSpy).toHaveBeenCalledTimes(1);
    expect(metricsSpy).toHaveBeenCalledTimes(1);
  });

  it("computes nothing until a part is read", () => {
    const { project, ws } = fresh();
    const plan = planProject(project, ws, FIXTURE_TODAY);
    expect(scheduleSpy).not.toHaveBeenCalled();
    void plan.metrics;
    expect(scheduleSpy).toHaveBeenCalledTimes(1);
    expect(risksSpy).not.toHaveBeenCalled();
  });

  it("doesn't reschedule for a viewConfig change (the memo spy)", () => {
    const { project, ws } = fresh();
    const before = touch(project, ws);
    const compact: ProjectDoc = { ...project, viewConfig: { ...project.viewConfig, density: "compact", sort: "priority" } };
    const after = touch(compact, ws);
    expect(after).not.toBe(before);
    expect(after.schedule).toBe(before.schedule);
    expect(after.risks).toBe(before.risks);
    expect(after.metrics).toBe(before.metrics);
    expect(scheduleSpy).toHaveBeenCalledTimes(1);
    expect(risksSpy).toHaveBeenCalledTimes(1);
    expect(metricsSpy).toHaveBeenCalledTimes(1);
  });

  it("doesn't reschedule for a title, brief or moodboard change either", () => {
    const { project, ws } = fresh();
    const before = touch(project, ws);
    const edited: ProjectDoc = { ...project, title: "Renamed", brief: { ...project.brief, sharing: { showBudgetToClient: true } }, moodboard: { items: {} } };
    expect(touch(edited, ws).schedule).toBe(before.schedule);
    expect(scheduleSpy).toHaveBeenCalledTimes(1);
  });

  it("reschedules when a task, the start or the deadline changes", () => {
    const { project, ws } = fresh();
    const before = touch(project, ws);
    const ui = taskByTitle(project, "UI Design");
    const longer: ProjectDoc = { ...project, tasks: { ...project.tasks, [ui.id]: { ...ui, estimateDays: 7 } } };
    expect(touch(longer, ws).schedule).not.toBe(before.schedule);
    expect(touch({ ...project, startConfirmed: true }, ws).schedule).not.toBe(before.schedule);
    expect(touch({ ...project, deadline: IsoDate.parse("2026-10-20") }, ws).schedule).not.toBe(before.schedule);
    expect(scheduleSpy).toHaveBeenCalledTimes(4);
  });

  it("reschedules when the calendar changes, and not for an equal calendar", () => {
    const { project, ws } = fresh();
    const before = touch(project, ws);
    // A new workspace object with the same calendar: same schedule, new plan
    const renamed: WorkspaceDoc = { ...ws, name: "Studio" };
    expect(touch(project, renamed).schedule).toBe(before.schedule);
    const sixDays: WorkspaceDoc = { ...ws, workingDays: [1, 2, 3, 4, 5, 6] };
    const six = touch(project, sixDays);
    expect(six.schedule).not.toBe(before.schedule);
    expect(scheduleSpy).toHaveBeenCalledTimes(2);
    // The project's override wins over the workspace's working days
    const overridden: ProjectDoc = { ...project, calendarOverride: { workingDays: [1, 2, 3, 4, 5], closures: null } };
    expect(touch(overridden, sixDays).calendar.key).toBe(before.calendar.key);
  });

  it("recomputes only risks when the day changes", () => {
    const { project, ws } = fresh();
    const before = touch(project, ws);
    const tomorrow = touch(project, ws, IsoDate.parse("2026-10-15"));
    expect(tomorrow).not.toBe(before);
    expect(tomorrow.today).toBe("2026-10-15");
    expect(tomorrow.schedule).toBe(before.schedule);
    expect(tomorrow.metrics).toBe(before.metrics);
    expect(risksSpy).toHaveBeenCalledTimes(2);
    expect(scheduleSpy).toHaveBeenCalledTimes(1);
  });

  it("recomputes only metrics when the people change", () => {
    const { project, ws } = fresh();
    const before = touch(project, ws);
    const marta = ws.people[DEMO_PEOPLE.marta];
    const rated: WorkspaceDoc = { ...ws, people: { ...ws.people, [marta.id]: { ...marta, dayRateCents: 40_000 } } };
    const after = touch(project, rated);
    expect(after.schedule).toBe(before.schedule);
    expect(after.metrics).not.toBe(before.metrics);
    expect(after.metrics.budget.derivedCents).toBe(400_000);
    expect(metricsSpy).toHaveBeenCalledTimes(2);
    expect(scheduleSpy).toHaveBeenCalledTimes(1);
    // A budget change too
    expect(touch({ ...project, budgetCents: 500_000 }, rated).metrics.budget.budgetCents).toBe(500_000);
    expect(metricsSpy).toHaveBeenCalledTimes(3);
  });

  it("numbers tasks in workflow order", () => {
    const { project, ws } = fresh();
    const plan = planProject(project, ws, FIXTURE_TODAY);
    expect(["Research", "Visual Direction", "UI Design", "Development"].map((t) => plan.number(taskByTitle(project, t).id))).toEqual([
      "01",
      "02",
      "03",
      "04",
    ]);
    expect(plan.number("tsk_missingmissing" as never)).toBe("00");
    expect(plan.topo).toEqual(plan.schedule.topo);
  });
});

describe("memo helpers", () => {
  it("memoByRef computes once per object", () => {
    const fn = vi.fn((o: { n: number }) => o.n * 2);
    const memo = memoByRef(fn);
    const a = { n: 2 };
    expect(memo(a)).toBe(4);
    expect(memo(a)).toBe(4);
    expect(memo({ n: 2 })).toBe(4);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("RefCache keeps the last strings per object", () => {
    const cache = new RefCache<object, number>(2);
    const ref = {};
    let calls = 0;
    const get = (key: string) => cache.get(ref, key, () => ++calls);
    expect([get("a"), get("b"), get("a")]).toEqual([1, 2, 1]);
    get("c");
    // "a" was the oldest entry and has gone
    expect(get("a")).toBe(4);
    expect(get("c")).toBe(3);
  });
});
