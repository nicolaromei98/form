// The schedule (plan §6.3): the documented cases, unknown propagation with root causes, anchor
// modes, steps (Q1), loops and the planning horizon, plus the naive oracle over random DAGs.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { IsoDate, type ProjectDoc } from "@/lib/domain/schema";
import { makeCalendar, type CalendarSpec, type DateRange } from "@/lib/planning/calendar";
import { PLAN_SPAN_MAX, schedule, type Schedule, type ScheduledTiming, type TaskTiming } from "@/lib/planning/schedule";
import { activeProject, demoState, taskByTitle } from "../../../../test/fixtures/v2/build";
import { agreesWithOracle, isTotal, projectFrom as project, scheduleCase, sid, type TaskSpec as Spec, tid } from "./schedule-oracle";

const d = (s: string) => IsoDate.parse(s);
/** A date outside the stored window, which only a hand-built calendar holds */
const far = (s: string) => s as IsoDate;
const MON_FRI: CalendarSpec = { workingDays: [1, 2, 3, 4, 5], closures: [] };
const monFri = (closures: DateRange[] = []) => makeCalendar({ ...MON_FRI, closures });

function timing(s: Schedule, name: string): TaskTiming {
  const t = s.timings.get(tid(name));
  if (!t) throw new Error(`No timing for ${name}`);
  return t;
}

function placed(s: Schedule, name: string): ScheduledTiming {
  const t = timing(s, name);
  if (t.kind !== "scheduled") throw new Error(`${name} is ${t.reason}`);
  return t;
}

const span = (s: Schedule, name: string) => {
  const t = placed(s, name);
  return [t.start, t.end];
};

