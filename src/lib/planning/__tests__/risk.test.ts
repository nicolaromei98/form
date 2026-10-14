// Lateness and risks (plan §6.4): late only with a confirmed start, due risk and due soon in
// working days, and the deadline sentence of FORM-v1 §17.
import { describe, expect, it } from "vitest";
import { IsoDate, type ProjectDoc, TaskId } from "@/lib/domain/schema";
import { makeCalendar } from "@/lib/planning/calendar";
import { deadlineSentence, NO_RISK, risks, taskRisk } from "@/lib/planning/risk";
import { schedule } from "@/lib/planning/schedule";
import { activeProject, demoState, FIXTURE_TODAY, makeTask, taskByTitle } from "../../../../test/fixtures/v2/build";

const d = (s: string) => IsoDate.parse(s);
const cal = makeCalendar({ workingDays: [1, 2, 3, 4, 5], closures: [] });
const demo = () => activeProject(demoState());

function withTask(p: ProjectDoc, title: string, patch: Partial<ProjectDoc["tasks"][TaskId]>): ProjectDoc {
  const t = taskByTitle(p, title);
  return { ...p, tasks: { ...p.tasks, [t.id]: { ...t, ...patch } } };
}

const riskOf = (p: ProjectDoc, today: string) => risks(p, schedule(p, cal), cal, d(today));
const of = (p: ProjectDoc, r: ReturnType<typeof riskOf>, title: string) => taskRisk(r, taskByTitle(p, title).id);

describe("lateness", () => {
  it("never happens on the sample schedule, whatever the day (audit B.8)", () => {
    const p = demo();
    for (const today of ["2026-10-14", "2026-10-30", "2027-01-15"]) {
      const r = riskOf(p, today);
      expect(r.byTask.size).toBe(0);
      expect(r.deadline).toBeNull();
    }
  });

  it("needs a confirmed start, and counts working days from the end to today", () => {
    const p = { ...demo(), startConfirmed: true };
    const r = riskOf(p, FIXTURE_TODAY);
    // Visual Direction (In review) ended Tue 6 Oct: late 7, 8, 9, 12, 13 and 14 Oct
    expect(of(p, r, "Visual Direction").late).toBe(6);
    // UI Design ends today: not late yet
    expect(of(p, r, "UI Design")).toBe(NO_RISK);
    // Research is Done
    expect(of(p, r, "Research")).toBe(NO_RISK);
    expect(of(p, r, "Development")).toBe(NO_RISK);
    expect(of(p, riskOf(p, "2026-10-15"), "UI Design").late).toBe(1);
  });

  it("is at least one working day, even on the weekend after the end", () => {
    const p = { ...demo(), startConfirmed: true };
    // Development ends Mon 26 Oct; Visual Direction ended Tue 6 Oct
    expect(of(p, riskOf(p, "2026-10-07"), "Visual Direction").late).toBe(1);
    // Development ending Fri 23 Oct is 1 working day late on Sat 24 Oct
    const fridayEnd = withTask(p, "Development", { estimateDays: 7 });
    expect(of(fridayEnd, riskOf(fridayEnd, "2026-10-24"), "Development").late).toBe(1);
    // Ending Wed 21 Oct, it is late on Thu 22 and Fri 23
    const wednesdayEnd = withTask(p, "Development", { estimateDays: 5 });
    expect(of(wednesdayEnd, riskOf(wednesdayEnd, "2026-10-24"), "Development").late).toBe(2);
  });

  it("never applies to a task without dates", () => {
    const p = withTask({ ...demo(), startConfirmed: true }, "Visual Direction", { estimateDays: null });
    const r = riskOf(p, "2027-01-15");
    expect(of(p, r, "Visual Direction").late).toBeNull();
    expect(of(p, r, "UI Design").late).toBeNull();
  });
});

