import { PROPOSAL_WHY } from "@/lib/domain/limits";
import { PRIORITY_RANK } from "@/lib/domain/labels";
import { resolveOwner } from "@/lib/domain/invariants/check";
import { compareKeys } from "@/lib/domain/order";
import type { PersonId, TaskId } from "@/lib/domain/schema/ids";
import type { IsoDate } from "@/lib/domain/schema/primitives";
import type { ProjectDoc, Task } from "@/lib/domain/schema/project";
import type { Person, WorkspaceDoc } from "@/lib/domain/schema/workspace";
import type { WorkCalendar } from "@/lib/planning/calendar";
import { fmtDate } from "@/lib/planning/format";
import type { Schedule, ScheduledTiming } from "@/lib/planning/schedule";

/**
 * Leveling (plan §6.6, FORM-v1 §7.2 "Level the schedule"): later starts so that nobody works
 * more than a full day on any day of this project, as pins for a leveling proposal.
 *
 * Serial schedule generation. A task is placed once everything it waits on is placed; among the
 * tasks ready to place, the highest priority goes first, then workflow order. Each start is the
 * first working day at or after its earliest start (the predecessors' new finish, its pin, the
 * project start) where the owner's daily usage plus the task's daily share (`estimate / duration`,
 * as in load) stays at most 1 on every day of the task.
 *
 * - Review and Done tasks are fixed: they are never delayed for a clash. Review work holds its
 *   owner's days from the start; finished work holds none.
 * - Unowned tasks, milestones and tasks of archived or missing owners hold no days and are never
 *   delayed for a clash; they follow their predecessors.
 * - Unknown tasks (no estimate, or waiting on one) are left alone, as are projects without a
 *   date: a pin needs a date.
 *
 * A move is returned only where a clash delays a task past where its predecessors would put it:
 * pinning those starts reproduces the leveled schedule, since everything else follows its
 * predecessors. `days` counts from the task's current start. Moves come in workflow order.
 * Usage is a Float64Array per person over the horizon (shares are fractions such as 2.5 / 3).
 * O(V log V + Σ d) plus the days skipped while searching. The UI arrives in Phase 5.
 */

export interface LevelMove {
  readonly taskId: TaskId;
  /** The new start */
  readonly pinnedStart: IsoDate;
  /** Working days later than the current start */
  readonly days: number;
  readonly why: string;
}

/** What leveling reads of a plan: a `ProjectPlan` fits */
export interface LevelPlan {
  readonly project: ProjectDoc;
  readonly calendar: WorkCalendar;
  readonly schedule: Schedule;
}

/** Daily usage may reach 1 up to float noise */
const EPS = 1e-9;

/** A binary min-heap of task positions under a comparison */
class Heap {
  private readonly items: number[] = [];

  constructor(private readonly less: (a: number, b: number) => boolean) {}

  get size(): number {
    return this.items.length;
  }

  push(x: number): void {
    const items = this.items;
    let i = items.push(x) - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(x, items[parent])) break;
      items[i] = items[parent];
      i = parent;
    }
    items[i] = x;
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
        const child = right < items.length && this.less(items[right], items[left]) ? right : left;
        if (!this.less(items[child], last)) break;
        items[i] = items[child];
        i = child;
      }
      items[i] = last;
    }
    return top;
  }
}

/** One person's days: usage (0–1) and the task holding each day last, both growable */
class Days {
  usage: Float64Array;
  holder: Int32Array;

  constructor(size: number) {
    this.usage = new Float64Array(size);
    this.holder = new Int32Array(size).fill(-1);
  }

  ensure(size: number): void {
    if (size <= this.usage.length) return;
    const length = Math.max(size, this.usage.length * 2);
    const usage = new Float64Array(length);
    usage.set(this.usage);
    const holder = new Int32Array(length).fill(-1);
    holder.set(this.holder);
    this.usage = usage;
    this.holder = holder;
  }

  hold(from: number, to: number, share: number, task: number): void {
    this.ensure(to);
    for (let j = from; j < to; j++) {
      this.usage[j] += share;
      this.holder[j] = task;
    }
  }
}

/** Cuts a sentence to the proposal's limit */
function clip(text: string): string {
  return text.length <= PROPOSAL_WHY ? text : `${text.slice(0, PROPOSAL_WHY - 1).trimEnd()}…`;
}