describe("the documented cases (plan §6.3)", () => {
  it("lays out the demo chain on Monday to Friday from Monday 28 September 2026", () => {
    const p = activeProject(demoState());
    const s = schedule(p, monFri());
    const t = (title: string) => s.timings.get(taskByTitle(p, title).id) as ScheduledTiming;
    expect([t("Research").start, t("Research").end]).toEqual(["2026-09-28", "2026-09-30"]);
    expect([t("Visual Direction").start, t("Visual Direction").end]).toEqual(["2026-10-01", "2026-10-06"]);
    expect([t("UI Design").start, t("UI Design").end]).toEqual(["2026-10-07", "2026-10-14"]);
    expect([t("Development").start, t("Development").end]).toEqual(["2026-10-15", "2026-10-26"]);
    for (const title of ["Research", "Visual Direction", "UI Design", "Development"]) {
      expect(t(title).float).toBe(0);
      expect(t(title).critical).toBe(true);
    }
    expect(s.critical).toEqual(["Research", "Visual Direction", "UI Design", "Development"].map((x) => taskByTitle(p, x).id));
    expect(s.anchor).toEqual({ date: "2026-09-28", ordinal: monFri().ordinal(d("2026-09-28")), mode: "provisional" });
    expect(s.end).toMatchObject({ date: "2026-10-26", complete: true });
    expect(s.end!.finish - s.anchor.ordinal).toBe(21);
  });

  it("gives the short branch of a diamond its float", () => {
    const s = schedule(
      project([
        { name: "A", est: 2 },
        { name: "B", est: 5, deps: ["A"] },
        { name: "C", est: 2, deps: ["A"] },
        { name: "D", est: 1, deps: ["B", "C"] },
      ]),
      monFri(),
    );
    expect(placed(s, "C").float).toBe(3);
    expect(placed(s, "A").float).toBe(0);
    expect(placed(s, "B").float).toBe(0);
    expect(placed(s, "D").float).toBe(0);
    expect(s.critical).toEqual([tid("A"), tid("B"), tid("D")]);
  });

  it("stretches 2.5 days at 50% to 5 working days", () => {
    const s = schedule(project([{ name: "Half", est: 2.5, alloc: 0.5 }]), monFri());
    expect(placed(s, "Half").duration).toBe(5);
    expect(span(s, "Half")).toEqual(["2026-09-28", "2026-10-02"]);
    // 1.5 days at 75% is exactly 2; 1 day at 75% rounds up to 2
    expect(placed(schedule(project([{ name: "Q", est: 1.5, alloc: 0.75 }]), monFri()), "Q").duration).toBe(2);
    expect(placed(schedule(project([{ name: "Q", est: 1, alloc: 0.75 }]), monFri()), "Q").duration).toBe(2);
    expect(placed(schedule(project([{ name: "Q", est: 250, alloc: 0.25 }]), monFri()), "Q").duration).toBe(1000);
  });

  it("moves a start pinned on a Saturday to the Monday", () => {
    const s = schedule(project([{ name: "Pinned", est: 2, pin: "2026-10-03" }]), monFri());
    expect(span(s, "Pinned")).toEqual(["2026-10-05", "2026-10-06"]);
    expect(placed(s, "Pinned").pinned).toBe(true);
  });

  it("dates a milestone after two parallel tasks on the later end, and starts its successors the next working day", () => {
    const s = schedule(
      project([
        { name: "Copy", est: 3 },
        { name: "Photos", est: 5 },
        { name: "Launch", kind: "milestone", deps: ["Copy", "Photos"] },
        { name: "After", est: 1, deps: ["Launch"] },
      ]),
      monFri(),
    );
    expect(span(s, "Photos")).toEqual(["2026-09-28", "2026-10-02"]);
    const launch = placed(s, "Launch");
    expect([launch.start, launch.end]).toEqual(["2026-10-02", "2026-10-02"]);
    expect(launch).toMatchObject({ milestone: true, duration: 0, float: 0, critical: true });
    expect(span(s, "After")).toEqual(["2026-10-05", "2026-10-05"]);
    expect(placed(s, "Copy").float).toBe(2);
  });

  it("makes UI Design unknown when its estimate is cleared, and Development waits on it", () => {
    const state = demoState();
    const p = activeProject(state);
    const ui = taskByTitle(p, "UI Design");
    const dev = taskByTitle(p, "Development");
    const cleared: ProjectDoc = { ...p, tasks: { ...p.tasks, [ui.id]: { ...ui, estimateDays: null } } };
    const s = schedule(cleared, monFri());
    expect(s.timings.get(ui.id)).toEqual({ kind: "unknown", reason: "noEstimate", cause: ui.id });
    expect(s.timings.get(dev.id)).toEqual({ kind: "unknown", reason: "waitsOn", cause: ui.id });
    // The end is a lower bound: Visual Direction's end, with open work unknown
    expect(s.end).toMatchObject({ date: "2026-10-06", complete: false });
    // Nothing upstream of an unknown task has a known float
    expect((s.timings.get(taskByTitle(p, "Research").id) as ScheduledTiming).float).toBeNull();
    expect((s.timings.get(taskByTitle(p, "Visual Direction").id) as ScheduledTiming).critical).toBe(false);
    expect(s.critical).toEqual([]);
  });

  it("gives the chain negative float when the deadline is 8 working days before the planned end", () => {
    const p = { ...activeProject(demoState()), deadline: d("2026-10-14") };
    const s = schedule(p, monFri());
    for (const title of ["Research", "Visual Direction", "UI Design", "Development"]) {
      const t = s.timings.get(taskByTitle(p, title).id) as ScheduledTiming;
      expect(t.float).toBe(-8);
      expect(t.critical).toBe(true);
    }
    // A deadline on a Saturday allows work through the Friday before it
    const sat = schedule({ ...p, deadline: d("2026-10-24") }, monFri());
    expect((sat.timings.get(taskByTitle(p, "Development").id) as ScheduledTiming).float).toBe(-1);
  });

  it("puts no task day inside a closure across New Year", () => {
    const cal = monFri([{ from: d("2026-12-24"), to: d("2027-01-06") }]);
    const s = schedule(
      project([
        { name: "Before", est: 3, pin: "2026-12-21" },
        { name: "Across", est: 4, deps: ["Before"] },
      ]),
      cal,
    );
    expect(span(s, "Before")).toEqual(["2026-12-21", "2026-12-23"]);
    expect(span(s, "Across")).toEqual(["2027-01-07", "2027-01-12"]);
    for (const name of ["Before", "Across"]) {
      const t = placed(s, name);
      for (let k = t.es; k < t.finish; k++) {
        const day = cal.dateAt(k);
        expect(day < "2026-12-24" || day > "2027-01-06").toBe(true);
      }
    }
  });
});

