// The status and progress table (plan §5.5), tested exhaustively: 4 statuses × progress
// {0, 30, 95, 100} × every status and progress op × requireReview, plus the milestone rules, the
// five audit paths, the review switch, kind changes and the migration's repair.
import fc from "fast-check";
import { enablePatches, produceWithPatches } from "immer";
import { describe, expect, it } from "vitest";
import {
  applyKind,
  applyProgress,
  applyRequireReview,
  applyStatus,
  coherenceProblems,
  LEFT_DONE_PROGRESS,
  milestoneProblems,
  repairTask,
  titleInMessage,
  type TransitionProject,
} from "@/lib/domain/invariants/transitions";
import { nKeys } from "@/lib/domain/order";
import { type ProjectStatus, type Status, type Task, type TaskId, TaskId as TaskIdSchema, Timestamp } from "@/lib/domain/schema";
import { makeTask } from "../../../../test/fixtures/v2/build";

enablePatches();

const NOW = Timestamp.parse("2026-10-14T09:00:00Z");
const EARLIER = Timestamp.parse("2026-10-01T09:00:00Z");
const ID = TaskIdSchema.parse("tsk_transitions0001");

type Op = { kind: "status"; value: Status } | { kind: "progress"; value: number };

const COLUMNS: Op[] = [
  { kind: "status", value: "todo" },
  { kind: "status", value: "active" },
  { kind: "status", value: "review" },
  { kind: "status", value: "done" },
  { kind: "progress", value: 0 },
  { kind: "progress", value: 30 },
  { kind: "progress", value: 95 },
  { kind: "progress", value: 100 },
];

/**
 * Rows: the start "status@progress"; columns: status → todo, active, review, done, then progress
 * → 0, 30, 95, 100. Cells: the result, or "!" for a rejection that changes nothing. Starts that
 * are incoherent (todo@30, done@40…) can't be stored, but every op still lands on a coherent state.
 */
const WITHOUT_REVIEW = `
               →todo     →active   →review   →done     %0        %30       %95       %100
  todo@0       todo@0    active@0  review@0  done@100  todo@0    active@30 active@95 done@100
  todo@30      todo@0    active@30 review@30 done@100  todo@0    active@30 active@95 done@100
  todo@95      todo@0    active@95 review@95 done@100  todo@0    active@30 active@95 done@100
  todo@100     todo@0    active@95 review@95 done@100  todo@0    active@30 active@95 done@100
  active@0     todo@0    active@0  review@0  done@100  active@0  active@30 active@95 done@100
  active@30    todo@0    active@30 review@30 done@100  active@0  active@30 active@95 done@100
  active@95    todo@0    active@95 review@95 done@100  active@0  active@30 active@95 done@100
  active@100   todo@0    active@95 review@95 done@100  active@0  active@30 active@95 done@100
  review@0     todo@0    active@0  review@0  done@100  review@0  review@30 review@95 done@100
  review@30    todo@0    active@30 review@30 done@100  review@0  review@30 review@95 done@100
  review@95    todo@0    active@95 review@95 done@100  review@0  review@30 review@95 done@100
  review@100   todo@0    active@95 review@95 done@100  review@0  review@30 review@95 done@100
  done@0       todo@0    active@0  review@0  done@100  active@0  active@30 active@95 done@100
  done@30      todo@0    active@30 review@30 done@100  active@0  active@30 active@95 done@100
  done@95      todo@0    active@95 review@95 done@100  active@0  active@30 active@95 done@100
  done@100     todo@0    active@95 review@95 done@100  active@0  active@30 active@95 done@100
`;

/** With the review step: 100% means In review until someone marks it Done */
const WITH_REVIEW = `
               →todo     →active   →review   →done     %0        %30       %95       %100
  todo@0       todo@0    active@0  review@0  done@100  todo@0    active@30 active@95 review@100
  todo@30      todo@0    active@30 review@30 done@100  todo@0    active@30 active@95 review@100
  todo@95      todo@0    active@95 review@95 done@100  todo@0    active@30 active@95 review@100
  todo@100     todo@0    active@95 review@100 done@100 todo@0    active@30 active@95 review@100
  active@0     todo@0    active@0  review@0  done@100  active@0  active@30 active@95 review@100
  active@30    todo@0    active@30 review@30 done@100  active@0  active@30 active@95 review@100
  active@95    todo@0    active@95 review@95 done@100  active@0  active@30 active@95 review@100
  active@100   todo@0    active@95 review@100 done@100 active@0  active@30 active@95 review@100
  review@0     todo@0    active@0  review@0  done@100  review@0  review@30 review@95 review@100
  review@30    todo@0    active@30 review@30 done@100  review@0  review@30 review@95 review@100
  review@95    todo@0    active@95 review@95 done@100  review@0  review@30 review@95 review@100
  review@100   todo@0    active@95 review@100 done@100 review@0  review@30 review@95 review@100
  done@0       todo@0    active@0  review@0  done@100  active@0  active@30 active@95 done@100
  done@30      todo@0    active@30 review@30 done@100  active@0  active@30 active@95 done@100
  done@95      todo@0    active@95 review@95 done@100  active@0  active@30 active@95 done@100
  done@100     todo@0    active@95 review@100 done@100 active@0  active@30 active@95 done@100
`;

