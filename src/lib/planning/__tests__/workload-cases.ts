// Test helper (not a test file): random workspaces for load, lanes, balance, leveling and focus.
// The property suite (test/property/workload.property.test.ts) and the unit tests use it.
//
// A case is a workspace with up to 5 people (unknown, zero and fractional capacities, time off,
// archived people, roles that match loosely) and up to 3 projects (every status, archived in the
// index, with or without a start, confirmed or not) of up to 14 tasks (unknown estimates,
// milestones, every allocation, pins, due dates, owners that are missing or archived, every
// status with a coherent progress), on a random calendar with closures.
import fc from "fast-check";
import { addDays, fromDayNum, toDayNum } from "@/lib/domain/dates";
import { nKeys } from "@/lib/domain/order";
import {
  type Allocation,
  type ClosureId,
  defaultViewConfig,
  type IsoDate,
  type Person,
  type PersonId,
  type Priority,
  type ProjectDoc,
  type ProjectId,
  type Status,
  type Task,
  type TaskId,
  type TimeOffId,
  type Timestamp,
  type WorkspaceDoc,
} from "@/lib/domain/schema";
import { planProject, type ProjectPlan } from "@/lib/planning";
import { byId, emptyWorkspace, FIXTURE_NOW, makePerson, makeProject, makeTask, SAMPLE_START } from "../../../../test/fixtures/v2/build";

export interface WorkloadCase {
  workspace: WorkspaceDoc;
  projects: ProjectDoc[];
  today: IsoDate;
}

const ROLES = [null, "Designer", " designer ", "Developer", "Art director"] as const;
const PRIORITIES: readonly Priority[] = ["low", "medium", "high", "urgent"];
const STATUSES: readonly Status[] = ["todo", "todo", "active", "review", "done"];
const PROJECT_STATUSES = ["active", "active", "active", "planning", "on-hold", "done"] as const;
const MISSING = "per_missingmissing" as PersonId;

const day = (offset: number) => fromDayNum(toDayNum(SAMPLE_START) + offset);
const pid = (i: number) => `per_person${String(i).padStart(6, "0")}` as PersonId;
const prj = (i: number) => `prj_project${String(i).padStart(5, "0")}` as ProjectId;
const tsk = (p: number, i: number) => `tsk_task${p}x${String(i).padStart(6, "0")}` as TaskId;

const range = fc.tuple(fc.integer({ min: -10, max: 80 }), fc.integer({ min: 0, max: 10 }));

/** A value one time in `oneIn`, else null (fc.option's `freq` gives the opposite: null one time in freq) */
const sometimes = <T>(arb: fc.Arbitrary<T>, oneIn: number): fc.Arbitrary<T | null> =>
  fc.oneof({ arbitrary: fc.constant(null), weight: oneIn - 1 }, { arbitrary: arb, weight: 1 });

const personArb = fc.record({
  capacity: fc.option(fc.integer({ min: 0, max: 14 }).map((h) => h / 2), { nil: null, freq: 5 }),
  role: fc.constantFrom(...ROLES),
  archived: fc.integer({ min: 0, max: 9 }).map((k) => k === 0),
  timeOff: fc.array(range, { maxLength: 2 }),
});

const taskArb = fc.record({
  est: fc.option(fc.integer({ min: 1, max: 16 }).map((h) => h / 2), { nil: null, freq: 7 }),
  milestone: fc.integer({ min: 0, max: 9 }).map((k) => k === 0),
  alloc: fc.constantFrom<Allocation>(1, 1, 0.75, 0.5, 0.25),
  pin: sometimes(fc.integer({ min: -5, max: 40 }), 6),
  due: sometimes(fc.integer({ min: 0, max: 50 }), 4),
  preds: fc.array(fc.nat(), { maxLength: 2 }),
  status: fc.constantFrom(...STATUSES),
  progress: fc.integer({ min: 1, max: 19 }),
  priority: fc.constantFrom(...PRIORITIES),
  /** −1 unassigned, −2 a missing person, else a person (modulo the team) */
  owner: fc.integer({ min: -2, max: 9 }),
  steps: fc.array(fc.boolean(), { maxLength: 2 }),
});

const projectArb = fc.record({
  status: fc.constantFrom(...PROJECT_STATUSES),
  archived: fc.integer({ min: 0, max: 9 }).map((k) => k === 0),
  start: fc.option(fc.integer({ min: -10, max: 20 }), { nil: null, freq: 8 }),
  confirmed: fc.boolean(),
  deadline: sometimes(fc.integer({ min: 5, max: 60 }), 4),
  tasks: fc.array(taskArb, { maxLength: 14 }),
  pin: sometimes(fc.nat(), 4),
  members: fc.array(fc.integer({ min: -1, max: 5 }), { maxLength: 4 }),
});

function progressOf(status: Status, k: number): number {
  if (status === "done") return 100;
  if (status === "todo") return 0;
  return status === "review" ? 60 + 2 * k : 5 * k;
}

