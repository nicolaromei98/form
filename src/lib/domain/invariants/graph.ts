import { sortedByOrder } from "@/lib/domain/order";
import type { TaskId } from "@/lib/domain/schema/ids";

/**
 * The dependency graph (plan §6.2). `dependsOn` is finish-to-start: a task waits on the tasks it
 * names. Every function is total: an edge to a missing task is ignored here (the invariants
 * report it), and iteration never depends on record key order (`jsonb` reorders keys), so the
 * results are deterministic.
 */

/** What the graph reads of a task */
export interface GraphTask {
  readonly id: TaskId;
  readonly order: string;
  readonly dependsOn: readonly TaskId[];
}

/** What the graph reads of a project: a document, a draft, or anything with tasks keyed by id */
export interface GraphProject {
  readonly tasks: Readonly<Record<TaskId, GraphTask>>;
}

const has = (tasks: Readonly<Record<TaskId, GraphTask>>, id: TaskId) => Object.hasOwn(tasks, id);

/* ------------------------------------------------------------------
   Topological order
   ------------------------------------------------------------------ */

/** A binary min-heap of small integers (ranks in workflow order) */
class RankHeap {
  private readonly items: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(rank: number): void {
    const items = this.items;
    let i = items.push(rank) - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent] <= rank) break;
      items[i] = items[parent];
      i = parent;
    }
    items[i] = rank;
  }

  pop(): number {
    const items = this.items;
    const top = items[0];
    const last = items.pop()!;
    if (items.length > 0) {
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        if (left >= items.length) break;
        const right = left + 1;
        const child = right < items.length && items[right] < items[left] ? right : left;
        if (items[child] >= last) break;
        items[i] = items[child];
        i = child;
      }
      items[i] = last;
    }
    return top;
  }
}

export interface TopoResult {
  /** Every task whose predecessors all come before it; ties in workflow order (order key, then id) */
  readonly order: TaskId[];
  /** Tasks on or behind a dependency loop, in workflow order: empty in a valid document */
  readonly cyclic: TaskId[];
}

/**
 * Kahn's algorithm with a min-heap keyed by workflow order, so independent tasks keep their
 * workflow order and the result never depends on record key order. O((V+E) log V).
 */
export function topoOrder(project: GraphProject): TopoResult {
  const tasks = sortedByOrder(project.tasks);
  const n = tasks.length;
  const rank = new Map<TaskId, number>();
  tasks.forEach((t, i) => rank.set(t.id, i));

  const indegree = new Int32Array(n);
  const successors: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    const seen = new Set<number>();
    for (const id of tasks[i].dependsOn) {
      const j = rank.get(id);
      if (j === undefined || seen.has(j)) continue;
      seen.add(j);
      successors[j].push(i);
      indegree[i]++;
    }
  }

  const heap = new RankHeap();
  for (let i = 0; i < n; i++) if (indegree[i] === 0) heap.push(i);
  const order: TaskId[] = [];
  while (heap.size > 0) {
    const i = heap.pop();
    order.push(tasks[i].id);
    for (const s of successors[i]) if (--indegree[s] === 0) heap.push(s);
  }
  const cyclic = tasks.filter((_, i) => indegree[i] > 0).map((t) => t.id);
  return { order, cyclic };
}

/**
 * Each task's successors (the tasks that wait on it), in workflow order, deduplicated; every task
 * has an entry. Edges to missing tasks are ignored. O(V log V + E).
 */
export function successorMap(project: GraphProject): Map<TaskId, TaskId[]> {
  const tasks = sortedByOrder(project.tasks);
  const succ = new Map<TaskId, TaskId[]>(tasks.map((t) => [t.id, []]));
  for (const t of tasks) {
    for (const id of new Set(t.dependsOn)) {
      if (id !== t.id) succ.get(id)?.push(t.id);
    }
  }
  return succ;
}

/* ------------------------------------------------------------------
   Cycles
   ------------------------------------------------------------------ */

/**
 * The loop that "taskId waits on dependsOnId" would close, or null. The path starts and ends at
 * `dependsOnId` and reads as "waits on": [Development, UI Design, Development] means Development
 * waits on UI Design, which would wait on Development ("That would create a loop: Development →
 * UI Design → Development."). A breadth-first search over `dependsOn`, so the loop is the shortest
 * one; neighbours are visited in `dependsOn` order. O(V+E).
 */
