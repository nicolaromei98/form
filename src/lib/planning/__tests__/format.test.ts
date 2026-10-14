// Planning formatters (plan §2): the v0 date formats on IsoDate (parity with the frozen v0
// helpers), the v0 day grid, the date mode and the labels of unknown tasks.
import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/domain/dates";
import { IsoDate, type ProjectDoc, StepId, type TaskId } from "@/lib/domain/schema";
import { makeCalendar } from "@/lib/planning/calendar";
import {
  calendarOffsets,
  dateMode,
  fmtDate,
  fmtDateYear,
  fmtDay,
  fmtDays,
  fmtShort,
  fmtWeekday,
  fmtWorkingDays,
  noEstimateSentence,
  scheduleLabel,
  unknownLabel,
} from "@/lib/planning/format";
import { schedule, type UnknownTiming } from "@/lib/planning/schedule";
import * as v0 from "../../../../test/legacy/v0/lib/selectors";
import { activeProject, demoState, makeTask, taskByTitle } from "../../../../test/fixtures/v2/build";

const d = (s: string) => IsoDate.parse(s);
const cal = makeCalendar({ workingDays: [1, 2, 3, 4, 5], closures: [] });

describe("date formats", () => {
  it("print the v0 shapes", () => {
    expect(fmtDay(d("2026-10-01"))).toBe("01 OCT");
    expect(fmtShort(d("2026-10-01"))).toBe("01.10");
    expect(fmtWeekday(d("2026-10-14"))).toBe("WED");
    expect(fmtDate(d("2026-10-01"))).toBe("1 Oct");
    expect(fmtDate(d("2026-12-12"))).toBe("12 Dec");
    expect(fmtDateYear(d("2026-09-28"))).toBe("28 Sep 2026");
    expect(fmtDays(3)).toBe("3d");
    expect(fmtDays(2.5)).toBe("2.5d");
    expect(fmtDays(0)).toBe("0d");
    expect(fmtDays(null)).toBe("—");
    expect(fmtWorkingDays(1)).toBe("1 working day");
    expect(fmtWorkingDays(8)).toBe("8 working days");
  });

  it("equal the frozen v0 helpers over three years, leap day included", () => {
    for (let k = 0; k < 3 * 366; k++) {
      const day = addDays(d("2026-01-01"), k);
      const local = v0.parseISODate(day);
      expect(fmtDay(day)).toBe(v0.fmtDay(local));
      expect(fmtShort(day)).toBe(v0.fmtShort(local));
      expect(fmtWeekday(day)).toBe(v0.fmtWeekday(local));
      // The v0 brief and header: day of the month, then the short month
      expect(fmtDate(day)).toBe(`${local.getDate()} ${local.toLocaleString("en-US", { month: "short" })}`);
    }
    for (const n of [0, 0.5, 1, 2.5, 7, 250, null]) expect(fmtDays(n)).toBe(v0.fmtDays(n));
  });
});

describe("date mode", () => {
  it("keeps sample dates in /demo and relative labels in the app for an unconfirmed start", () => {
    expect(dateMode("absolute")).toBe("absolute");
    expect(dateMode("provisional")).toBe("sample");
    expect(dateMode("provisional", "app")).toBe("relative");
    expect(dateMode("relative")).toBe("relative");
    const s = schedule(activeProject(demoState()), cal);
    expect(dateMode(s.anchor)).toBe("sample");
    expect(scheduleLabel(dateMode(s.anchor))).toBe("Sample schedule");
    expect(scheduleLabel("absolute")).toBe("Schedule");
  });
});