/** A milestone is only To do at 0% or Done at 100%, with or without the review step */
const MILESTONE = `
               →todo     →active   →review   →done     %0        %30       %95       %100
  todo@0       todo@0    !         !         done@100  todo@0    !         !         done@100
  done@100     todo@0    !         !         done@100  todo@0    !         !         done@100
`;

const parseState = (s: string) => {
  const [status, progress] = s.split("@");
  return { status: status as Status, progress: Number(progress) };
};

function parseGrid(grid: string): { start: string; op: Op; expected: string }[] {
  const [, ...rows] = grid.trim().split("\n");
  return rows.flatMap((row) => {
    const [start, ...cells] = row.trim().split(/\s+/);
    expect(cells).toHaveLength(COLUMNS.length);
    return cells.map((expected, i) => ({ start, op: COLUMNS[i], expected }));
  });
}

function startTask(start: string, kind: Task["kind"] = "task"): Task {
  const { status, progress } = parseState(start);
  return makeTask({
    id: ID,
    title: "UI Design",
    kind,
    status,
    progress,
    estimateDays: kind === "milestone" ? 0 : 6,
    order: "a0",
    // A Done start keeps its own completion time, so re-marking it Done must not restamp it
    completedAt: status === "done" ? EARLIER : null,
  });
}

/** Runs one op through Immer, as a reducer would */
function run(task: Task, op: Op, requireReview: boolean, projectStatus: ProjectStatus = "planning") {
  const base = { task, project: { requireReview, status: projectStatus } as TransitionProject };
  let rejection: unknown;
  const [after, patches] = produceWithPatches(base, (d) => {
    rejection = op.kind === "status" ? applyStatus(d.task, op.value, d.project, NOW) : applyProgress(d.task, op.value, d.project, NOW);
  });
  return { after, patches, rejection };
}

function checkGrid(grid: string, requireReview: boolean, kind: Task["kind"]) {
  for (const { start, op, expected } of parseGrid(grid)) {
    const label = `${kind} ${start} ${op.kind} → ${op.value} (requireReview ${requireReview})`;
    const task = startTask(start, kind);
    const { after, patches, rejection } = run(task, op, requireReview);
    if (expected === "!") {
      expect(rejection, label).toMatchObject({ code: "invalid_state" });
      expect(patches, label).toEqual([]);
      continue;
    }
    expect(rejection, label).toBeUndefined();
    const { status, progress } = parseState(expected);
    expect(`${after.task.status}@${after.task.progress}`, label).toBe(expected);
    // Every result is coherent, from any start
    expect(coherenceProblems(after.task, requireReview), label).toEqual([]);
    expect(milestoneProblems(after.task), label).toEqual([]);
    // completedAt: stamped on entering Done, kept when already Done, cleared otherwise
    const completedAt = status === "done" ? (task.status === "done" ? EARLIER : NOW) : null;
    expect(after.task.completedAt, label).toBe(completedAt);
    // A task that starts work takes a planning project with it
    const starts = status === "active" && task.status !== "active";
    expect(after.project.status, label).toBe(starts ? "active" : "planning");
    // Same values write nothing: no patch, same reference
    const unchanged = status === task.status && progress === task.progress && completedAt === task.completedAt && !starts;
    expect(patches.length === 0, label).toBe(unchanged);
    if (unchanged) expect(after.task, label).toBe(task);
  }
}

describe("the status and progress table", () => {
  it("covers every status × progress × op without the review step", () => {
    expect(parseGrid(WITHOUT_REVIEW)).toHaveLength(16 * 8);
    checkGrid(WITHOUT_REVIEW, false, "task");
  });

  it("covers every status × progress × op with the review step", () => {
    expect(parseGrid(WITH_REVIEW)).toHaveLength(16 * 8);
    checkGrid(WITH_REVIEW, true, "task");
  });

  it("keeps milestones to To do at 0% or Done at 100%", () => {
    checkGrid(MILESTONE, false, "milestone");
    checkGrid(MILESTONE, true, "milestone");
    const { rejection } = run(startTask("todo@0", "milestone"), { kind: "status", value: "active" }, false);
    expect(rejection).toEqual({ code: "invalid_state", message: "UI Design is a milestone: it's either to do or done." });
  });

  it("starts a planning project only, never one on hold or done", () => {
    for (const status of ["active", "on-hold", "done"] as const) {
      const { after } = run(startTask("todo@0"), { kind: "status", value: "active" }, false, status);
      expect(after.project.status).toBe(status);
    }
  });
});

