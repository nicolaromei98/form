// The dependency graph (plan §6.2): deterministic topological order, cycle paths, bridging on
// removal and descendant bitsets, against naive oracles on random DAGs.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  bridgeOnRemove,
  descendantBits,
  descendantCount,
  descendantsOf,
  type GraphTask,
  isDescendant,
  successorMap,
  topoOrder,
  wouldCycle,
} from "@/lib/domain/invariants/graph";
import { nKeys } from "@/lib/domain/order";
import { type TaskId, TaskId as TaskIdSchema } from "@/lib/domain/schema";
import { activeProject, demoState, generated, taskByTitle } from "../../../../test/fixtures/v2/build";

const id = (i: number) => TaskIdSchema.parse(`tsk_node${String(i).padStart(6, "0")}`);

/**
 * A graph of n tasks: `deps[i]` lists the nodes task i waits on; `rank[i]` is its place in the
 * workflow (default: i). Records are inserted in `insertion` order (default: reversed), so nothing
 * can rely on key order.
 */
function graph(deps: readonly (readonly number[])[], rank?: readonly number[], insertion?: readonly number[]) {
  const n = deps.length;
  const keys = nKeys(n);
  const tasks: GraphTask[] = deps.map((d, i) => ({ id: id(i), order: keys[rank?.[i] ?? i], dependsOn: d.map(id) }));
  const order = insertion ?? [...tasks.keys()].reverse();
  return { tasks: Object.fromEntries(order.map((i) => [tasks[i].id, tasks[i]])) as Record<TaskId, GraphTask> };
}

/** Random DAGs: edges only from earlier to later nodes, a random workflow order */
const dagArb = fc.integer({ min: 1, max: 24 }).chain((n) =>
  fc.record({
    deps: fc.tuple(...Array.from({ length: n }, (_, i) => fc.uniqueArray(fc.nat({ max: Math.max(0, i - 1) }), { maxLength: i === 0 ? 0 : 3 }))),
    rank: fc.shuffledSubarray([...Array(n).keys()], { minLength: n, maxLength: n }),
    insertion: fc.shuffledSubarray([...Array(n).keys()], { minLength: n, maxLength: n }),
  }),
);

/** Naive reachability over `dependsOn`: does `from` wait on `to`, directly or not? */
function waitsOn(tasks: Record<TaskId, GraphTask>, from: TaskId, to: TaskId): boolean {
  const seen = new Set<TaskId>();
  const stack = [...tasks[from].dependsOn];
  while (stack.length) {
    const next = stack.pop()!;
    if (next === to) return true;
    if (seen.has(next) || !tasks[next]) continue;
    seen.add(next);
    stack.push(...tasks[next].dependsOn);
  }
  return false;
}

describe("topoOrder", () => {
  it("orders the demo chain", () => {
    const project = activeProject(demoState());
    const { order, cyclic } = topoOrder(project);
    expect(order.map((t) => project.tasks[t].title)).toEqual(["Research", "Visual Direction", "UI Design", "Development"]);
    expect(cyclic).toEqual([]);
  });

  it("keeps workflow order among tasks that are ready together", () => {
    // 0 waits on 2; workflow order is 0, 1, 2, 3
    const g = graph([[2], [], [], []]);
    expect(topoOrder(g).order).toEqual([id(1), id(2), id(0), id(3)]);
    // Workflow order comes from the order keys, never from record keys or ids
    const shuffled = graph([[], [], [], []], [3, 1, 0, 2], [2, 0, 3, 1]);
    expect(topoOrder(shuffled).order).toEqual([id(2), id(1), id(3), id(0)]);
  });

  it("breaks ties between equal order keys by id", () => {
    const tasks = { [id(1)]: { id: id(1), order: "a0", dependsOn: [] }, [id(0)]: { id: id(0), order: "a0", dependsOn: [] } };
    expect(topoOrder({ tasks }).order).toEqual([id(0), id(1)]);
  });

  it("reports tasks on or behind a loop as cyclic, in workflow order", () => {
    // 1 ↔ 2 loop; 3 waits on the loop; 0 and 4 are free
    const { order, cyclic } = topoOrder(graph([[], [2], [1], [1], [0]]));
    expect(order).toEqual([id(0), id(4)]);
    expect(cyclic).toEqual([id(1), id(2), id(3)]);
    expect(topoOrder(graph([[0]])).cyclic).toEqual([id(0)]);
  });

  it("ignores missing and repeated predecessors", () => {
    const g = graph([[], [0, 0]]);
    g.tasks[id(1)] = { ...g.tasks[id(1)], dependsOn: [id(0), id(0), id(99)] };
    expect(topoOrder(g)).toEqual({ order: [id(0), id(1)], cyclic: [] });
  });

  it("respects every edge and never depends on record key order", () => {
    fc.assert(
      fc.property(dagArb, ({ deps, rank, insertion }) => {
        const g = graph(deps, rank, insertion);
        const { order, cyclic } = topoOrder(g);
        expect(cyclic).toEqual([]);
        expect(order).toHaveLength(deps.length);
        const at = new Map(order.map((t, i) => [t, i]));
        deps.forEach((d, i) => d.forEach((j) => expect(at.get(id(j))!).toBeLessThan(at.get(id(i))!)));
        expect(topoOrder(graph(deps, rank)).order).toEqual(order);
      }),
    );
  });

  it("gives the same order on a 150-task project whatever the key order", () => {
    const project = activeProject(generated(150));
    const reversed = { tasks: Object.fromEntries(Object.entries(project.tasks).reverse()) as typeof project.tasks };
    expect(topoOrder(reversed)).toEqual(topoOrder(project));
  });
});

