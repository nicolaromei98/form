// Load, lanes, balance, leveling and focus over random workspaces (plan §10.3 "Also covered by
// properties"). Runs FC_RUNS times (10,000 in CI):
// - weeklyLoad: the weeks add up to the estimates of open, owned, dated tasks;
// - lanes: every open task sits in exactly one row, and the rows add up to the project's load;
// - balance: a move never overloads its receiver in any week;
// - leveling: once its pins are applied, nobody's daily usage passes 1 on a day of movable work,
//   and leveling again changes nothing;
// - focus: FORM never picks a blocked or Done task.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { IsoWeekKey } from "@/lib/domain/dates";
import { PROPOSAL_ITEMS_MAX, PROPOSAL_WHY } from "@/lib/domain/limits";
import type { PersonId, ProjectDoc, ProjectId, Task, TaskId } from "@/lib/domain/schema";
import { planProject, type ProjectPlan } from "@/lib/planning";
import { balance } from "@/lib/planning/balance";
import { focus } from "@/lib/planning/focus";
import { laneLoads } from "@/lib/planning/lanes";
import { level } from "@/lib/planning/level";
import { capacityInWeek, countsForLoad, openTaskLoads, weeklyLoad } from "@/lib/planning/load";
import { plansOf, settledFirst, type WorkloadCase, workloadCase } from "@/lib/planning/__tests__/workload-cases";

const TOLERANCE = 1e-4;

const isOpen = (t: Task) => t.status !== "done";
const activePerson = (c: WorkloadCase, id: PersonId | null) => id !== null && Object.hasOwn(c.workspace.people, id) && !c.workspace.people[id].archived;

/** The estimate of an open task that has dates, else 0 */
function datedLoad(plan: ProjectPlan, t: Task): number {
  const timing = plan.schedule.timings.get(t.id);
  if (!isOpen(t) || timing?.kind !== "scheduled" || timing.start === null) return 0;
  return t.estimateDays ?? 0;
}

describe("weeklyLoad", () => {
  it("adds up to the estimates of open, owned, dated tasks in the projects that count", () => {
    fc.assert(
      fc.property(workloadCase, (c) => {
        const plans = plansOf(c);
        const report = weeklyLoad(c.workspace, plans);
        let total = 0;
        for (const [personId, weeks] of report.people) {
          expect(activePerson(c, personId)).toBe(true);
          for (const cell of weeks.values()) {
            total += cell.load;
            let split = 0;
            for (const days of cell.byProject.values()) split += days;
            expect(Math.abs(split - cell.load)).toBeLessThan(TOLERANCE);
            expect(cell.capacity).toBe(capacityInWeek(c.workspace, c.workspace.people[personId], cell.monday));
          }
        }
        let expected = 0;
        for (const plan of plans) {
          if (!countsForLoad(c.workspace, plan.project)) continue;
          for (const t of Object.values(plan.project.tasks)) if (activePerson(c, t.ownerId)) expected += datedLoad(plan, t);
        }
        expect(Math.abs(total - expected)).toBeLessThan(TOLERANCE);

        // What isn't on the calendar is open, owned by an active person and has no dates
        for (const [personId, list] of report.notOnCalendar) {
          for (const { projectId, taskId } of list) {
            const plan = plans.find((p) => p.project.id === projectId)!;
            const t = plan.project.tasks[taskId];
            expect(isOpen(t) && t.ownerId === personId && activePerson(c, personId)).toBe(true);
            const timing = plan.schedule.timings.get(taskId)!;
            expect(timing.kind === "unknown" || timing.start === null).toBe(true);
          }
        }
        // The order of the plans doesn't matter
        expect(weeklyLoad(c.workspace, [...plans].reverse())).toEqual(report);
      }),
    );
  });
});