describe("the five audit paths (AUDIT §1)", () => {
  const apply = (start: string, ops: Op[], requireReview = false) => {
    let task = startTask(start);
    for (const op of ops) task = run(task, op, requireReview).after.task;
    return `${task.status}@${task.progress}`;
  };

  it('"Mark UI Design done at 40%" ends Done at 100%, never done@40', () => {
    expect(apply("active@30", [{ kind: "progress", value: 40 }, { kind: "status", value: "done" }])).toBe("done@100");
    expect(apply("done@100", [{ kind: "progress", value: 40 }])).toBe("active@40");
  });

  it("moving back to To do clears the progress (todo@30, todo@100)", () => {
    expect(apply("active@30", [{ kind: "status", value: "todo" }])).toBe("todo@0");
    expect(apply("done@100", [{ kind: "status", value: "todo" }])).toBe("todo@0");
  });

  it(`leaving Done lands at ${LEFT_DONE_PROGRESS}% (active@100, review@100)`, () => {
    expect(apply("done@100", [{ kind: "status", value: "active" }])).toBe("active@95");
    expect(apply("done@100", [{ kind: "status", value: "review" }])).toBe("review@95");
    expect(apply("done@100", [{ kind: "status", value: "review" }], true)).toBe("review@100");
  });
});

describe("applyRequireReview", () => {
  const keys = nKeys(4);
  const ids = ["tsk_review000000001", "tsk_review000000002", "tsk_review000000003", "tsk_review000000004"].map((id) => TaskIdSchema.parse(id));
  const project = (requireReview: boolean) => ({
    requireReview,
    tasks: {
      // Record order differs from workflow order on purpose
      [ids[3]]: makeTask({ id: ids[3], title: "D", status: "review", progress: 100, order: keys[0] }),
      [ids[0]]: makeTask({ id: ids[0], title: "A", status: "review", progress: 100, order: keys[1] }),
      [ids[1]]: makeTask({ id: ids[1], title: "B", status: "review", progress: 90, order: keys[2] }),
      [ids[2]]: makeTask({ id: ids[2], title: "C", status: "done", progress: 100, completedAt: EARLIER, order: keys[3] }),
    } as Record<TaskId, Task>,
  });

  it("turning it off makes every review@100 Done, named in workflow order", () => {
    let completed: TaskId[] = [];
    const [after] = produceWithPatches(project(true), (d) => {
      completed = applyRequireReview(d, false, NOW);
    });
    expect(completed).toEqual([ids[3], ids[0]]);
    expect(after.requireReview).toBe(false);
    expect([ids[0], ids[1], ids[2], ids[3]].map((id) => `${after.tasks[id].status}@${after.tasks[id].progress}`)).toEqual([
      "done@100",
      "review@90",
      "done@100",
      "done@100",
    ]);
    expect(after.tasks[ids[0]].completedAt).toBe(NOW);
    expect(after.tasks[ids[2]].completedAt).toBe(EARLIER);
    for (const t of Object.values(after.tasks)) expect(coherenceProblems(t, false)).toEqual([]);
  });

  it("turning it on changes only the flag; the same value changes nothing", () => {
    const off = { ...project(false), tasks: {} as Record<TaskId, Task> };
    const [on, onPatches] = produceWithPatches(off, (d) => void applyRequireReview(d, true, NOW));
    expect(on.requireReview).toBe(true);
    expect(onPatches).toEqual([{ op: "replace", path: ["requireReview"], value: true }]);
    const [same, samePatches] = produceWithPatches(project(true), (d) => void applyRequireReview(d, true, NOW));
    expect(samePatches).toEqual([]);
    expect(same.requireReview).toBe(true);
  });
});