describe("successorMap", () => {
  it("lists who waits on each task, in workflow order", () => {
    const succ = successorMap(graph([[], [0], [0], [1, 2, 1]]));
    expect(succ.get(id(0))).toEqual([id(1), id(2)]);
    expect(succ.get(id(1))).toEqual([id(3)]);
    expect(succ.get(id(3))).toEqual([]);
  });
});

describe("wouldCycle", () => {
  const demo = activeProject(demoState());
  const t = (title: string) => taskByTitle(demo, title).id;
  const titles = (path: TaskId[] | null) => path?.map((x) => demo.tasks[x].title).join(" → ");

  it("returns the loop a new dependency would close, as the caption reads it", () => {
    // "UI Design waits on Development": Development already waits on UI Design
    expect(titles(wouldCycle(demo, t("UI Design"), t("Development")))).toBe("Development → UI Design → Development");
    expect(titles(wouldCycle(demo, t("Research"), t("Development")))).toBe(
      "Development → UI Design → Visual Direction → Research → Development",
    );
  });

  it("returns null when no loop would form", () => {
    expect(wouldCycle(demo, t("Development"), t("Research"))).toBeNull();
    expect(wouldCycle(demo, t("Development"), t("UI Design"))).toBeNull();
    expect(wouldCycle(demo, t("Development"), id(99))).toBeNull();
  });

  it("treats a self-dependency as the shortest loop", () => {
    expect(wouldCycle(demo, t("Research"), t("Research"))).toEqual([t("Research"), t("Research")]);
  });

  it("finds the shortest loop", () => {
    // 3 waits on 2 and on 1; 2 waits on 1; 1 waits on 0. Adding "0 waits on 3"
    const g = graph([[], [0], [1], [2, 1]]);
    expect(wouldCycle(g, id(0), id(3))).toEqual([id(3), id(1), id(0), id(3)]);
  });

  it("agrees with naive reachability, and every step of the path is an edge", () => {
    fc.assert(
      fc.property(dagArb, fc.nat(), fc.nat(), ({ deps, rank }, a, b) => {
        const g = graph(deps, rank);
        const taskId = id(a % deps.length);
        const dependsOnId = id(b % deps.length);
        const path = wouldCycle(g, taskId, dependsOnId);
        const loops = taskId === dependsOnId || waitsOn(g.tasks, dependsOnId, taskId);
        expect(path !== null).toBe(loops);
        if (!path) return;
        expect(path[0]).toBe(dependsOnId);
        expect(path[path.length - 1]).toBe(dependsOnId);
        expect(path[path.length - 2]).toBe(taskId);
        for (let i = 0; i < path.length - 2; i++) expect(g.tasks[path[i]].dependsOn).toContain(path[i + 1]);
      }),
    );
  });
});

