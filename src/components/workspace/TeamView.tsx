"use client";

import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState, type PointerEvent as RPointerEvent } from "react";
import { createPortal } from "react-dom";
import { PEOPLE_MAX } from "@/lib/domain/limits";
import type { PersonId, TaskId } from "@/lib/domain/schema/ids";
import type { ProjectDoc, Task } from "@/lib/domain/schema/project";
import type { ReassignMove, ReassignProposal } from "@/lib/domain/schema/proposal";
import type { Person } from "@/lib/domain/schema/workspace";
import { ease, move } from "@/lib/motion";
import {
  type LaneLoad,
  useActions,
  useCanAddPerson,
  useHasSamplePerson,
  useLaneLoads,
  usePerson,
  usePhase,
  useProject,
  useProposal,
} from "@/lib/store/hooks";
import { useWidth } from "@/lib/useWidth";
import { EditableText } from "./parts";
import { useTaskSurface } from "./TaskCard";
import { ShuffleText } from "../text/ShuffleText";

/** Like the timeline, the team view draws itself: labels condense in, then each row's track wipes open */
const BUILD = { label: 0.16, track: 0.24, step: 0.07 };
const TRACK_H = 52;
const SEG_H = 42;
/** Tasks sit concentric in their lane: the same inset on every side */
const PAD = (TRACK_H - SEG_H) / 2;
const GAP = 4;
const NONE = "__unassigned";
const HATCH = "repeating-linear-gradient(-45deg, rgba(214,69,69,0.2) 0 5px, rgba(214,69,69,0.06) 5px 10px)";
/**
 * Segment surfaces. A dimmed segment (50%) and one leaving in a balance preview (40%) recede by
 * their surface and shadow only; the text keeps full contrast (Q14).
 */
const SEG = "rgba(255,255,255,0.9)";
const SEG_DIM = "rgba(255,255,255,0.45)";
const SEG_LEAVING = "rgba(255,255,255,0.36)";
const SEG_INK = "#0a0a0a";

const wipe = (open: boolean) => `inset(0px ${open ? "0%" : "100%"} 0px 0px round ${TRACK_H / 2}px)`;

type Tasks = ProjectDoc["tasks"];
const NO_TASKS: Tasks = Object.freeze({}) as Tasks;
const NO_IDS: readonly TaskId[] = Object.freeze([]);