export const workloadCase: fc.Arbitrary<WorkloadCase> = fc
  .record({
    weekdays: fc.uniqueArray(fc.integer({ min: 1, max: 7 }), { minLength: 1, maxLength: 7 }),
    closures: fc.array(range, { maxLength: 2 }),
    people: fc.array(personArb, { minLength: 1, maxLength: 5 }),
    projects: fc.array(projectArb, { minLength: 1, maxLength: 3 }),
    today: fc.integer({ min: -5, max: 60 }),
  })
  .map((c) => {
    const people: Person[] = c.people.map((p, i) =>
      makePerson({
        id: pid(i),
        name: `Person ${i}`,
        role: p.role === null ? null : p.role,
        capacityDaysPerWeek: p.capacity,
        archived: p.archived,
        order: nKeys(c.people.length)[i],
        timeOff: byId(p.timeOff.map(([from, len], k) => ({ id: `tof_off${i}x${k}xxxxxxxx` as TimeOffId, from: day(from), to: day(from + len), label: null }))),
      }),
    );
    const ownerOf = (k: number): PersonId | null => (k < 0 ? (k === -1 ? null : MISSING) : people[k % people.length].id);

    const projects = c.projects.map((pc, p) => {
      const keys = nKeys(pc.tasks.length);
      const tasks: Task[] = pc.tasks.map((t, i) => {
        const deps = i === 0 ? [] : [...new Set(t.preds.map((k) => k % i))].map((k) => tsk(p, k));
        const milestone = t.milestone;
        const status = milestone && (t.status === "active" || t.status === "review") ? "todo" : t.status;
        return makeTask({
          id: tsk(p, i),
          title: `Task ${p}.${i}`,
          order: keys[i],
          kind: milestone ? "milestone" : "task",
          estimateDays: milestone ? 0 : t.est,
          allocation: milestone ? 1 : t.alloc,
          pinnedStart: t.pin === null ? null : day(t.pin),
          dueDate: t.due === null ? null : day(t.due),
          dependsOn: deps,
          status,
          progress: progressOf(status, t.progress),
          priority: t.priority,
          ownerId: ownerOf(t.owner),
          completedAt: status === "done" ? FIXTURE_NOW : null,
          steps: milestone
            ? []
            : t.steps.map((done, k) => ({ id: `stp_step${p}x${i}x${k}xxxx` as never, title: `Step ${k + 1}`, done, ownerId: null, estimateDays: null })),
        });
      });
      const memberIds = [...new Set(pc.members.map(ownerOf).filter((id): id is PersonId => id !== null && id !== MISSING))];
      return makeProject({
        id: prj(p),
        workspaceId: emptyWorkspace().id,
        title: `Project ${p}`,
        status: pc.status,
        startDate: pc.start === null ? null : day(pc.start),
        startConfirmed: pc.confirmed,
        deadline: pc.deadline === null ? null : day(pc.deadline),
        memberIds,
        tasks: byId(tasks),
        createdAt: `2026-09-0${p + 1}T09:00:00Z` as Timestamp,
        viewConfig: { ...defaultViewConfig(), focusPin: pc.pin === null || tasks.length === 0 ? null : tasks[pc.pin % tasks.length].id },
      });
    });

    const workspace = emptyWorkspace({
      workingDays: [...c.weekdays].sort(),
      closures: byId(c.closures.map(([from, len], k) => ({ id: `cls_closure${k}xxxxxx` as ClosureId, from: day(from), to: day(from + len), label: "Closed" }))),
      people: byId(people),
      projects: Object.fromEntries(
        projects.map((p, i) => [p.id, { id: p.id, createdAt: p.createdAt, archivedAt: c.projects[i].archived ? FIXTURE_NOW : null, deletedAt: null }]),
      ),
    });
    return { workspace, projects, today: addDays(SAMPLE_START, c.today) };
  });

/** Every project's plan on the case's day */
export function plansOf(c: WorkloadCase): ProjectPlan[] {
  return c.projects.map((p) => planProject(p, c.workspace, c.today));
}

/**
 * The case with Review and Done tasks that wait on open work turned In progress: leveling holds
 * Review work where it is, which only stays true when nothing before it moves.
 */
export function settledFirst(c: WorkloadCase): WorkloadCase {
  const projects = c.projects.map((p) => {
    const tasks = { ...p.tasks };
    for (const id of planProject(p, c.workspace, c.today).schedule.topo) {
      const t = tasks[id];
      const fixed = (x: Task) => x.status === "review" || x.status === "done";
      if (fixed(t) && t.kind === "task" && t.dependsOn.some((d) => Object.hasOwn(tasks, d) && !fixed(tasks[d]))) {
        tasks[id] = { ...t, status: "active", progress: 50, completedAt: null };
      } else if (fixed(t) && t.kind === "milestone" && t.dependsOn.some((d) => Object.hasOwn(tasks, d) && !fixed(tasks[d]))) {
        tasks[id] = { ...t, status: "todo", progress: 0, completedAt: null };
      }
    }
    return { ...p, tasks };
  });
  return { ...c, projects };
}