describe("unknown estimates", () => {
  it("propagate to every successor with the root cause, the first unknown predecessor in topological order", () => {
    const s = schedule(
      project([
        { name: "A", est: null },
        { name: "B", est: null },
        { name: "C", est: 2, deps: ["B", "A"] },
        { name: "D", est: 1, deps: ["C"] },
        { name: "E", est: 1 },
      ]),
      monFri(),
    );
    expect(timing(s, "A")).toEqual({ kind: "unknown", reason: "noEstimate", cause: tid("A") });
    expect(timing(s, "C")).toEqual({ kind: "unknown", reason: "waitsOn", cause: tid("A") });
    expect(timing(s, "D")).toEqual({ kind: "unknown", reason: "waitsOn", cause: tid("A") });
    expect(placed(s, "E").float).toBe(0);
  });

  it("are never rescued by a pin", () => {
    const s = schedule(
      project([
        { name: "A", est: null },
        { name: "B", est: 1, deps: ["A"], pin: "2026-11-02" },
      ]),
      monFri(),
    );
    expect(timing(s, "B")).toEqual({ kind: "unknown", reason: "waitsOn", cause: tid("A") });
  });

  it("make a Done task without an estimate unknown, but keep the end complete", () => {
    const s = schedule(project([{ name: "A", est: null, status: "done" }, { name: "B", est: 2 }]), monFri());
    expect(timing(s, "A")).toMatchObject({ kind: "unknown", reason: "noEstimate" });
    expect(s.end).toMatchObject({ complete: true, date: "2026-09-29" });
  });

  it("null the float of a task with any unknown task after it, directly or not", () => {
    const s = schedule(
      project([
        { name: "A", est: 1 },
        { name: "B", est: 1, deps: ["A"] },
        { name: "C", est: 1, deps: ["A"] },
        { name: "X", est: null },
        { name: "D", est: 1, deps: ["C", "X"] },
      ]),
      monFri(),
    );
    expect(placed(s, "A").float).toBeNull();
    expect(placed(s, "C").float).toBeNull();
    expect(placed(s, "B").float).not.toBeNull();
  });

  it("leave no end when nothing is scheduled", () => {
    const s = schedule(project([{ name: "A", est: null }]), monFri());
    expect(s.end).toBeNull();
    expect(s.critical).toEqual([]);
    expect(schedule(project([]), monFri()).end).toBeNull();
  });
});

describe("the anchor", () => {
  it("is absolute with a confirmed start, provisional without", () => {
    expect(schedule(project([{ name: "A" }]), monFri()).anchor.mode).toBe("absolute");
    expect(schedule(project([{ name: "A" }], { startConfirmed: false }), monFri()).anchor.mode).toBe("provisional");
  });

  it("falls back to the earliest pin, and starts on the next working day", () => {
    const s = schedule(
      project(
        [
          { name: "A", est: 2, pin: "2026-10-10" },
          { name: "B", est: 1, pin: "2026-10-17" },
          { name: "C", est: 1 },
        ],
        { startDate: null, startConfirmed: false },
      ),
      monFri(),
    );
    expect(s.anchor.date).toBe("2026-10-10");
    expect(s.anchor.mode).toBe("provisional");
    expect(s.anchor.ordinal).toBe(monFri().ordinal(d("2026-10-12")));
    expect(span(s, "C")).toEqual(["2026-10-12", "2026-10-12"]);
    expect(span(s, "B")).toEqual(["2026-10-19", "2026-10-19"]);
  });

  it("is relative without any date: positions only, no calendar dates", () => {
    const s = schedule(
      project(
        [
          { name: "A", est: 3 },
          { name: "B", est: 2, deps: ["A"], steps: [1] },
          { name: "M", kind: "milestone", deps: ["B"] },
        ],
        { startDate: null, startConfirmed: false, deadline: d("2026-01-01") },
      ),
      monFri(),
    );
    expect(s.anchor.date).toBeNull();
    expect(s.anchor.mode).toBe("relative");
    expect(placed(s, "A")).toMatchObject({ start: null, end: null, es: s.anchor.ordinal, finish: s.anchor.ordinal + 3 });
    expect(placed(s, "B").es - s.anchor.ordinal).toBe(3);
    expect(placed(s, "M").last - s.anchor.ordinal).toBe(4);
    expect(s.steps.get(sid("Bs0"))).toMatchObject({ start: null, end: null });
    expect(s.end).toMatchObject({ date: null, complete: true });
    // A deadline can't be placed without dates: floats come from the planned end
    expect(placed(s, "A").float).toBe(0);
  });

  it("clamps pins before the start to the start", () => {
    const s = schedule(project([{ name: "Early", est: 1, pin: "2026-09-01" }]), monFri());
    expect(span(s, "Early")).toEqual(["2026-09-28", "2026-09-28"]);
  });
});