describe("bridgeOnRemove", () => {
  it("bridges a chain", () => {
    // 2 waits on 1, 1 waits on 0: removing 1 makes 2 wait on 0
    const bridges = bridgeOnRemove(graph([[], [0], [1]]), id(1));
    expect([...bridges]).toEqual([[id(2), { dependsOn: [id(0)], added: [id(0)] }]]);
  });

  it("bridges a diamond, keeping the dependent's own predecessors first", () => {
    // 1 and 2 wait on 0; 3 waits on 1 and 2
    const bridges = bridgeOnRemove(graph([[], [0], [0], [1, 2]]), id(1));
    expect([...bridges]).toEqual([[id(3), { dependsOn: [id(2), id(0)], added: [id(0)] }]]);
    // Nothing is added twice
    const twice = bridgeOnRemove(graph([[], [0], [0, 1]]), id(1));
    expect([...twice]).toEqual([[id(2), { dependsOn: [id(0)], added: [] }]]);
  });

  it("removing a root leaves its dependents free", () => {
    const bridges = bridgeOnRemove(graph([[], [0], [0], [1]]), id(0));
    expect([...bridges]).toEqual([
      [id(1), { dependsOn: [], added: [] }],
      [id(2), { dependsOn: [], added: [] }],
    ]);
  });

  it("lists dependents in workflow order, and nothing for a task no one waits on", () => {
    const g = graph([[], [0], [0]], [0, 2, 1]);
    expect([...bridgeOnRemove(g, id(0)).keys()]).toEqual([id(2), id(1)]);
    expect(bridgeOnRemove(g, id(2)).size).toBe(0);
    expect(bridgeOnRemove(g, id(99)).size).toBe(0);
  });

  it("never creates a loop and keeps every remaining path", () => {
    fc.assert(
      fc.property(dagArb, fc.nat(), ({ deps, rank }, pick) => {
        const g = graph(deps, rank);
        const removed = id(pick % deps.length);
        const bridges = bridgeOnRemove(g, removed);
        const after = Object.fromEntries(
          Object.values(g.tasks)
            .filter((x) => x.id !== removed)
            .map((x) => [x.id, { ...x, dependsOn: bridges.get(x.id)?.dependsOn ?? x.dependsOn }]),
        ) as Record<TaskId, GraphTask>;
        expect(topoOrder({ tasks: after }).cyclic).toEqual([]);
        for (const x of Object.values(after)) {
          expect(x.dependsOn).not.toContain(removed);
          expect(new Set(x.dependsOn).size).toBe(x.dependsOn.length);
          for (const y of Object.values(after)) {
            if (x.id !== y.id) expect(waitsOn(after, x.id, y.id)).toBe(waitsOn(g.tasks, x.id, y.id));
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe("descendantBits", () => {
  it("matches naive reachability on random DAGs", () => {
    fc.assert(
      fc.property(dagArb, ({ deps, rank }) => {
        const g = graph(deps, rank);
        const { order } = topoOrder(g);
        const bits = descendantBits(order, successorMap(g));
        for (const a of order) {
          const expected = order.filter((b) => b !== a && waitsOn(g.tasks, b, a));
          expect(descendantsOf(bits, order, a)).toEqual(expected);
          expect(descendantCount(bits, a)).toBe(expected.length);
          for (const b of order) expect(isDescendant(bits, a, b)).toBe(expected.includes(b));
        }
      }),
      { numRuns: 200 },
    );
  });

  it("counts across word boundaries on a 150-task project", () => {
    const project = activeProject(generated(150));
    const { order } = topoOrder(project);
    const bits = descendantBits(order, successorMap(project));
    expect(bits.bits[0]).toHaveLength(5);
    for (const a of order.slice(0, 20)) {
      expect(descendantCount(bits, a)).toBe(order.filter((b) => b !== a && waitsOn(project.tasks, b, a)).length);
    }
  });

  it("answers nothing for tasks off the graph", () => {
    const bits = descendantBits([], new Map());
    expect(descendantCount(bits, id(0))).toBe(0);
    expect(isDescendant(bits, id(0), id(1))).toBe(false);
    expect(descendantsOf(bits, [], id(0))).toEqual([]);
  });
});
