"use client";

import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState, type PointerEvent as RPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useForm } from "@/lib/store";
import { ease, move } from "@/lib/motion";
import { fmtLoad, initials, loadsOf, ownersOf, type Load } from "@/lib/team";
import { useWidth } from "@/lib/useWidth";
import type { Doc, Person, ReassignPlan, Task } from "@/lib/schema";
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
const SAMPLE_IDS = ["p-marta", "p-sara", "p-luca"];
const HATCH = "repeating-linear-gradient(-45deg, rgba(214,69,69,0.2) 0 5px, rgba(214,69,69,0.06) 5px 10px)";

const wipe = (open: boolean) => `inset(0px ${open ? "0%" : "100%"} 0px 0px round ${TRACK_H / 2}px)`;

interface Drag {
  id: string;
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
 */
export function TeamView() {
  const empty = useForm((s) => s.doc.people.length === 0);
  // Separate components, so the board measures its width when it mounts
  return empty ? <NoTeam /> : <TeamBoard />;
}

function TeamBoard() {
  const doc = useForm((s) => s.doc);
  const commit = useForm((s) => s.commit);
  const select = useForm((s) => s.select);
  const resolvePlan = useForm((s) => s.resolvePlan);
  const submit = useForm((s) => s.submit);
  const phase = useForm((s) => s.phase);
  const [ref, width] = useWidth<HTMLDivElement>(0);
  const [drag, setDrag] = useState<Drag | null>(null);

  const plan = doc.plan;
  const loads = useMemo(() => loadsOf(doc), [doc]);
  const preview = useMemo(() => (plan ? loadsOf(doc, ownersOf(doc, plan)) : null), [doc, plan]);
  const moving = useMemo(() => new Map(plan?.moves.map((m) => [m.taskId, m.to]) ?? []), [plan]);

  const narrow = width < 640;
  const labelW = narrow ? 0 : 260;
  const trackW = Math.max(120, width - labelW - (narrow ? 0 : 16));
  const span = (l: Load) => Math.max(l.person?.capacity ?? 0, l.days + l.unsized);
  const maxDays = Math.max(4, ...loads.map(span), ...(preview ?? []).map(span)) + 0.5;
  const dayW = (trackW - 2 * PAD + GAP) / maxDays;
  const unassigned = loads[loads.length - 1];
  const showUnassigned = unassigned.tasks.length > 0 || Boolean(preview?.[preview.length - 1].tasks.length) || drag != null;
  const rows = showUnassigned ? loads : loads.slice(0, -1);
  const overloaded = loads.some((l) => l.over > 0) || unassigned.tasks.some((t) => t.estimate != null);
  const sample = doc.people.some((p) => SAMPLE_IDS.includes(p.id));

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
        const st = useForm.getState();
        select(st.selectedId === task.id ? null : task.id);
        return;
      }
      const to = rowAt(ev.clientX, ev.clientY);
      setDrag(null);
      if (to && to !== from) {
        const person = doc.people.find((p) => p.id === to);
        commit(
          [{ op: "assignTask", taskId: task.id, personId: to === NONE ? null : to }],
          person ? `${task.title} → ${person.name}` : `unassign ${task.title}`,
        );
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
              onClick={() => commit([{ op: "addPerson", name: `Person ${doc.people.length + 1}` }], "add person")}
              className="focus-ring t-body-s h-[34px] cursor-pointer rounded-full px-3.5 text-text-2 transition-colors hover:bg-black/[0.05] hover:text-text"
            >
              <ShuffleText text="Add person" />
            </button>
            {overloaded && !plan && (
              <button
                type="button"
                disabled={phase === "processing"}
                onClick={() => submit("Balance the workload")}
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
              <PlanCard doc={doc} plan={plan} loads={loads} onAccept={() => resolvePlan(true)} onDiscard={() => resolvePlan(false)} />
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={ref}>
          {width > 0 &&
            rows.map((load, i) => {
              const id = load.person?.id ?? NONE;
              return (
                <Row
                  key={id}
                  id={id}
                  load={load}
                  next={preview?.[loads.indexOf(load)] ?? null}
                  index={i}
                  narrow={narrow}
                  labelW={labelW}
                  dayW={dayW}
                  moving={moving}
                  people={doc.people}
                  drag={drag}
                  onDragStart={startDrag}
                />
              );
            })}
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
  load,
  next,
  index,
  narrow,
  labelW,
  dayW,
  moving,
  people,
  drag,
  onDragStart,
}: {
  id: string;
  load: Load;
  /** The same row with the proposed plan applied */
  next: Load | null;
  index: number;
  narrow: boolean;
  labelW: number;
  dayW: number;
  moving: Map<string, string | null>;
  people: Person[];
  drag: Drag | null;
  onDragStart: (e: RPointerEvent<HTMLElement>, task: Task, from: string) => void;
}) {
  const commit = useForm((s) => s.commit);
  const p = load.person;
  const target = drag != null && drag.over === id && drag.from !== id;
  const incoming = next ? next.tasks.filter((t) => !load.tasks.some((o) => o.id === t.id)) : [];
  const nameOf = (pid: string | null) => people.find((x) => x.id === pid)?.name ?? "Unassigned";

  // Tasks sit end to end along the track, sized by estimate (a task with no estimate takes one day)
  const lay = (tasks: Task[], start: number) =>
    tasks.reduce<{ at: number; w: number }[]>((acc, t) => {
      const prev = acc[acc.length - 1];
      acc.push({ at: prev ? prev.at + prev.w : start, w: Math.max(1, t.estimate ?? 1) * dayW });
      return acc;
    }, []);
  const own = lay(load.tasks, 0);
  const tail = own.length ? own[own.length - 1].at + own[own.length - 1].w : 0;
  const landing = lay(incoming, tail);
  const laneEnd = p ? 2 * PAD + p.capacity * dayW - GAP : 0;
  const workEnd = tail ? 2 * PAD + tail - GAP : 0;

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
        <Avatar person={p} over={load.over > 0} />
        <div className="flex min-w-0 flex-1 flex-col">
          {p ? (
            <EditableText
              value={p.name}
              label="Name"
              onCommit={(v) => commit([{ op: "updatePerson", id: p.id, patch: { name: v.slice(0, 40) } }], "rename person")}
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
              animate={{ left: laneEnd - TRACK_H / 2, width: Math.max(TRACK_H / 2, workEnd - laneEnd + TRACK_H / 2), opacity: workEnd > laneEnd ? 1 : 0 }}
              transition={move}
            />
            <motion.div className="absolute inset-y-0 left-0 rounded-full bg-[#e9e9e7]" initial={false} animate={{ width: laneEnd }} transition={move} />
            <motion.div className="absolute -inset-y-1 w-[1.5px] rounded-full bg-ink" initial={false} animate={{ left: laneEnd }} transition={move} />
          </>
        ) : (
          <div className="absolute inset-0 rounded-full border border-dashed border-line-2" />
        )}

        {load.tasks.map((t, i) => {
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
            return (
              <motion.div
                key={`in-${t.id}`}
                className="t-body-s pointer-events-none absolute flex items-center gap-2 rounded-full border-[1.5px] border-dashed border-ink px-3.5 text-text"
                style={{ left: PAD + at, width: w - GAP, top: PAD, height: SEG_H }}
                initial={{ opacity: 0, filter: "blur(6px)" }}
                animate={{ opacity: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, transition: { duration: 0.35, ease: ease.out } }}
                transition={{ duration: 0.5, ease: ease.out, delay: 0.25 }}
              >
                <span className="truncate">{t.title}</span>
                <span className="t-data ml-auto shrink-0 text-text-3">from {nameOf(t.owner && people.some((x) => x.id === t.owner) ? t.owner : null)}</span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </motion.div>
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
  const ink = task.emphasis;
  const unsized = task.estimate == null;
  return (
    // Same width in every row, so a handover only moves it: position-only layout, nothing stretches
    <motion.div
      layoutId={`team-${task.id}`}
      layout="position"
      data-task-id={task.id}
      onPointerDown={onPointerDown}
      className={`${ink ? "tone-dark bg-ink text-on-ink" : "tone-light bg-white/90 text-text"} t-body-s absolute flex cursor-grab touch-none items-center gap-2 overflow-hidden px-3.5 shadow-[0_8px_22px_-14px_rgba(0,0,0,0.4)] select-none active:cursor-grabbing ${
        unsized || leaving ? "border-[1.5px] border-dashed border-text-3" : ""
      } ${selected ? "outline-[1.5px] outline-offset-[3px] outline-ink outline-solid" : ""}`}
      style={{ left: PAD + left, top: PAD, height: SEG_H, borderRadius: SEG_H / 2 }}
      initial={false}
      animate={{ width: width - GAP, opacity: dragging ? 0.25 : leaving ? 0.4 : dim ? 0.5 : 1 }}
      transition={{ layout: move, width: move, opacity: { duration: 0.3 } }}
      title={`${task.title} · ${unsized ? "no estimate" : `${task.estimate}d`} · ${task.progress}%`}
    >
      {highlight && <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-signal" />}
      <span className="min-w-0 truncate">{task.title}</span>
      <span className={`t-data ml-auto shrink-0 ${ink ? "text-on-ink/60" : "text-text-3"}`}>
        {unsized ? "?d" : `${task.estimate}d`}
        {task.progress > 0 && <span className="opacity-70"> · {task.progress}%</span>}
      </span>
    </motion.div>
  );
}

function Avatar({ person, over }: { person: Person | null; over: boolean }) {
  if (!person)
    return <span className="t-body-s grid h-[40px] w-[40px] shrink-0 place-items-center rounded-full border border-dashed border-text-4 text-text-3">?</span>;
  return (
    <span
      className={`t-body-s relative grid h-[40px] w-[40px] shrink-0 place-items-center rounded-full bg-ink font-medium text-on-ink ring-offset-2 ring-offset-[var(--paper)] transition-[box-shadow] duration-500 ${over ? "ring-2 ring-signal" : "ring-0 ring-transparent"}`}
    >
      {initials(person.name)}
    </span>
  );
}

function LoadFigure({ load, next }: { load: Load; next: Load | null }) {
  const cap = load.person!.capacity;
  const changes = next != null && next.days !== load.days;
  return (
    <div className="flex shrink-0 flex-col items-end">
      <span className="t-num text-[17px] tracking-[-0.025em] whitespace-nowrap">
        {changes ? (
          <>
            <span className="text-text-3 line-through decoration-1">{fmtLoad(load.days)}</span> {fmtLoad(next!.days)}
          </>
        ) : (
          fmtLoad(load.days)
        )}
        <span className="text-text-3">/{fmtLoad(cap)}d</span>
      </span>
      {(changes ? next!.over : load.over) > 0 ? (
        <span className="t-data text-signal">+{fmtLoad(changes ? next!.over : load.over)}d over</span>
      ) : (
        <span className="t-data text-text-3">{fmtLoad(changes ? next!.free : load.free)}d free</span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------
   Plan — FORM's proposal, in the agent's ink material
   ------------------------------------------------------------------ */

function PlanCard({ doc, plan, loads, onAccept, onDiscard }: { doc: Doc; plan: ReassignPlan; loads: Load[]; onAccept: () => void; onDiscard: () => void }) {
  const name = (id: string | null) => (id ? (doc.people.find((p) => p.id === id)?.name ?? "?") : "Unassigned");
  const moves = plan.moves.map((m) => ({ ...m, task: doc.tasks[m.taskId] })).filter((m) => m.task);
  const worst = loads.filter((l) => l.over > 0).sort((a, b) => b.over - a.over)[0];
  const one = moves.length === 1 ? moves[0] : null;
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 p-5 md:p-6">
        <div className="min-w-0">
          <span className="t-micro text-on-ink/50">FORM suggests</span>
          <p className="t-title mt-2">{one ? `Move ${one.task.title} to ${name(one.to)}` : `${moves.length} handovers to balance the team`}</p>
          <p className="t-body-s mt-1.5 text-on-ink/60">
            {worst?.person ? `${worst.person.name} is ${fmtLoad(worst.over)}d over capacity. ` : ""}
            {one ? `${name(one.to)} has room for its ${one.task.estimate}d.` : "Each move fits the receiver's capacity."}
          </p>
          {!one && (
            <ul className="mt-3 flex flex-col gap-1">
              {moves.map((m) => (
                <li key={m.taskId} className="t-body-s flex items-center gap-2 text-on-ink/85">
                  <span>{m.task.title}</span>
                  <span className="t-data text-on-ink/50">
                    {name(m.task.owner)} → {name(m.to)} · {m.task.estimate}d
                  </span>
                </li>
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

/* ------------------------------------------------------------------
   No team yet
   ------------------------------------------------------------------ */

function NoTeam() {
  const commit = useForm((s) => s.commit);
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
            onClick={() => commit([{ op: "addSampleTeam" }], "sample team")}
            className="focus-ring t-body-s h-[36px] cursor-pointer rounded-full bg-ink px-4 text-on-ink transition-transform hover:scale-[1.02]"
          >
            <ShuffleText text="Use a sample team" />
          </button>
          <button
            type="button"
            onClick={() => commit([{ op: "addPerson", name: "Person 1" }], "add person")}
            className="focus-ring t-body-s h-[36px] cursor-pointer rounded-full px-4 text-text-2 transition-colors hover:bg-black/[0.05] hover:text-text"
          >
            <ShuffleText text="Add a person" />
          </button>
        </div>
      </div>
    </div>
  );
}