describe("applyKind", () => {
  const kindOf = (task: Task, kind: Task["kind"]) => {
    let rejection: unknown;
    const [after, patches] = produceWithPatches({ task }, (d) => {
      rejection = applyKind(d.task, kind);
    });
    return { after: after.task, patches, rejection };
  };

  it("makes a milestone take no time", () => {
    const { after, rejection } = kindOf(makeTask({ id: ID, title: "Launch", estimateDays: 3, allocation: 0.5, order: "a0" }), "milestone");
    expect(rejection).toBeUndefined();
    expect(after).toMatchObject({ kind: "milestone", estimateDays: 0, allocation: 1, status: "todo", progress: 0 });
    expect(milestoneProblems(after)).toEqual([]);
  });

  it("refuses a task with steps or with work under way", () => {
    const withSteps = makeTask({
      id: ID,
      title: "Launch",
      order: "a0",
      steps: [{ id: "stp_kindstep000001" as never, title: "QA", done: false, ownerId: null, estimateDays: null }],
    });
    expect(kindOf(withSteps, "milestone")).toMatchObject({ rejection: { code: "invalid_state" }, patches: [] });
    const started = makeTask({ id: ID, title: "Launch", order: "a0", status: "review", progress: 60 });
    expect(kindOf(started, "milestone")).toMatchObject({ rejection: { code: "invalid_state" }, patches: [] });
  });

  it("gives a milestone that becomes a task an unknown estimate", () => {
    const { after } = kindOf(makeTask({ id: ID, title: "Launch", kind: "milestone", estimateDays: 0, order: "a0" }), "task");
    expect(after).toMatchObject({ kind: "task", estimateDays: null });
  });

  it("writes nothing for the same kind", () => {
    expect(kindOf(makeTask({ id: ID, title: "Launch", order: "a0" }), "task").patches).toEqual([]);
  });
});

describe("repairTask (migration only, status wins)", () => {
  const repair = (start: string, requireReview = false, kind: Task["kind"] = "task") => {
    const task = { ...startTask(start, kind), completedAt: null };
    const out = repairTask(task, requireReview);
    return { out, same: out === task, state: `${out.status}@${out.progress}` };
  };

  it("fixes the five incoherent v0 states", () => {
    expect(repair("done@40" as string).state).toBe("done@100");
    expect(repair("todo@30").state).toBe("active@30");
    expect(repair("review@100").state).toBe("review@95");
    expect(repair("active@100").state).toBe("active@95");
    expect(repair("todo@100").state).toBe("active@95");
  });

  it("keeps review@100 with the review step, and never active@100", () => {
    expect(repair("review@100", true).state).toBe("review@100");
    expect(repair("active@100", true).state).toBe("active@95");
  });

  it("returns coherent tasks unchanged, by reference", () => {
    for (const start of ["todo@0", "active@0", "active@30", "review@95", "done@100"]) expect(repair(start).same).toBe(true);
  });

  it("clears completedAt: when an imported task was completed is unknown", () => {
    const task = { ...startTask("done@100"), completedAt: EARLIER };
    expect(repairTask(task).completedAt).toBeNull();
  });

  it("lands every start on a coherent state", () => {
    for (const status of ["todo", "active", "review", "done"]) {
      for (const progress of [0, 1, 30, 95, 99, 100]) {
        for (const requireReview of [false, true]) {
          for (const kind of ["task", "milestone"] as const) {
            const { out } = repair(`${status}@${progress}`, requireReview, kind);
            expect(coherenceProblems(out, requireReview)).toEqual([]);
            if (kind === "milestone") expect(milestoneProblems(out)).toEqual([]);
          }
        }
      }
    }
  });
});

describe("coherence under any sequence of ops", () => {
  const opArb: fc.Arbitrary<Op | { kind: "review"; value: boolean }> = fc.oneof(
    fc.constantFrom(...(["todo", "active", "review", "done"] as const)).map((value) => ({ kind: "status" as const, value })),
    fc.integer({ min: 0, max: 100 }).map((value) => ({ kind: "progress" as const, value })),
    fc.boolean().map((value) => ({ kind: "review" as const, value })),
  );

  it("never leaves a task incoherent", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.array(opArb, { maxLength: 30 }), (requireReview, ops) => {
        let state = { requireReview, status: "planning" as ProjectStatus, tasks: { [ID]: startTask("todo@0") } as Record<TaskId, Task> };
        for (const op of ops) {
          state = produceWithPatches(state, (d) => {
            if (op.kind === "review") applyRequireReview(d, op.value, NOW);
            else if (op.kind === "status") applyStatus(d.tasks[ID], op.value, d, NOW);
            else applyProgress(d.tasks[ID], op.value, d, NOW);
          })[0];
          expect(coherenceProblems(state.tasks[ID], state.requireReview)).toEqual([]);
        }
      }),
    );
  });
});

describe("messages", () => {
  it("cut long titles so a rejection stays within a caption part", () => {
    const title = "x".repeat(140);
    const { rejection } = run({ ...startTask("todo@0", "milestone"), title }, { kind: "progress", value: 30 }, false);
    expect((rejection as { message: string }).message.length).toBeLessThanOrEqual(140);
    expect(titleInMessage("UI Design")).toBe("UI Design");
    expect(Array.from(titleInMessage("é".repeat(80)))).toHaveLength(60);
  });
});