export function level(ws: Pick<WorkspaceDoc, "people">, plan: LevelPlan): LevelMove[] {
  const { project, schedule, calendar } = plan;
  if (schedule.anchor.mode === "relative") return [];
  const A = schedule.anchor.ordinal;

  // The scheduled tasks, by position in topological order
  const list: { task: Task; timing: ScheduledTiming }[] = [];
  for (const id of schedule.topo) {
    const timing = schedule.timings.get(id);
    if (timing !== undefined && timing.kind === "scheduled" && Object.hasOwn(project.tasks, id)) list.push({ task: project.tasks[id], timing });
  }
  const n = list.length;
  const pos = new Map<TaskId, number>();
  list.forEach(({ task }, i) => pos.set(task.id, i));

  const owners: (Person | null)[] = list.map(({ task }) => {
    const owner = resolveOwner(task.ownerId, ws);
    return owner === null || typeof owner === "string" ? null : owner;
  });
  const shares = list.map(({ task, timing }) => (timing.duration > 0 && task.estimateDays !== null ? task.estimateDays / timing.duration : 0));
  const fixed = list.map(({ task }) => task.status === "review" || task.status === "done");

  // Per person days over [A, A + horizon), grown on demand
  let horizon = 1;
  for (const { timing } of list) horizon = Math.max(horizon, timing.finish - A);
  for (let i = 0; i < n; i++) if (!fixed[i]) horizon += list[i].timing.duration;
  const days = new Map<PersonId, Days>();
  const daysOf = (person: Person) => {
    let d = days.get(person.id);
    if (d === undefined) days.set(person.id, (d = new Days(horizon)));
    return d;
  };

  // Review work holds its owner's days where it is now
  for (let i = 0; i < n; i++) {
    const owner = owners[i];
    if (owner !== null && list[i].task.status === "review" && shares[i] > 0) daysOf(owner).hold(list[i].timing.es - A, list[i].timing.finish - A, shares[i], i);
  }

  // Predecessors and successors among the scheduled tasks
  const preds: number[][] = list.map(({ task }) => [...new Set(task.dependsOn)].map((id) => pos.get(id)).filter((j): j is number => j !== undefined));
  const succs: number[][] = Array.from({ length: n }, () => []);
  const waiting = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    waiting[i] = preds[i].length;
    for (const j of preds[i]) succs[j].push(i);
  }

  const ready = new Heap((a, b) => {
    const ta = list[a].task;
    const tb = list[b].task;
    const byPriority = PRIORITY_RANK[ta.priority] - PRIORITY_RANK[tb.priority];
    if (byPriority !== 0) return byPriority < 0;
    return (compareKeys(ta.order, tb.order) || compareKeys(ta.id, tb.id)) < 0;
  });
  for (let i = 0; i < n; i++) if (waiting[i] === 0) ready.push(i);

  // New finishes; a Review task not placed yet still holds its days where it is now
  const finish = Float64Array.from(list, ({ timing }) => timing.finish);
  const moves: { order: string; id: TaskId; move: LevelMove }[] = [];

  while (ready.size > 0) {
    const i = ready.pop();
    const { task, timing } = list[i];
    const d = timing.duration;
    let earliest = Math.max(A, task.pinnedStart === null ? A : calendar.ordinal(task.pinnedStart));
    for (const j of preds[i]) earliest = Math.max(earliest, finish[j]);

    let start = earliest;
    let clash = -1;
    const owner = owners[i];
    const share = shares[i];
    if (!fixed[i] && owner !== null && share > 0) {
      const own = daysOf(owner);
      own.ensure(start - A + d);
      for (let j = start; j < start + d; j++) {
        if (own.usage[j - A] + share > 1 + EPS) {
          clash = own.holder[j - A];
          start = j + 1;
          own.ensure(start - A + d);
        }
      }
      own.hold(start - A, start - A + d, share, i);
    }
    finish[i] = start + d;

    if (start > earliest) {
      const by = clash >= 0 ? list[clash].task : null;
      const startDate = calendar.dateAt(start);
      const why =
        by === null
          ? `${owner!.name} is busy until then, so this starts ${fmtDate(startDate)}.`
          : `${owner!.name} is on ${by.title} until ${fmtDate(calendar.dateAt(finish[clash] - 1))}, so this starts ${fmtDate(startDate)}.`;
      moves.push({ order: task.order, id: task.id, move: Object.freeze({ taskId: task.id, pinnedStart: startDate, days: start - timing.es, why: clip(why) }) });
    }
    for (const s of succs[i]) if (--waiting[s] === 0) ready.push(s);
  }

  moves.sort((a, b) => compareKeys(a.order, b.order) || compareKeys(a.id, b.id));
  return moves.map((m) => m.move);
}