/** Days as the captions print them (4, 4.5), so the screen and the agent never show two figures */
function fmtLoad(days: number) {
  return Number.isInteger(days) ? `${days}` : `${Math.round(days * 10) / 10}`;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

/** The open tasks a lane lists, in its (workflow) order */
const tasksOf = (ids: readonly TaskId[], tasks: Tasks): Task[] => ids.flatMap((id) => (Object.hasOwn(tasks, id) ? [tasks[id]] : []));

/** Where a lane's segments end, in days: each sized by estimate, a task with no estimate (or under a day) takes one */
const tailOf = (ids: readonly TaskId[], tasks: Tasks) => tasksOf(ids, tasks).reduce((s, t) => s + Math.max(1, t.estimateDays ?? 1), 0);

/**
 * A person's lane before they carry any work here: one standard week, as `laneLoads` gives a
 * member with no work. Only a reassign preview needs it, for a receiver who isn't a member yet
 * (accepting makes them one).
 */
function restingLane(personId: PersonId | null, capacity: number | null): LaneLoad {
  return { personId, taskIds: NO_IDS, days: 0, unsized: 0, capacity, over: capacity === null ? null : 0, free: capacity, otherProjectsDays: 0, weeks: [] };
}

/** One row: a lane now (null for a preview-only receiver) and the same lane with the proposal applied */
interface RowSpec {
  id: string;
  lane: LaneLoad | null;
  next: LaneLoad | null;
}

interface Drag {
  id: TaskId;
  title: string;
  from: string;
  w: number;
  dx: number;
  dy: number;
  x: number;
  y: number;
  over: string | null;
}

/**
 * Representation: team. Each person is a row whose track is their capacity in
 * days; their open tasks are laid along it, sized by estimate. Whatever spills
 * past the capacity line is hatched red. Drag a task onto someone else's row to
 * hand it over, or ask FORM to balance the workload.
 *
 * Rows are the Phase 1 Team lanes (plan §6.5): the project's members, then the
 * unassigned work. A lane covers the person's work window, week by week, so its
 * capacity, over and free are the ones captions and the brief read.
 */
export function TeamView() {
  const empty = useLaneLoads().every((l) => l.personId === null);
  // Separate components, so the board measures its width when it mounts
  return empty ? <NoTeam /> : <TeamBoard />;
}

function TeamBoard() {
  const actions = useActions();
  const project = useProject();
  const lanes = useLaneLoads();
  const previewLanes = useLaneLoads({ preview: true });
  const proposal = useProposal();
  const phase = usePhase();
  // The sample team is labelled as sample data
  const sample = useHasSamplePerson();
  const canAddPerson = useCanAddPerson();
  const [ref, width] = useWidth<HTMLDivElement>(0);
  const [drag, setDrag] = useState<Drag | null>(null);

  const tasks = project?.tasks ?? NO_TASKS;
  const plan = proposal?.kind === "reassign" ? proposal : null;
  const preview = plan ? previewLanes : null;
  // Handovers only: a proposed shift moves a task's dates, not its row
  const moving = useMemo(() => new Set(plan?.moves.flatMap((m) => (m.type === "owner" ? [m.taskId] : [])) ?? []), [plan]);

  const narrow = width < 640;
  const labelW = narrow ? 0 : 260;
  const trackW = Math.max(120, width - labelW - (narrow ? 0 : 16));
  const span = (l: LaneLoad) => Math.max(l.capacity ?? 0, l.days, tailOf(l.taskIds, tasks));
  const maxDays = Math.max(4, ...lanes.map(span), ...(preview ?? []).map(span)) + 0.5;
  const dayW = (trackW - 2 * PAD + GAP) / maxDays;
  const unassigned = lanes.find((l) => l.personId === null) ?? null;
  const nextOf = (personId: PersonId | null) => preview?.find((l) => l.personId === personId) ?? null;
  const showUnassigned = (unassigned?.taskIds.length ?? 0) > 0 || Boolean(nextOf(null)?.taskIds.length) || drag != null;
  const people = lanes.filter((l) => l.personId !== null);
  const rows: RowSpec[] = people.map((l) => ({ id: l.personId!, lane: l, next: nextOf(l.personId) }));
  for (const l of preview ?? []) {
    if (l.personId !== null && !people.some((p) => p.personId === l.personId)) rows.push({ id: l.personId, lane: null, next: l });
  }
  if (showUnassigned) rows.push({ id: NONE, lane: unassigned, next: nextOf(null) });
  const overloaded = lanes.some((l) => (l.over ?? 0) > 0) || tasksOf(unassigned?.taskIds ?? NO_IDS, tasks).some((t) => t.estimateDays != null);

  const startDrag = (e: RPointerEvent<HTMLElement>, task: Task, from: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const rect = e.currentTarget.getBoundingClientRect();
    let started = false;
    const rowAt = (x: number, y: number) =>
      (document.elementsFromPoint(x, y).find((el) => el instanceof HTMLElement && el.dataset.teamRow) as HTMLElement | undefined)?.dataset.teamRow ?? null;
    const onMove = (ev: PointerEvent) => {
      if (!started && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      started = true;
      setDrag({
        id: task.id,
        title: task.title,
        from,
        w: rect.width,
        dx: sx - rect.left,
        dy: sy - rect.top,
        x: ev.clientX,
        y: ev.clientY,
        over: rowAt(ev.clientX, ev.clientY),
      });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (!started) {
        // A click, not a drag: Point & Ask selection, as everywhere else
        actions.select(actions.peek().selectedTaskId === task.id ? null : task.id);
        return;
      }
      const to = rowAt(ev.clientX, ev.clientY);
      setDrag(null);
      if (to && to !== from) {
        if (to === NONE) actions.commit([{ op: "unassignTask", taskId: task.id }], { label: `unassign ${task.title}` });
        else actions.commit([{ op: "assignTask", taskId: task.id, personId: to as PersonId }], { label: `assign ${task.title}` });
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  return (
    <div className="relative">
      {/* The panel resizes with its rows on the same curve, instead of snapping to the new height */}
      <motion.div
        aria-hidden
        layout
        className="glass absolute inset-0"
        style={{ borderRadius: 36 }}
        initial={{ opacity: 0, scale: 0.985 }}
        animate={{ opacity: 1, scale: 1, transition: move }}
        transition={{ layout: move }}
      />
      <div className="relative p-3 md:p-5">
        <motion.div
          className="flex flex-wrap items-center justify-between gap-3 px-1 pb-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.12, duration: 0.5, ease: ease.out }}
        >
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="t-micro text-text-2">Workload</span>
            <span className="t-data flex items-center gap-2 text-text-3">
              <span className="h-[10px] w-[22px] rounded-full bg-black/[0.07]" />
              Capacity
            </span>
            <span className="t-data flex items-center gap-2 text-text-3">
              <span className="h-[10px] w-[22px] rounded-full" style={{ background: HATCH }} />
              Over capacity
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={!canAddPerson}
              title={canAddPerson ? undefined : `A workspace holds up to ${PEOPLE_MAX} people`}
              // A visible, editable 5 days a week (Q3)
              onClick={() => actions.addPerson()}
              className="focus-ring t-body-s h-[34px] cursor-pointer rounded-full px-3.5 text-text-2 transition-colors hover:bg-black/[0.05] hover:text-text disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <ShuffleText text="Add person" />
            </button>
            {overloaded && !plan && (
              <button
                type="button"
                disabled={phase === "processing"}
                onClick={() => actions.submit("Balance the workload")}
                className="focus-ring t-body-s h-[34px] cursor-pointer rounded-full bg-ink px-4 text-on-ink transition-transform hover:scale-[1.02] disabled:opacity-50"
              >
                <ShuffleText text="Balance with FORM" />
              </button>
            )}
          </div>
        </motion.div>

        {/* Resolving runs in two beats, so nothing moves under anything else: first the card dissolves
            in place while the handed-over task travels between rows that stand still; then its empty
            space closes on the move curve, and rows, panel and page follow it up without a jump */}
        <AnimatePresence>
          {plan && (
            <motion.div
              key="plan"
              className="tone-dark overflow-hidden rounded-[26px] bg-ink text-on-ink"
              initial={{ opacity: 0, height: 0, marginBottom: 0, filter: "blur(8px)" }}
              animate={{ opacity: 1, height: "auto", marginBottom: 16, filter: "blur(0px)" }}
              exit={{
                opacity: 0,
                filter: "blur(10px)",
                height: 0,
                marginBottom: 0,
                transition: {
                  opacity: { duration: 0.3, ease: ease.out },
                  filter: { duration: 0.3, ease: ease.out },
                  height: { ...move, delay: 0.65 },
                  marginBottom: { ...move, delay: 0.65 },
                },
              }}
              transition={move}
            >
              <PlanCard
                plan={plan}
                tasks={tasks}
                lanes={lanes}
                onAccept={() => actions.resolveProposal(true)}
                onDiscard={() => actions.resolveProposal(false)}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={ref}>
          {width > 0 &&
            rows.map(({ id, lane, next }, i) => (
              <Row
                key={id}
                id={id}
                lane={lane}
                next={next}
                tasks={tasks}
                index={i}
                narrow={narrow}
                labelW={labelW}
                dayW={dayW}
                moving={moving}
                drag={drag}
                onDragStart={startDrag}
              />
            ))}
        </div>

        <motion.div
          layout="position"
          transition={{ layout: move }}
          className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line px-1 pt-4"
        >
          <span className="t-data text-text-3">Load is open work by estimate · steps count inside their task · drag a task onto someone to hand it over</span>
          {sample && <span className="t-data text-text-3">Sample team · rename anyone</span>}
        </motion.div>
      </div>

      {drag &&
        createPortal(
          <div
            className="t-body-s pointer-events-none fixed z-[90] flex items-center rounded-full bg-white px-4 text-text shadow-[0_24px_50px_-18px_rgba(0,0,0,0.45)]"
            style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.w, height: SEG_H, rotate: "1.5deg", scale: 1.03 }}
          >
            <span className="truncate">{drag.title}</span>
          </div>,
          document.body,
        )}
    </div>
  );
}

/* ------------------------------------------------------------------
   Row — one person (or the unassigned work) and their track
   ------------------------------------------------------------------ */

function Row({
  id,
  lane,
  next,
  tasks,
  index,
  narrow,
  labelW,
  dayW,
  moving,
  drag,
  onDragStart,
}: {
  id: string;
  /** The lane now; null for a receiver the preview adds, who carries nothing here yet */
  lane: LaneLoad | null;
  /** The same row with the proposed plan applied */
  next: LaneLoad | null;
  tasks: Tasks;
  index: number;
  narrow: boolean;
  labelW: number;
  dayW: number;
  moving: ReadonlySet<TaskId>;
  drag: Drag | null;
  onDragStart: (e: RPointerEvent<HTMLElement>, task: Task, from: string) => void;
}) {
  const actions = useActions();
  const p = usePerson(id === NONE ? null : (id as PersonId));
  const load = lane ?? restingLane(p?.id ?? null, p?.capacityDaysPerWeek ?? null);
  const target = drag != null && drag.over === id && drag.from !== id;
  const mine = tasksOf(load.taskIds, tasks);
  const incoming = next ? tasksOf(next.taskIds, tasks).filter((t) => !load.taskIds.includes(t.id)) : [];
  const over = load.over ?? 0;

  // Tasks sit end to end along the track, sized by estimate (a task with no estimate takes one day)
  const lay = (list: Task[], start: number) =>
    list.reduce<{ at: number; w: number }[]>((acc, t) => {
      const prev = acc[acc.length - 1];
      acc.push({ at: prev ? prev.at + prev.w : start, w: Math.max(1, t.estimateDays ?? 1) * dayW });
      return acc;
    }, []);
  const own = lay(mine, 0);
  const tail = own.length ? own[own.length - 1].at + own[own.length - 1].w : 0;
  const landing = lay(incoming, tail);
  /** The point `days` along the track */
  const along = (days: number) => 2 * PAD + days * dayW - GAP;
  const workEnd = tail ? 2 * PAD + tail - GAP : 0;
  // The lane holds `capacity` days; with no capacity (Q3) it is as long as the work, with no capacity line
  const laneEnd = !p ? 0 : load.capacity === null ? workEnd : along(load.capacity);
  // The overload spans [days − over, days] of this project's work. It is summed week by week, so it
  // can start before the capacity line when one week has slack and another too much (plan §12
  // item 3); that part stays under the lane, as v0 paints it, and the figure and ring still say it
  // (Phase 4 replaces the lane with the weekly grid)
  const hatchFrom = over > 0 ? along(Math.max(0, load.days - over)) : laneEnd;
  const hatchTo = over > 0 ? along(load.days) : laneEnd;

  return (
    <motion.div
      layout="position"
      transition={{ layout: move }}
      data-team-row={id}
      className={`relative grid items-center gap-x-4 gap-y-3 border-b border-line py-4 last:border-b-0 ${narrow ? "grid-cols-1" : ""}`}
      style={narrow ? undefined : { gridTemplateColumns: `${labelW}px minmax(0, 1fr)` }}
    >
      <AnimatePresence>
        {target && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute -inset-x-2 inset-y-1.5 rounded-[24px] bg-black/[0.035] ring-[1.5px] ring-ink/25"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          />
        )}
      </AnimatePresence>

      <motion.div
        className="tone-light relative flex min-w-0 items-center gap-3"
        initial={{ opacity: 0, filter: "blur(8px)" }}
        animate={{ opacity: 1, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
        transition={{ delay: BUILD.label + index * BUILD.step, duration: 0.6, ease: ease.out }}
      >
        <Avatar person={p} over={over > 0} />
        <div className="flex min-w-0 flex-1 flex-col">
          {p ? (
            <EditableText
              value={p.name}
              label="Name"
              maxLength={40}
              onCommit={(v) => actions.commit([{ op: "updatePerson", personId: p.id, field: "name", value: v }], { label: "rename person" })}
              className="t-body min-w-0 truncate"
            />
          ) : (
            <span className="t-body text-text-2">Unassigned</span>
          )}
          <span className="t-data truncate text-text-3">{p ? (p.role ?? "Team member") : "Open work without an owner"}</span>
        </div>
        {p && <LoadFigure load={load} next={next} />}
      </motion.div>

      <motion.div
        className="relative"
        style={{ height: TRACK_H }}
        initial={{ clipPath: wipe(false) }}
        animate={{ clipPath: wipe(true), transitionEnd: { clipPath: "none" } }}
        transition={{ ...move, delay: BUILD.track + index * BUILD.step }}
      >
        {p ? (
          <>
            {/* A full lane holds exactly `capacity` days of work. Overflow continues as a hatch that
                starts under the lane's round end, so it grows out of it and retreats into it */}
            <motion.div
              className="absolute inset-y-0 rounded-r-full"
              style={{ background: HATCH }}
              initial={false}
              animate={{ left: hatchFrom - TRACK_H / 2, width: Math.max(TRACK_H / 2, hatchTo - hatchFrom + TRACK_H / 2), opacity: over > 0 ? 1 : 0 }}
              transition={move}
            />
            <motion.div className="absolute inset-y-0 left-0 rounded-full bg-[#e9e9e7]" initial={false} animate={{ width: laneEnd }} transition={move} />
            {load.capacity !== null && (
              <motion.div className="absolute -inset-y-1 w-[1.5px] rounded-full bg-ink" initial={false} animate={{ left: laneEnd }} transition={move} />
            )}
          </>
        ) : (
          <div className="absolute inset-0 rounded-full border border-dashed border-line-2" />
        )}

        {mine.map((t, i) => {
          const { at, w } = own[i];
          return (
            <Segment
              key={t.id}
              task={t}
              left={at}
              width={w}
              leaving={moving.has(t.id)}
              dragging={drag?.id === t.id}
              onPointerDown={(e) => onDragStart(e, t, id)}
            />
          );
        })}

        {/* Plan preview: where incoming work would land */}
        <AnimatePresence>
          {incoming.map((t, i) => {
            const { at, w } = landing[i];
            return <Incoming key={`in-${t.id}`} task={t} left={at} width={w} />;
          })}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

/** A handover's landing spot in the receiver's row, naming who it comes from */
function Incoming({ task, left, width }: { task: Task; left: number; width: number }) {
  const owner = usePerson(task.ownerId);
  // An archived owner reads as unassigned (Q7)
  const from = owner && !owner.archived ? owner.name : "Unassigned";
  return (
    <motion.div
      className="t-body-s pointer-events-none absolute flex items-center gap-2 rounded-full border-[1.5px] border-dashed border-ink px-3.5 text-text"
      style={{ left: PAD + left, width: width - GAP, top: PAD, height: SEG_H }}
      initial={{ opacity: 0, filter: "blur(6px)" }}
      animate={{ opacity: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, transition: { duration: 0.35, ease: ease.out } }}
      transition={{ duration: 0.5, ease: ease.out, delay: 0.25 }}
    >
      <span className="truncate">{task.title}</span>
      <span className="t-data ml-auto shrink-0 text-text-3">from {from}</span>
    </motion.div>
  );
}

function Segment({
  task,
  left,
  width,
  leaving,
  dragging,
  onPointerDown,
}: {
  task: Task;
  left: number;
  width: number;
  leaving: boolean;
  dragging: boolean;
  onPointerDown: (e: RPointerEvent<HTMLElement>) => void;
}) {
  const { selected, highlight, dim } = useTaskSurface(task);
  // A leaving segment is the task's ghost, light whatever its emphasis: dimmed ink under light text would fail contrast
  const ink = task.emphasis && !leaving;
  const unsized = task.estimateDays == null;
  const surface = ink ? SEG_INK : leaving ? SEG_LEAVING : dim ? SEG_DIM : SEG;
  const shadow = leaving
    ? "shadow-[0_8px_22px_-14px_rgba(0,0,0,0.16)]"
    : dim
      ? "shadow-[0_8px_22px_-14px_rgba(0,0,0,0.2)]"
      : "shadow-[0_8px_22px_-14px_rgba(0,0,0,0.4)]";
  return (
    // Same width in every row, so a handover only moves it: position-only layout, nothing stretches
    <motion.div
      layoutId={`team-${task.id}`}
      layout="position"
      data-task-id={task.id}
      onPointerDown={onPointerDown}
      className={`${ink ? "tone-dark text-on-ink" : "tone-light text-text"} t-body-s absolute flex cursor-grab touch-none items-center gap-2 overflow-hidden px-3.5 ${shadow} select-none active:cursor-grabbing ${
        unsized || leaving ? "border-[1.5px] border-dashed border-line-strong" : ""
      } ${selected ? "outline-[1.5px] outline-offset-[3px] outline-ink outline-solid" : ""}`}
      style={{ left: PAD + left, top: PAD, height: SEG_H, borderRadius: SEG_H / 2 }}
      initial={false}
      // The drag source stays faint: the floating copy carries its text while it moves
      animate={{ width: width - GAP, backgroundColor: surface, opacity: dragging ? 0.25 : 1 }}
      transition={{ layout: move, width: move, backgroundColor: { duration: 0.3 }, opacity: { duration: 0.3 } }}
      title={`${task.title} · ${unsized ? "no estimate" : `${task.estimateDays}d`} · ${task.progress}%`}
    >
      {highlight && <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-signal" />}
      <span className="min-w-0 truncate">{task.title}</span>
      <span className={`t-data ml-auto shrink-0 ${ink ? "text-on-ink/60" : "text-text-3"}`}>
        {unsized ? "?d" : `${task.estimateDays}d`}
        {task.progress > 0 && <span> · {task.progress}%</span>}
      </span>
    </motion.div>
  );
}

function Avatar({ person, over }: { person: Person | null; over: boolean }) {
  if (!person)
    return <span className="t-body-s grid h-[40px] w-[40px] shrink-0 place-items-center rounded-full border border-dashed border-text-4 text-text-3">?</span>;
  return (
    <span
      className={`t-body-s relative grid h-[40px] w-[40px] shrink-0 place-items-center rounded-full bg-ink font-medium text-on-ink ring-offset-2 ring-offset-[var(--paper)] transition-[box-shadow] duration-500 ${over ? "ring-2 ring-signal-graphic" : "ring-0 ring-transparent"}`}
    >
      {initials(person.name)}
    </span>
  );
}

/**
 * "{days}/{capacity}d" and "+{over}d over" or "{free}d free"; with the proposal previewed, the
 * figures after it. An unknown capacity (Q3) gives the days of work and no verdict.
 */
function LoadFigure({ load, next }: { load: LaneLoad; next: LaneLoad | null }) {
  const changes = next != null && next.days !== load.days;
  const shown = changes ? next : load;
  return (
    <div className="flex shrink-0 flex-col items-end">
      <span className="t-num text-[17px] tracking-[-0.025em] whitespace-nowrap">
        {changes ? (
          <>
            <span className="text-text-3 line-through decoration-1">{fmtLoad(load.days)}</span> {fmtLoad(next.days)}
          </>
        ) : (
          fmtLoad(load.days)
        )}
        <span className="text-text-3">{shown.capacity === null ? "d" : <>/{fmtLoad(shown.capacity)}d</>}</span>
      </span>
      {shown.capacity === null ? (
        <span className="t-data text-text-3">Capacity unknown</span>
      ) : (shown.over ?? 0) > 0 ? (
        <span className="t-data text-signal-text">+{fmtLoad(shown.over ?? 0)}d over</span>
      ) : (
        <span className="t-data text-text-3">{fmtLoad(shown.free ?? 0)}d free</span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------
   Plan — FORM's proposal, in the agent's ink material
   ------------------------------------------------------------------ */

/** A move of the pending reassign proposal, with its task */
type PlanMove = ReassignMove & { task: Task };

function PlanCard({
  plan,
  tasks,
  lanes,
  onAccept,
  onDiscard,
}: {
  plan: ReassignProposal;
  tasks: Tasks;
  lanes: readonly LaneLoad[];
  onAccept: () => void;
  onDiscard: () => void;
}) {
  const moves: PlanMove[] = plan.moves.flatMap((m) => (Object.hasOwn(tasks, m.taskId) ? [{ ...m, task: tasks[m.taskId] }] : []));
  // The most overloaded person now (the first of a tie)
  const worst = lanes.reduce<LaneLoad | null>((w, l) => (l.personId !== null && (l.over ?? 0) > (w?.over ?? 0) ? l : w), null);
  const first = moves.length === 1 ? moves[0] : null;
  const one = first?.type === "owner" ? first : null;
  const worstPerson = usePerson(worst?.personId ?? null);
  const receiver = usePerson(one?.to ?? null);
  const to = receiver?.name ?? "?";
  // /demo proposes handovers only; a start shift (balance v2's fallback) is listed as a change
  const handovers = moves.every((m) => m.type === "owner");
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 p-5 md:p-6">
        <div className="min-w-0">
          <span className="t-micro text-on-ink/50">FORM suggests</span>
          <p className="t-title mt-2">
            {one
              ? `Move ${one.task.title} to ${to}`
              : handovers
                ? `${moves.length} handovers to balance the team`
                : `${moves.length} ${moves.length === 1 ? "change" : "changes"} to balance the team`}
          </p>
          <p className="t-body-s mt-1.5 text-on-ink/60">
            {worst && worstPerson ? `${worstPerson.name} is ${fmtLoad(worst.over ?? 0)}d over capacity. ` : ""}
            {one
              ? `${to} has room for its ${one.task.estimateDays ?? "?"}d.`
              : handovers
                ? "Each move fits the receiver's capacity."
                : "Each change keeps the team within capacity."}
          </p>
          {!one && (
            <ul className="mt-3 flex flex-col gap-1">
              {moves.map((m) => (
                <PlanItem key={m.taskId} item={m} />
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onDiscard}
            className="focus-ring-ink t-body-s h-[38px] cursor-pointer rounded-full px-4 text-on-ink/70 transition-colors hover:bg-white/10 hover:text-on-ink"
          >
            <ShuffleText text="Discard" />
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="focus-ring-ink t-body-s h-[38px] cursor-pointer rounded-full bg-on-ink px-4 text-ink transition-transform hover:scale-[1.03]"
          >
            <ShuffleText text={one ? "Accept" : `Accept ${moves.length}`} />
          </button>
        </div>
      </div>
    </>
  );
}

/** One move of a proposal with several: who hands the task to whom, or how far its start moves */
function PlanItem({ item }: { item: PlanMove }) {
  const owner = usePerson(item.task.ownerId);
  const receiver = usePerson(item.type === "owner" ? item.to : null);
  // An archived owner reads as unassigned (Q7); an unknown id as "?"
  const name = (id: PersonId | null, person: Person | null) => (id === null || person?.archived ? "Unassigned" : (person?.name ?? "?"));
  return (
    <li className="t-body-s flex items-center gap-2 text-on-ink/85">
      <span>{item.task.title}</span>
      <span className="t-data text-on-ink/50">
        {item.type === "owner" ? (
          <>
            {name(item.task.ownerId, owner)} → {name(item.to, receiver)} · {item.task.estimateDays}d
          </>
        ) : (
          <>starts {item.days}d later</>
        )}
      </span>
    </li>
  );
}

/* ------------------------------------------------------------------
   No team yet
   ------------------------------------------------------------------ */

function NoTeam() {
  const actions = useActions();
  return (
    <div className="glass grid min-h-[320px] place-items-center rounded-[36px] p-8 text-center">
      <div className="flex max-w-[40ch] flex-col items-center gap-3">
        <span className="t-title">No team yet</span>
        <span className="t-body-s text-text-3">
          Add people to see who&rsquo;s doing what, and who&rsquo;s over capacity. Or say &lsquo;add Giulia to the team&rsquo;.
        </span>
        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => actions.addSampleTeam()}
            className="focus-ring t-body-s h-[36px] cursor-pointer rounded-full bg-ink px-4 text-on-ink transition-transform hover:scale-[1.02]"
          >
            <ShuffleText text="Use a sample team" />
          </button>
          <button
            type="button"
            onClick={() => actions.addPerson()}
            className="focus-ring t-body-s h-[36px] cursor-pointer rounded-full px-4 text-text-2 transition-colors hover:bg-black/[0.05] hover:text-text"
          >
            <ShuffleText text="Add a person" />
          </button>
        </div>
      </div>
    </div>
  );
}
