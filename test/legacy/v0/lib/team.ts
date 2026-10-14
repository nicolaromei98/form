import type { Doc, Person, ReassignMove, ReassignPlan, Task } from "./schema";

/**
 * Workload. A person's load is the open work they own: top-level tasks that
 * aren't done, counted by estimate (steps live inside their task's estimate).
 * Tasks without an estimate can't be weighed, so they're counted apart.
 */

export interface Load {
  /** null = the unassigned row */
  person: Person | null;
  tasks: Task[];
  days: number;
  unsized: number;
  over: number;
  free: number;
}

export function openWork(doc: Doc): Task[] {
  return doc.order.map((id) => doc.tasks[id]).filter((t): t is Task => Boolean(t) && !t.parentId && t.status !== "done");
}

/** Who owns each open task, optionally with a plan's moves applied (for previews). */
export function ownersOf(doc: Doc, plan?: ReassignPlan | null): Record<string, string | null> {
  const owners: Record<string, string | null> = {};
  for (const t of openWork(doc)) owners[t.id] = t.owner && doc.people.some((p) => p.id === t.owner) ? t.owner : null;
  for (const m of plan?.moves ?? []) if (m.taskId in owners) owners[m.taskId] = m.to;
  return owners;
}

export function loadsOf(doc: Doc, owners = ownersOf(doc)): Load[] {
  const work = openWork(doc);
  const row = (person: Person | null): Load => {
    const tasks = work.filter((t) => owners[t.id] === (person?.id ?? null));
    const days = tasks.reduce((s, t) => s + (t.estimate ?? 0), 0);
    const cap = person?.capacity ?? 0;
    return {
      person,
      tasks,
      days,
      unsized: tasks.filter((t) => t.estimate == null).length,
      over: person ? Math.max(0, days - cap) : 0,
      free: person ? Math.max(0, cap - days) : 0,
    };
  };
  return [...doc.people.map(row), row(null)];
}

/**
 * Proposes reassignments, greedily: unassigned work goes to whoever has room,
 * then work flows from whoever is most over capacity to whoever has the most
 * room — starting with the task that's least under way, the cheapest handover.
 * A move is only proposed if it fits without overloading the receiver.
 */
export function balancePlan(doc: Doc): ReassignMove[] {
  const owners = ownersOf(doc);
  const work = openWork(doc);
  const loadOf = (id: string) => work.filter((t) => owners[t.id] === id).reduce((s, t) => s + (t.estimate ?? 0), 0);
  const roomiest = (except: string | null, need: number) =>
    doc.people
      .filter((p) => p.id !== except)
      .map((p) => ({ p, free: p.capacity - loadOf(p.id) }))
      .filter((c) => c.free >= need)
      .sort((a, b) => b.free - a.free)[0]?.p ?? null;

  for (const t of work.filter((t) => owners[t.id] === null && t.estimate != null)) {
    const to = roomiest(null, t.estimate!);
    if (to) owners[t.id] = to.id;
  }

  for (let guard = 0; guard < 8; guard++) {
    const worst = doc.people.map((p) => ({ p, over: loadOf(p.id) - p.capacity })).sort((a, b) => b.over - a.over)[0];
    if (!worst || worst.over <= 0) break;
    const candidates = work.filter((t) => owners[t.id] === worst.p.id && t.estimate != null).sort((a, b) => a.progress - b.progress);
    let moved = false;
    for (const t of candidates) {
      const to = roomiest(worst.p.id, t.estimate!);
      if (!to) continue;
      owners[t.id] = to.id;
      moved = true;
      break;
    }
    if (!moved) break;
  }

  const before = ownersOf(doc);
  return work.filter((t) => owners[t.id] !== before[t.id]).map((t) => ({ taskId: t.id, to: owners[t.id] }));
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export function fmtLoad(days: number) {
  return Number.isInteger(days) ? `${days}` : days.toFixed(1);
}