describe("laneLoads", () => {
  it("puts every open task in exactly one row, and the rows add up to the project's dated load", () => {
    fc.assert(
      fc.property(workloadCase, (c) => {
        const plans = plansOf(c);
        const report = weeklyLoad(c.workspace, plans);
        for (const plan of plans) {
          const lanes = laneLoads(plan, report, c.workspace);
          expect(lanes[lanes.length - 1].personId).toBeNull();
          const seen = lanes.flatMap((l) => l.taskIds);
          const open = Object.values(plan.project.tasks).filter(isOpen);
          expect([...seen].sort()).toEqual(open.map((t) => t.id).sort());
          const days = lanes.reduce((s, l) => s + l.days, 0);
          const expected = open.reduce((s, t) => s + datedLoad(plan, t), 0);
          expect(Math.abs(days - expected)).toBeLessThan(TOLERANCE);
          for (const l of lanes) {
            if (l.capacity === null) {
              expect([l.over, l.free]).toEqual([null, null]);
              continue;
            }
            expect(l.over!).toBeGreaterThanOrEqual(0);
            expect(l.free!).toBeGreaterThanOrEqual(0);
            // over − free = Σ (load − capacity) over the window
            expect(Math.abs(l.over! - l.free! - (l.days + l.otherProjectsDays - l.capacity))).toBeLessThan(TOLERANCE);
          }
        }
      }),
    );
  });
});

/** Everyone's load per week, as balance counts it: the counted projects and the one in scope */
function loadsWith(c: WorkloadCase, plans: readonly ProjectPlan[], scope: ProjectId, overrides: ReadonlyMap<TaskId, PersonId | null>) {
  const loads = new Map<PersonId, Map<IsoWeekKey, number>>();
  for (const plan of plans) {
    if (plan.project.id !== scope && !countsForLoad(c.workspace, plan.project)) continue;
    for (const t of openTaskLoads(c.workspace, plan, overrides)) {
      if (t.personId === null || t.weeks === null) continue;
      let byWeek = loads.get(t.personId);
      if (byWeek === undefined) loads.set(t.personId, (byWeek = new Map()));
      for (const w of t.weeks) byWeek.set(w.week, (byWeek.get(w.week) ?? 0) + w.load);
    }
  }
  return loads;
}

describe("balance", () => {
  it("never overloads a receiver in any week of the task it receives", () => {
    fc.assert(
      fc.property(workloadCase, fc.boolean(), (c, allowShift) => {
        const plans = plansOf(c);
        for (const plan of plans) {
          const scope = plan.project.id;
          const { moves, blocked } = balance(c.workspace, plans, scope, { allowShift });
          expect(moves.length).toBeLessThanOrEqual(PROPOSAL_ITEMS_MAX);
          if (blocked !== null) expect(blocked.over).toBeGreaterThan(0);
          const overrides = new Map<TaskId, PersonId | null>();
          const before = new Map(openTaskLoads(c.workspace, plan).map((t) => [t.task.id, t]));
          for (const m of moves) {
            const t = before.get(m.taskId);
            expect(t).toBeDefined();
            expect(m.why.length).toBeGreaterThan(0);
            expect(m.why.length).toBeLessThanOrEqual(PROPOSAL_WHY);
            if (m.type === "shift") {
              const timing = plan.schedule.timings.get(m.taskId)!;
              expect(timing.kind === "scheduled" && timing.float !== null && m.days >= 1 && m.days <= timing.float).toBe(true);
              continue;
            }
            const person = c.workspace.people[m.to];
            expect(activePerson(c, m.to) && person.capacityDaysPerWeek !== null).toBe(true);
            expect(m.to).not.toBe(overrides.get(m.taskId) ?? t!.personId);
            // A handover moves only work not yet in review; unowned work may be any open status
            if (t!.personId !== null) expect(["todo", "active"]).toContain(t!.task.status);
            overrides.set(m.taskId, m.to);
          }
          const loads = loadsWith(c, plans, scope, overrides);
          for (const m of moves) {
            if (m.type !== "owner") continue;
            const person = c.workspace.people[m.to];
            for (const w of before.get(m.taskId)!.weeks!) {
              const cap = capacityInWeek(c.workspace, person, w.monday)!;
              expect(loads.get(m.to)!.get(w.week)!).toBeLessThanOrEqual(cap + 1e-6);
            }
          }
        }
      }),
    );
  });
});

