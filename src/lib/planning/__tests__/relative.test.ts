// Relative labels (plan §6.4, FORM-v1 §7.2): "D1–D3" and "Week 2", counted in working days from
// the anchor.
import { describe, expect, it } from "vitest";
import { TaskId } from "@/lib/domain/schema";
import { makeCalendar } from "@/lib/planning/calendar";
import { relativeDay, relativeRange, relativeWeek } from "@/lib/planning/relative";
import { schedule, type ScheduledTiming } from "@/lib/planning/schedule";
import { activeProject, demoState, makeTask, taskByTitle } from "../../../../test/fixtures/v2/build";

const MON_FRI = { workingDays: [1, 2, 3, 4, 5], closures: [] };
const cal = makeCalendar(MON_FRI);

describe("relative labels", () => {
  // The demo with no start date at all: relative mode
  const p = { ...activeProject(demoState()), startDate: null };
  const s = schedule(p, cal);
  const t = (title: string) => s.timings.get(taskByTitle(p, title).id)!;

  it("number the working days of the demo chain from D1", () => {
    expect(s.anchor.mode).toBe("relative");
    expect(relativeRange(t("Research"), s)).toBe("D1–D3");
    expect(relativeRange(t("Visual Direction"), s)).toBe("D4–D7");
    expect(relativeRange(t("UI Design"), s)).toBe("D8–D13");
    expect(relativeRange(t("Development"), s)).toBe("D14–D21");
  });

  it("count whole working weeks from the anchor", () => {
    const es = (title: string) => (t(title) as ScheduledTiming).es;
    expect(relativeWeek(es("Research"), s, MON_FRI)).toBe("Week 1");
    expect(relativeWeek(es("UI Design"), s, MON_FRI)).toBe("Week 2");
    expect(relativeWeek(es("Development"), s, MON_FRI)).toBe("Week 3");
    // On a four-day week D9 opens week 3; a repeated weekday counts once
    expect(relativeWeek(s.anchor.ordinal + 8, s, { workingDays: [1, 2, 3, 4] })).toBe("Week 3");
    expect(relativeWeek(s.anchor.ordinal + 4, s, { workingDays: [1, 2, 3, 4, 4] })).toBe("Week 2");
  });

  it("give a one-day task and a milestone a single day, and an unknown task nothing", () => {
    const m = makeTask({ id: TaskId.parse("tsk_launchmilestone"), title: "Launch", kind: "milestone", estimateDays: 0, order: "a9", dependsOn: [taskByTitle(p, "Research").id] });
    const one = makeTask({ id: TaskId.parse("tsk_onedaytask000"), title: "One", estimateDays: 1, order: "aA" });
    const unknown = makeTask({ id: TaskId.parse("tsk_unknowntask00"), title: "Unknown", order: "aB" });
    const q = { ...p, tasks: { ...p.tasks, [m.id]: m, [one.id]: one, [unknown.id]: unknown } };
    const sq = schedule(q, cal);
    expect(relativeRange(sq.timings.get(m.id)!, sq)).toBe("D3");
    expect(relativeRange(sq.timings.get(one.id)!, sq)).toBe("D1");
    expect(relativeRange(sq.timings.get(unknown.id)!, sq)).toBeNull();
    expect(relativeDay(sq.anchor.ordinal, sq)).toBe("D1");
  });

  it("read the same on a dated schedule", () => {
    const dated = schedule(activeProject(demoState()), cal);
    const dp = activeProject(demoState());
    expect(relativeRange(dated.timings.get(taskByTitle(dp, "UI Design").id)!, dated)).toBe("D8–D13");
  });
});