describe("due dates", () => {
  it("flag a planned end past the due date, in working days", () => {
    const p = withTask(demo(), "UI Design", { dueDate: d("2026-10-12") });
    const r = riskOf(p, "2026-10-01");
    // UI Design ends Wed 14 Oct: 13 and 14 Oct past Mon 12
    expect(of(p, r, "UI Design")).toEqual({ late: null, dueRisk: 2, dueSoon: false });
    // A due date on a Saturday: the end is one working day past it
    const sat = withTask(demo(), "Development", { dueDate: d("2026-10-24") });
    expect(of(sat, riskOf(sat, "2026-10-01"), "Development").dueRisk).toBe(1);
    const onTime = withTask(demo(), "Development", { dueDate: d("2026-10-26") });
    expect(of(onTime, riskOf(onTime, "2026-10-01"), "Development")).toBe(NO_RISK);
  });

  it("are due soon within 3 working days of today, or past", () => {
    const at = (due: string) => {
      const p = withTask(demo(), "Development", { dueDate: d(due) });
      return of(p, riskOf(p, FIXTURE_TODAY), "Development").dueSoon;
    };
    // Today is Wed 14 Oct: Thu 15, Fri 16 and Mon 19 are within 3 working days
    expect(at("2026-10-14")).toBe(true);
    expect(at("2026-10-17")).toBe(true);
    expect(at("2026-10-19")).toBe(true);
    expect(at("2026-10-20")).toBe(false);
    expect(at("2026-10-01")).toBe(true);
  });

  it("take an explicit window", () => {
    const p = withTask(demo(), "Development", { dueDate: d("2026-10-20") });
    expect(taskRisk(risks(p, schedule(p, cal), cal, FIXTURE_TODAY, { dueSoonDays: 4 }), taskByTitle(p, "Development").id).dueSoon).toBe(true);
  });

  it("carry no risk for a Done task", () => {
    const p = withTask(demo(), "Research", { dueDate: d("2026-09-01") });
    expect(of(p, riskOf(p, FIXTURE_TODAY), "Research")).toBe(NO_RISK);
  });

  it("can't be compared without dates, but can still be due soon", () => {
    const p = withTask({ ...demo(), startDate: null, startConfirmed: false }, "UI Design", { dueDate: d("2026-10-12") });
    const r = riskOf(p, FIXTURE_TODAY);
    expect(of(p, r, "UI Design")).toEqual({ late: null, dueRisk: null, dueSoon: true });
  });
});

describe("the deadline", () => {
  it("says how many working days the planned end runs past it", () => {
    const p = { ...demo(), deadline: d("2026-10-14") };
    const r = riskOf(p, FIXTURE_TODAY);
    expect(r.deadline).toEqual({
      deadline: "2026-10-14",
      kind: "soft",
      end: "2026-10-26",
      gap: 8,
      lowerBound: false,
      sentence: "Planned end 26 Oct is 8 working days after the deadline.",
    });
  });

  it('says "at least" when an open task is unknown', () => {
    const base = { ...demo(), deadline: d("2026-10-14"), deadlineKind: "hard" as const };
    const extra = makeTask({ id: TaskId.parse("tsk_extratask00"), title: "Copy", order: "a9", estimateDays: null });
    const p = { ...base, tasks: { ...base.tasks, [extra.id]: extra } };
    expect(riskOf(p, FIXTURE_TODAY).deadline).toMatchObject({
      kind: "hard",
      gap: 8,
      lowerBound: true,
      sentence: "Planned end 26 Oct is at least 8 working days after the deadline.",
    });
  });

  it("uses the singular for one working day, and is quiet on or before it", () => {
    expect(riskOf({ ...demo(), deadline: d("2026-10-23") }, FIXTURE_TODAY).deadline?.sentence).toBe(
      "Planned end 26 Oct is 1 working day after the deadline.",
    );
    expect(riskOf({ ...demo(), deadline: d("2026-10-24") }, FIXTURE_TODAY).deadline?.gap).toBe(1);
    expect(riskOf({ ...demo(), deadline: d("2026-10-26") }, FIXTURE_TODAY).deadline).toBeNull();
    expect(riskOf({ ...demo(), deadline: d("2026-12-01") }, FIXTURE_TODAY).deadline).toBeNull();
  });

  it("can't be placed in relative mode", () => {
    const p = { ...demo(), startDate: null, deadline: d("2001-01-02") };
    expect(riskOf(p, FIXTURE_TODAY).deadline).toBeNull();
  });

  it("has its sentence on its own", () => {
    expect(deadlineSentence(d("2026-12-12"), 8, false)).toBe("Planned end 12 Dec is 8 working days after the deadline.");
  });
});