describe("milestones", () => {
  it("without predecessors sit on the start, and their successors start the same day", () => {
    const s = schedule(
      project([
        { name: "Kickoff", kind: "milestone" },
        { name: "Gate", kind: "milestone", deps: ["Kickoff"] },
        { name: "Work", est: 2, deps: ["Gate"] },
      ]),
      monFri(),
    );
    expect(span(s, "Kickoff")).toEqual(["2026-09-28", "2026-09-28"]);
    expect(span(s, "Gate")).toEqual(["2026-09-28", "2026-09-28"]);
    expect(span(s, "Work")).toEqual(["2026-09-28", "2026-09-29"]);
  });

  it("pinned later than their predecessors sit on the pin", () => {
    const s = schedule(
      project([
        { name: "A", est: 2 },
        { name: "Review", kind: "milestone", deps: ["A"], pin: "2026-10-05" },
      ]),
      monFri(),
    );
    expect(span(s, "Review")).toEqual(["2026-10-05", "2026-10-05"]);
    // Pinned on the day the predecessor's finish falls on: still the pin
    const tied = schedule(
      project([
        { name: "A", est: 5 },
        { name: "Review", kind: "milestone", deps: ["A"], pin: "2026-10-05" },
      ]),
      monFri(),
    );
    expect(span(tied, "Review")).toEqual(["2026-10-05", "2026-10-05"]);
  });

  it("end the project on their own date", () => {
    const s = schedule(project([{ name: "A", est: 2 }, { name: "Done", kind: "milestone", deps: ["A"] }]), monFri());
    expect(s.end).toMatchObject({ date: "2026-09-29", complete: true });
  });
});

describe("steps (Q1)", () => {
  it("run back to back from the parent's start, skip unknown estimates and are cut at the parent's finish", () => {
    const s = schedule(project([{ name: "Parent", est: 4, steps: [1, null, 2, 3, 1] }]), monFri());
    const slot = (k: number) => s.steps.get(sid(`Parents${k}`));
    const A = s.anchor.ordinal;
    expect(slot(0)).toMatchObject({ es: A, finish: A + 1, start: "2026-09-28", end: "2026-09-28", overflows: false });
    expect(slot(1)).toBeNull();
    expect(slot(2)).toMatchObject({ es: A + 1, finish: A + 3, start: "2026-09-29", end: "2026-09-30", overflows: false });
    // 3 days from the fourth day: only one fits
    expect(slot(3)).toMatchObject({ es: A + 3, finish: A + 4, start: "2026-10-01", end: "2026-10-01", overflows: true });
    // Past the parent's end: kept on its last day
    expect(slot(4)).toMatchObject({ es: A + 3, finish: A + 4, start: "2026-10-01", end: "2026-10-01", overflows: true });
  });

  it("stretch with the parent's allocation", () => {
    const s = schedule(project([{ name: "Half", est: 2, alloc: 0.5, steps: [1, 1] }]), monFri());
    expect(s.steps.get(sid("Halfs0"))).toMatchObject({ start: "2026-09-28", end: "2026-09-29" });
    expect(s.steps.get(sid("Halfs1"))).toMatchObject({ start: "2026-09-30", end: "2026-10-01" });
  });

  it("have no slot when the parent is unknown", () => {
    const s = schedule(project([{ name: "Parent", est: null, steps: [1, 2] }]), monFri());
    expect(s.steps.get(sid("Parents0"))).toBeNull();
    expect(s.steps.get(sid("Parents1"))).toBeNull();
  });
});