describe("level", () => {
  it("keeps every day of movable work at or under a full day once its pins apply, and is stable", () => {
    fc.assert(
      fc.property(workloadCase, (raw) => {
        const c = settledFirst(raw);
        for (const project of c.projects) {
          const plan = planProject(project, c.workspace, c.today);
          const moves = level(c.workspace, plan);
          // A project without a start date is left alone (a pin needs a date, or would move the start)
          if (project.startDate === null) {
            expect(moves).toEqual([]);
            continue;
          }
          const tasks = { ...project.tasks };
          for (const m of moves) {
            const timing = plan.schedule.timings.get(m.taskId)!;
            expect(timing.kind === "scheduled" && m.days >= 1 && m.pinnedStart > timing.start!).toBe(true);
            expect(["todo", "active"]).toContain(tasks[m.taskId].status);
            tasks[m.taskId] = { ...tasks[m.taskId], pinnedStart: m.pinnedStart };
          }
          const leveled: ProjectDoc = { ...project, tasks };
          const after = planProject(leveled, c.workspace, c.today);
          // Leveling the leveled project changes nothing
          expect(level(c.workspace, after)).toEqual([]);

          // Daily usage per owner, and which days hold movable work
          const usage = new Map<string, number>();
          const movable = new Set<string>();
          for (const t of Object.values(leveled.tasks)) {
            const timing = after.schedule.timings.get(t.id);
            if (t.status === "done" || !activePerson(c, t.ownerId) || timing?.kind !== "scheduled" || timing.duration === 0) continue;
            const share = (t.estimateDays ?? 0) / timing.duration;
            for (let j = timing.es; j < timing.finish; j++) {
              const key = `${t.ownerId}|${j}`;
              usage.set(key, (usage.get(key) ?? 0) + share);
              if (t.status === "todo" || t.status === "active") movable.add(key);
            }
          }
          for (const key of movable) expect(usage.get(key)!).toBeLessThanOrEqual(1 + 1e-9);
        }
      }),
    );
  });
});

describe("focus", () => {
  it("never picks a blocked or Done task, and a pin wins while it is open", () => {
    fc.assert(
      fc.property(workloadCase, fc.nat(), (c, who) => {
        const plans = plansOf(c);
        for (const plan of plans) {
          const tasks = plan.project.tasks;
          const isBlocked = (t: Task) => t.status === "todo" && t.dependsOn.some((d) => Object.hasOwn(tasks, d) && tasks[d].status !== "done");
          const f = plan.focus;
          expect([...f.blocked].sort()).toEqual(
            Object.values(tasks)
              .filter(isBlocked)
              .map((t) => t.id)
              .sort(),
          );
          for (const r of f.ranked) {
            expect(isOpen(tasks[r.taskId]) && !isBlocked(tasks[r.taskId])).toBe(true);
            expect(r.score).toBe(r.reasons.reduce((s, x) => s + x.points, 0));
            expect(r.why).toMatch(/^[A-Z0-9].*\.$/);
          }
          for (let i = 1; i < f.ranked.length; i++) expect(f.ranked[i - 1].score).toBeGreaterThanOrEqual(f.ranked[i].score);
          const pin = plan.project.viewConfig.focusPin;
          if (pin !== null && Object.hasOwn(tasks, pin) && isOpen(tasks[pin])) {
            expect(f.pick).toMatchObject({ taskId: pin, chosenBy: "you" });
          } else if (f.pick !== null) {
            expect(f.pick.chosenBy).toBe("form");
            expect(f.pick.taskId).toBe(f.ranked[0].taskId);
          } else {
            expect(f.ranked).toEqual([]);
          }
        }
        // "My focus" across projects holds only that person's tasks
        const people = Object.keys(c.workspace.people) as PersonId[];
        const me = people[who % people.length];
        const mine = focus(plans, { today: c.today, ownerId: me });
        const ownerOf = (id: TaskId) => plans.find((p) => Object.hasOwn(p.project.tasks, id))!.project.tasks[id].ownerId;
        for (const r of mine.ranked) expect(ownerOf(r.taskId)).toBe(me);
        if (mine.pick !== null) expect(ownerOf(mine.pick.taskId)).toBe(me);
      }),
    );
  });
});