export function wouldCycle(project: GraphProject, taskId: TaskId, dependsOnId: TaskId): TaskId[] | null {
  if (taskId === dependsOnId) return [taskId, taskId];
  const tasks = project.tasks;
  if (!has(tasks, taskId) || !has(tasks, dependsOnId)) return null;
  const cameFrom = new Map<TaskId, TaskId | null>([[dependsOnId, null]]);
  const queue: TaskId[] = [dependsOnId];
  for (let q = 0; q < queue.length; q++) {
    const id = queue[q];
    for (const next of tasks[id].dependsOn) {
      if (cameFrom.has(next) || !has(tasks, next)) continue;
      cameFrom.set(next, id);
      if (next === taskId) {
        const path: TaskId[] = [];
        for (let at: TaskId | null = taskId; at !== null; at = cameFrom.get(at) ?? null) path.push(at);
        path.reverse();
        path.push(dependsOnId);
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

/* ------------------------------------------------------------------
   Bridging on removal
   ------------------------------------------------------------------ */

export interface Bridge {
  /** The dependent's new `dependsOn`: its own predecessors without the removed task, then the inherited ones */
  readonly dependsOn: TaskId[];
  /** The predecessors it inherited ("Development now follows Visual Direction") */
  readonly added: TaskId[];
}

/**
 * When a task X is removed, every task D that waited on it inherits X's predecessors, so the chain
 * never breaks: `D.dependsOn = unique(D.dependsOn − X ∪ X.dependsOn − D)`. This can never create
 * a loop (anything X waited on was already upstream of D). The map holds only the dependents, in
 * workflow order.
 *
 * The union can hold more than DEPS_MAX ids when both lists are long: the caller decides (the
 * removeTask op rejects with `limit`).
 */
export function bridgeOnRemove(project: GraphProject, removedId: TaskId): Map<TaskId, Bridge> {
  const tasks = project.tasks;
  const bridges = new Map<TaskId, Bridge>();
  if (!has(tasks, removedId)) return bridges;
  const inherited = [...new Set(tasks[removedId].dependsOn)].filter((id) => id !== removedId && has(tasks, id));
  for (const d of sortedByOrder(tasks)) {
    if (d.id === removedId || !d.dependsOn.includes(removedId)) continue;
    const kept = [...new Set(d.dependsOn)].filter((id) => id !== removedId);
    const added = inherited.filter((id) => id !== d.id && !kept.includes(id));
    bridges.set(d.id, { dependsOn: [...kept, ...added], added });
  }
  return bridges;
}

/* ------------------------------------------------------------------
   Descendant bitsets
   ------------------------------------------------------------------ */

export interface DescendantBits {
  /** Position of each task in the topological order: its bit */
  readonly index: ReadonlyMap<TaskId, number>;
  /** `bits[i]` has bit j set when `topo[j]` waits on `topo[i]`, directly or not (never itself) */
  readonly bits: readonly Uint32Array[];
}

/**
 * Every task's transitive successors as a bitset of ⌈V/32⌉ words, ORed in reverse topological
 * order. O((V+E)·V/32): about 50 µs at V = 150. Planning uses it to null the float of a task with
 * an unknown task downstream, and Focus to count the tasks waiting on one.
 */
export function descendantBits(topo: readonly TaskId[], succ: ReadonlyMap<TaskId, readonly TaskId[]>): DescendantBits {
  const n = topo.length;
  const words = Math.ceil(n / 32);
  const index = new Map<TaskId, number>();
  topo.forEach((id, i) => index.set(id, i));
  const bits = Array.from({ length: n }, () => new Uint32Array(words));
  for (let i = n - 1; i >= 0; i--) {
    const own = bits[i];
    for (const s of succ.get(topo[i]) ?? []) {
      const j = index.get(s);
      // Successors come later in a topological order; anything else is off the graph (a loop)
      if (j === undefined || j <= i) continue;
      own[j >>> 5] |= 1 << (j & 31);
      const theirs = bits[j];
      for (let w = 0; w < words; w++) own[w] |= theirs[w];
    }
  }
  return { index, bits };
}

/** Whether `descendant` waits on `ancestor`, directly or not */
export function isDescendant(d: DescendantBits, ancestor: TaskId, descendant: TaskId): boolean {
  const i = d.index.get(ancestor);
  const j = d.index.get(descendant);
  if (i === undefined || j === undefined) return false;
  return (d.bits[i][j >>> 5] & (1 << (j & 31))) !== 0;
}

/** How many tasks wait on the task, directly or not */
export function descendantCount(d: DescendantBits, id: TaskId): number {
  const i = d.index.get(id);
  if (i === undefined) return 0;
  let count = 0;
  for (const word of d.bits[i]) {
    // Population count of a 32-bit word
    let v = word - ((word >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    count += Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
  }
  return count;
}

/** The descendants of a task, in topological order */
export function descendantsOf(d: DescendantBits, topo: readonly TaskId[], id: TaskId): TaskId[] {
  const i = d.index.get(id);
  if (i === undefined) return [];
  const own = d.bits[i];
  return topo.filter((_, j) => (own[j >>> 5] & (1 << (j & 31))) !== 0);
}