describe("totality", () => {
  it("marks tasks on or behind a loop as unknown, and nulls the float before them", () => {
    const p = project([
      { name: "A", est: 1 },
      { name: "B", est: 1, deps: ["A", "C"] },
      { name: "C", est: 1, deps: ["B"] },
      { name: "D", est: 1, deps: ["C"] },
      { name: "E", est: 1 },
    ]);
    const s = schedule(p, monFri());
    expect(timing(s, "B")).toEqual({ kind: "unknown", reason: "cycle", cause: tid("B") });
    expect(timing(s, "C")).toEqual({ kind: "unknown", reason: "cycle", cause: tid("C") });
    expect(timing(s, "D")).toEqual({ kind: "unknown", reason: "cycle", cause: tid("D") });
    expect(placed(s, "A").float).toBeNull();
    expect(placed(s, "E").float).toBe(0);
    expect(s.topo).toEqual([tid("A"), tid("E"), tid("B"), tid("C"), tid("D")]);
    expect(s.end?.complete).toBe(false);
  });

  it("ignores dependencies on missing tasks", () => {
    const p = project([{ name: "A", est: 2 }]);
    const a = p.tasks[tid("A")];
    const s = schedule({ ...p, tasks: { [a.id]: { ...a, dependsOn: [tid("ghost")] } } }, monFri());
    expect(span(s, "A")).toEqual(["2026-09-28", "2026-09-29"]);
  });

  it(
    "stops at the planning horizon on a one-day week instead of running past year 9999",
    () => {
      // 420 tasks of 1,000 working days in one chain, on Sundays only: 420,000 working days
      const specs: Spec[] = Array.from({ length: 420 }, (_, i) => ({ name: `T${i}`, est: 250, alloc: 0.25, deps: i ? [`T${i - 1}`] : [] }));
      const s = schedule(project(specs), makeCalendar({ workingDays: [7], closures: [] }));
      const A = s.anchor.ordinal;
      expect(placed(s, "T399").finish - A).toBe(PLAN_SPAN_MAX);
      expect(placed(s, "T399").end! < "9999-12-31").toBe(true);
      expect(timing(s, "T400")).toEqual({ kind: "unknown", reason: "horizon", cause: tid("T400") });
      expect(timing(s, "T419")).toEqual({ kind: "unknown", reason: "waitsOn", cause: tid("T400") });
      expect(s.end).toMatchObject({ complete: false });
    },
    60_000,
  );

  it("treats a date the calendar can't hold as beyond the horizon", () => {
    // A hand-built calendar closed from November 2026 to the end of time
    const cal = monFri([{ from: d("2026-11-01"), to: far("9999-12-31") }]);
    const s = schedule(
      project([
        { name: "A", est: 5 },
        { name: "B", est: 30, deps: ["A"] },
        { name: "C", est: 1, deps: ["B"] },
      ]),
      cal,
    );
    expect(span(s, "A")).toEqual(["2026-09-28", "2026-10-02"]);
    expect(timing(s, "B")).toEqual({ kind: "unknown", reason: "horizon", cause: tid("B") });
    expect(timing(s, "C")).toEqual({ kind: "unknown", reason: "waitsOn", cause: tid("B") });
  }, 60_000);

  it("is deterministic and whatever the record key order", () => {
    const p = activeProject(demoState());
    const reversed = { ...p, tasks: Object.fromEntries(Object.entries(p.tasks).reverse()) as ProjectDoc["tasks"] };
    expect(schedule(reversed, monFri())).toEqual(schedule(p, monFri()));
  });
});

// The property suite runs these FC_RUNS times (test/property/schedule.property.test.ts)
describe("random projects", () => {
  it("are total: every task placed or unknown with a cause, never before a predecessor or a pin (plan §10.3 item 10)", () => {
    fc.assert(fc.property(scheduleCase, isTotal), { numRuns: 200 });
  });

  it("agree with the naive oracle on starts, finishes, causes and floats", () => {
    fc.assert(fc.property(scheduleCase, (c) => void agreesWithOracle(c)), { numRuns: 200 });
  });
});