describe("unknown labels", () => {
  it("ask for the duration, or name the root task to estimate", () => {
    const p = activeProject(demoState());
    const ui = taskByTitle(p, "UI Design");
    const cleared: ProjectDoc = { ...p, tasks: { ...p.tasks, [ui.id]: { ...ui, estimateDays: null } } };
    const s = schedule(cleared, cal);
    const titleOf = (id: TaskId) => cleared.tasks[id].title;
    const label = (title: string) => unknownLabel(s.timings.get(taskByTitle(p, title).id) as UnknownTiming, s, titleOf);
    expect(label("UI Design")).toBe("Needs a duration");
    expect(label("Development")).toBe("Needs UI Design's estimate");
    expect(noEstimateSentence("UI Design")).toBe("UI Design has no estimate, so its dates are unknown.");
  });

  it("name loops and the horizon", () => {
    const s = schedule(activeProject(demoState()), cal);
    const any = activeProject(demoState()).tasks;
    const id = Object.keys(any)[0] as TaskId;
    expect(unknownLabel({ kind: "unknown", reason: "cycle", cause: id }, s, () => "X")).toBe("In a dependency loop");
    expect(unknownLabel({ kind: "unknown", reason: "horizon", cause: id }, s, () => "X")).toBe("Too far out to date");
  });
});

describe("the v0 day grid", () => {
  it("spans the weekends inside each bar, from the start date (ED-1)", () => {
    const p = activeProject(demoState());
    const grid = calendarOffsets(schedule(p, cal));
    const bar = (title: string) => grid.bars.get(taskByTitle(p, title).id);
    expect(grid.unit).toBe("day");
    expect(grid.origin).toBe("2026-09-28");
    expect(bar("Research")).toEqual({ start: 0, days: 3, milestone: false });
    // Thu 1 to Tue 6 Oct: six calendar days, the weekend inside
    expect(bar("Visual Direction")).toEqual({ start: 3, days: 6, milestone: false });
    expect(bar("UI Design")).toEqual({ start: 9, days: 8, milestone: false });
    expect(bar("Development")).toEqual({ start: 17, days: 12, milestone: false });
    // The grid runs to Mon 26 Oct
    expect(grid.totalDays).toBe(29);
    expect(grid.unscheduled).toEqual([]);
  });

  it("puts steps, milestones and unknown tasks where the timeline expects them", () => {
    const p = activeProject(demoState());
    const ui = taskByTitle(p, "UI Design");
    const steps = [
      { id: StepId.parse("stp_wireframes0"), title: "Wireframes", done: false, ownerId: null, estimateDays: 3 },
      { id: StepId.parse("stp_hifidesign0"), title: "Hi-fi", done: false, ownerId: null, estimateDays: 3 },
    ];
    const launch = makeTask({ id: "tsk_launchmilestone" as TaskId, title: "Launch", kind: "milestone", estimateDays: 0, order: "a9", dependsOn: [ui.id] });
    const open = makeTask({ id: "tsk_noestimate000" as TaskId, title: "Copy", order: "aA" });
    const q: ProjectDoc = { ...p, tasks: { ...p.tasks, [ui.id]: { ...ui, steps }, [launch.id]: launch, [open.id]: open } };
    const grid = calendarOffsets(schedule(q, cal));
    // Wireframes Wed 7 to Fri 9 Oct; Hi-fi Mon 12 to Wed 14 Oct
    expect(grid.steps.get(steps[0].id)).toEqual({ start: 9, days: 3 });
    expect(grid.steps.get(steps[1].id)).toEqual({ start: 14, days: 3 });
    // Launch sits on UI Design's last day
    expect(grid.bars.get(launch.id)).toEqual({ start: 16, days: 1, milestone: true });
    expect(grid.unscheduled).toEqual([open.id]);
  });

  it("counts working days in relative mode, where no calendar date exists", () => {
    const p = { ...activeProject(demoState()), startDate: null };
    const grid = calendarOffsets(schedule(p, cal));
    expect(grid.unit).toBe("workingDay");
    expect(grid.origin).toBeNull();
    expect(grid.bars.get(taskByTitle(p, "Visual Direction").id)).toEqual({ start: 3, days: 4, milestone: false });
    expect(grid.totalDays).toBe(21);
  });

  it("is empty when nothing is scheduled", () => {
    const grid = calendarOffsets(schedule({ ...activeProject(demoState()), tasks: {} }, cal));
    expect(grid.totalDays).toBe(0);
    expect(grid.bars.size).toBe(0);
  });
});
