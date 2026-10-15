"use client";

import { AnimatePresence, motion } from "motion/react";
import { Fragment, useMemo } from "react";
import { addDays, daysBetween, isoWeekday } from "@/lib/domain/dates";
import { STATUS_LABEL } from "@/lib/domain/labels";
import type { TaskId } from "@/lib/domain/schema/ids";
import type { IsoDate } from "@/lib/domain/schema/primitives";
import type { Step, Task } from "@/lib/domain/schema/project";
import { dateMode, fmtDateYear, fmtDay, fmtDays, fmtShort, scheduleLabel, unknownLabel } from "@/lib/planning/format";
import { useActions, usePlan, useProposalCells, useTaskIds, useTimelineGrid, useToday, useVisibleTaskIds } from "@/lib/store/hooks";
import { ease, move } from "@/lib/motion";
import { useWidth } from "@/lib/useWidth";
import { EditableText, EstimateControl, NumberBadge, StatusControl, StatusGlyph } from "./parts";
import { useTaskSurface } from "./TaskCard";
import { useReveal } from "./reveal";
import { ShuffleText } from "../text/ShuffleText";

/**
 * The timeline doesn't morph out of cards (bars and cards share no geometry):
 * it draws itself — panel, header, then each row's label and bar in workflow order.
 */
const BUILD = { header: 0.14, label: 0.18, bar: 0.26, step: 0.06 };

/**
 * A bar's track. Dimmed (Q14), only the track recedes, to half its ink; the progress fill, its
 * label and the urgent dot keep full contrast.
 */
const TRACK = "rgba(10,10,10,0.075)";
const TRACK_DIM = "rgba(10,10,10,0.0375)";
const TRACK_INK = "rgba(10,10,10,0.2)";

/** A direct edit: one history entry, no caption unless refused (v0 "edit") */
const EDIT = { label: "edit" } as const;

/**
 * Representation: timeline. Dates come from the schedule: working days from the start, estimates
 * and dependencies (plan §8.2), drawn on the v0 calendar-day grid, so a bar spans the weekends
 * inside it. They are labelled as a sample until the user sets a start.
 */
export function TimelineView() {
  const plan = usePlan();
  const grid = useTimelineGrid();
  const proposalCells = useProposalCells();
  const workflow = useTaskIds();
  const visible = useVisibleTaskIds();
  const today = useToday();
  const { resolveProposal: resolve, shiftStart } = useActions();
  const [ref, width] = useWidth<HTMLDivElement>();

  // Workflow order, as the header says; the view's filters (hide done …) still apply
  const rows = useMemo(() => {
    const shown = new Set(visible);
    return workflow.filter((id) => shown.has(id));
  }, [workflow, visible]);

  if (plan === null || grid === null) return null;
  const project = plan.project;
  const view = project.viewConfig;
  const compact = view.density === "compact";
  const mode = dateMode(plan.schedule.anchor);

  // Day 0 is the anchor date; with no date at all (relative mode) the cells are working days
  const origin = grid.origin;
  const todayOff = origin === null ? null : daysBetween(origin, today);
  const from = -1;
  let end = Math.max(grid.totalDays, 1) + 2;
  if (todayOff !== null && todayOff >= end && todayOff < end + 10) end = todayOff + 2;
  const days = end - from;
  /** Today's cell, when it is on the grid */
  const todayAt = todayOff !== null && todayOff >= from && todayOff <= end ? todayOff : null;

  const labelW = width < 640 ? 164 : compact ? 248 : 280;
  const tail = 84; // room for the date range printed after the last bar
  const chartW = Math.max(days * 24, width - labelW - tail);
  const dayW = chartW / days;
  const X = (d: number) => (d - from) * dayW;
  const rowH = compact ? 48 : 62;
  const barH = compact ? 26 : 34;
  const subH = compact ? 32 : 36;

  const dateAt = (d: number): IsoDate | null => (origin === null ? null : addDays(origin, d));
  const titleOf = (id: TaskId) => (Object.hasOwn(project.tasks, id) ? project.tasks[id].title : "a task");

  let spawn = 0;
  let order = 0; // build order across task and step rows

  const ticks = Array.from({ length: days }, (_, i) => {
    const d = from + i;
    const date = dateAt(d);
    // Shaded: the days the calendar doesn't work (the weekends, in the demo)
    return { d, date, monday: date !== null && isoWeekday(date) === 1, weekend: date !== null && !plan.calendar.isWorkingDay(date) };
  });

  return (
    <div className="relative">
      <motion.div
        aria-hidden
        className="glass absolute inset-0"
        style={{ borderRadius: 36 }}
        initial={{ opacity: 0, scale: 0.985 }}
        animate={{ opacity: 1, scale: 1, transition: move }}
      />
      <div className="relative p-3 md:p-5">
        <div ref={ref} className="no-scrollbar overflow-x-auto">
          <div className="relative" style={{ width: labelW + chartW + tail }}>
            {/* Grid: weekends, day lines, today */}
            <motion.div
              aria-hidden
              className="pointer-events-none absolute top-0 bottom-0"
              style={{ left: labelW, width: chartW }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { delay: 0.12, duration: 0.4 } }}
            >
              {ticks.map((t) => (
                <div
                  key={t.d}
                  className="absolute top-0 bottom-0"
                  style={{
                    left: X(t.d),
                    width: dayW,
                    background: t.weekend ? "rgba(10,10,10,0.022)" : undefined,
                    borderLeft: `1px solid ${t.monday ? "rgba(10,10,10,0.1)" : "rgba(10,10,10,0.04)"}`,
                  }}
                />
              ))}
              {todayAt !== null && (
                <div className="absolute top-0 bottom-0 w-px bg-ink" style={{ left: X(todayAt) + dayW / 2 }}>
                  <span className="t-micro absolute top-[10px] left-1/2 z-10 -translate-x-1/2 rounded-full bg-ink px-2 py-[3px] whitespace-nowrap text-on-ink">
                    Today {fmtShort(today)}
                  </span>
                </div>
              )}
            </motion.div>

            {/* Header: weeks above, days below */}
            <motion.div
              className="relative flex h-[56px] items-end pb-2.5"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: BUILD.header, duration: 0.5, ease: ease.out }}
            >
              <div className="flex shrink-0 flex-col gap-1 pl-2" style={{ width: labelW }}>
                <span className="t-micro text-text-2">Task</span>
                <span className="t-micro text-text-3">Workflow order</span>
              </div>
              <div className="relative h-full" style={{ width: chartW }}>
                {ticks.map((t, i) =>
                  t.date !== null &&
                  (t.monday || (i === 0 && !ticks.slice(1, 4).some((n) => n.monday))) &&
                  // The today tag owns its slot in the week row
                  !(todayAt !== null && Math.abs(X(t.d) - X(todayAt)) < 72) ? (
                    <span key={`w${t.d}`} className="t-micro absolute top-[14px] pl-1.5 whitespace-nowrap text-text-2" style={{ left: X(t.d) }}>
                      {fmtDay(t.date)}
                    </span>
                  ) : null,
                )}
                {dayW >= 22 &&
                  ticks.map((t) =>
                    t.date !== null ? (
                      <span
                        key={`d${t.d}`}
                        className="t-data absolute bottom-0 text-center text-[11px] text-text-3"
                        style={{ left: X(t.d), width: dayW }}
                      >
                        {t.date.slice(8, 10)}
                      </span>
                    ) : null,
                  )}
              </div>
            </motion.div>

            {/* Rows */}
            <div className="relative">
              {rows.map((id) => {
                const t = project.tasks[id];
                const bar = grid.bars.get(id);
                const timing = plan.schedule.timings.get(id);
                const proposal = project.proposal?.kind === "subtasks" && project.proposal.taskId === id ? project.proposal : null;
                const spawnIndex = bar && spawn < 6 ? spawn++ : null;
                const at = order++;
                return (
                  <Fragment key={id}>
                    <Row height={rowH} labelW={labelW} enter={BUILD.label + at * BUILD.step} label={<RowLabel task={t} number={plan.number(id)} compact={compact} />}>
                      {bar ? (
                        <Bar
                          task={t}
                          left={X(bar.start)}
                          width={bar.days * dayW}
                          top={(rowH - barH) / 2}
                          height={barH}
                          spawnIndex={spawnIndex}
                          enter={BUILD.bar + at * BUILD.step}
                          range={origin === null ? null : [addDays(origin, bar.start), addDays(origin, bar.start + bar.days - 1)]}
                        />
                      ) : (
                        <div className="absolute flex items-center gap-2" style={{ left: X(grid.totalDays) + 8, top: (rowH - 26) / 2 }}>
                          {/* The task without an estimate offers one; the tasks waiting on it name it */}
                          <span className="t-data text-text-3">{timing?.kind === "unknown" ? unknownLabel(timing, plan.schedule, titleOf) : "Needs a duration"}</span>
                          {(timing === undefined || (timing.kind === "unknown" && timing.reason === "noEstimate")) && (
                            <span className="tone-light">
                              <EstimateControl task={t} />
                            </span>
                          )}
                        </div>
                      )}
                    </Row>

                    {/* Steps travel within the timeline only (proposal → accepted): a card keeps its steps in a clipped window */}
                    {t.steps.map((s) => {
                      const ss = grid.steps.get(s.id);
                      const sat = order++;
                      return (
                        <Row key={s.id} height={subH} labelW={labelW} enter={BUILD.label + sat * BUILD.step} label={<SubLabel taskId={id} step={s} />} layoutId={`tl-sub-${s.id}`}>
                          {ss && (
                            <motion.div
                              className="absolute"
                              initial={{ clipPath: wipe(6, false) }}
                              animate={{ clipPath: wipe(6, true), backgroundColor: s.done ? "#0a0a0a" : "rgba(10,10,10,0.1)", transitionEnd: { clipPath: "none" } }}
                              transition={{ clipPath: { ...move, delay: BUILD.bar + sat * BUILD.step }, backgroundColor: { duration: 0.3 } }}
                              style={{ left: X(ss.start) + 1, width: Math.max(10, ss.days * dayW - 2), top: (subH - 12) / 2, height: 12, borderRadius: 6 }}
                            />
                          )}
                        </Row>
                      );
                    })}

                    <AnimatePresence>
                      {proposal && (
                        <motion.div
                          key="proposal"
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0, transition: { duration: 0.18 } }}
                          transition={move}
                          className="overflow-hidden"
                        >
                          {proposal.items.map((item, i) => {
                            // Where the step sits once accepted (the schedule's step rule, on the proposal preview)
                            const cell = proposalCells.get(item.stepId);
                            return (
                              <Row
                                key={item.stepId}
                                height={subH}
                                labelW={labelW}
                                layoutId={`tl-sub-${item.stepId}`}
                                label={
                                  <div className="flex min-w-0 items-center gap-2 pl-9 text-text-3">
                                    <StatusGlyph status="todo" size={12} />
                                    <span className="t-body-s truncate">{item.title}</span>
                                  </div>
                                }
                              >
                                {cell && (
                                  <motion.div
                                    className="absolute rounded-full border border-dashed border-line-strong"
                                    initial={{ opacity: 0, x: -8 }}
                                    animate={{ opacity: 1, x: 0, transition: { delay: 0.1 + i * 0.06, ...move } }}
                                    style={{ left: X(cell.start) + 1, width: Math.max(10, cell.days * dayW - 2), top: (subH - 14) / 2, height: 14 }}
                                  />
                                )}
                              </Row>
                            );
                          })}
                          <div className="flex items-center gap-1.5 py-2 pl-9">
                            <span className="t-micro mr-2 text-text-3">Proposed by FORM</span>
                            <button
                              type="button"
                              onClick={() => resolve(true)}
                              className="focus-ring t-body-s h-[32px] cursor-pointer rounded-full bg-ink px-4 text-on-ink transition-transform hover:scale-[1.02]"
                            >
                              <ShuffleText text={`Accept ${proposal.items.length} steps`} />
                            </button>
                            <button
                              type="button"
                              onClick={() => resolve(false)}
                              className="focus-ring t-body-s h-[32px] cursor-pointer rounded-full px-4 text-text-2 transition-colors hover:bg-black/[0.05] hover:text-text"
                            >
                              <ShuffleText text="Discard" />
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </Fragment>
                );
              })}
            </div>
          </div>
        </div>

        {/* Honest footer: where the dates come from */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <span className="t-data text-text-3">
            {scheduleLabel(mode)} · working days, from estimates and dependencies
            {grid.unscheduled.length > 0 && ` · ${grid.unscheduled.length} without dates`}
          </span>
          <div className="flex items-center gap-1">
            <span className="t-micro mr-1 text-text-3">Start</span>
            <ShiftButton label="Start one week earlier" onClick={() => shiftStart(-7)} d="M6.5 2.5L3.5 5l3 2.5" />
            <span className="t-data rounded-full bg-white/70 px-2.5 py-1.5 text-text">
              {project.startDate === null ? "—" : fmtDateYear(project.startDate)}
              {project.startDate !== null && mode === "sample" && <span className="text-text-3"> · sample date</span>}
            </span>
            <ShiftButton label="Start one week later" onClick={() => shiftStart(7)} d="M3.5 2.5L6.5 5l-3 2.5" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ShiftButton({ label, onClick, d }: { label: string; onClick: () => void; d: string }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="focus-ring grid h-[26px] w-[26px] cursor-pointer place-items-center rounded-full text-text-2 transition-colors hover:bg-black/[0.05] hover:text-text">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
        <path d={d} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/** A clip that wipes a pill open from its left end, keeping its rounded ends intact */
function wipe(radius: number, open: boolean) {
  return `inset(0px ${open ? "0%" : "100%"} 0px 0px round ${radius}px)`;
}

function Row({
  height,
  labelW,
  label,
  children,
  layoutId,
  enter,
}: {
  height: number;
  labelW: number;
  label: React.ReactNode;
  children?: React.ReactNode;
  layoutId?: string;
  /** Build-in delay (s): the label condenses out of a blur, like every text in FORM */
  enter?: number;
}) {
  return (
    <motion.div layout="position" layoutId={layoutId} transition={move} className="relative flex border-b border-line last:border-b-0" style={{ height }}>
      {/* The fade lives below the layout node, whose projection would override its opacity */}
      <motion.div
        className="flex min-w-0 shrink-0 items-center pr-3"
        style={{ width: labelW }}
        {...(enter != null && {
          initial: { opacity: 0, filter: "blur(8px)" },
          animate: { opacity: 1, filter: "blur(0px)", transitionEnd: { filter: "none" } },
          transition: { delay: enter, duration: 0.6, ease: ease.out },
        })}
      >
        {label}
      </motion.div>
      <div className="relative flex-1">{children}</div>
    </motion.div>
  );
}

function RowLabel({ task, number, compact }: { task: Task; number: string; compact: boolean }) {
  const { commit } = useActions();
  const { highlight } = useTaskSurface(task);
  return (
    <div className="tone-light flex min-w-0 flex-1 items-center gap-2">
      <NumberBadge task={task} number={number} inline />
      <StatusControl task={task} variant="bare" />
      {highlight && <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-signal" aria-label="Urgent" />}
      <EditableText
        value={task.title}
        label="Task title"
        onCommit={(v) => commit([{ op: "updateTask", taskId: task.id, field: "title", value: v }], EDIT)}
        className={`${compact ? "t-body" : task.emphasis ? "t-body-l" : "t-body"} min-w-0 truncate`}
      />
    </div>
  );
}

function SubLabel({ taskId, step }: { taskId: TaskId; step: Step }) {
  const { commit } = useActions();
  return (
    <div className="tone-light flex min-w-0 flex-1 items-center gap-2 pl-9">
      <button
        type="button"
        aria-label={step.done ? `Mark ${step.title} not done` : `Mark ${step.title} done`}
        onClick={() => commit([{ op: "updateStep", taskId, stepId: step.id, field: "done", value: !step.done }], EDIT)}
        className="focus-ring grid h-[20px] w-[20px] shrink-0 cursor-pointer place-items-center rounded-full"
      >
        <StatusGlyph status={step.done ? "done" : "todo"} size={12} />
      </button>
      <EditableText
        value={step.title}
        label="Step title"
        onCommit={(v) => commit([{ op: "updateStep", taskId, stepId: step.id, field: "title", value: v }], EDIT)}
        className={`t-body-s min-w-0 truncate ${step.done ? "text-text-3 line-through" : "text-text-2"}`}
      />
      <span className="t-data ml-auto shrink-0 text-text-3">{fmtDays(step.estimateDays)}</span>
    </div>
  );
}

function Bar({
  task,
  left,
  width,
  top,
  height,
  spawnIndex,
  enter,
  range,
}: {
  task: Task;
  left: number;
  width: number;
  top: number;
  height: number;
  spawnIndex: number | null;
  /** Build-in delay (s) of the wipe */
  enter: number;
  /** First and last day under the bar; null when the schedule has no dates (relative mode) */
  range: readonly [IsoDate, IsoDate] | null;
}) {
  const { selected, dim, onClick, highlight } = useTaskSurface(task);
  const reveal = useReveal(spawnIndex);
  const w = Math.max(height, width - 2);
  const fill = task.status === "done" ? w : Math.max(height, (task.progress / 100) * w);
  const inside = fill > 58;
  const r = height / 2;

  return (
    <>
      {/* Drawn, never scaled: a clip wipes the pill open from its start date, then it glides on schedule changes */}
      <motion.button
        type="button"
        data-task-id={task.id}
        data-spawn={spawnIndex ?? undefined}
        aria-label={`${task.title}: ${STATUS_LABEL[task.status]}, ${task.progress}%`}
        aria-pressed={selected}
        onClick={onClick}
        initial={{ left: left + 1, width: w, ...(reveal != null ? { opacity: 0 } : { clipPath: wipe(r, false) }) }}
        animate={{
          left: left + 1,
          width: w,
          clipPath: wipe(r, true),
          opacity: 1,
          backgroundColor: task.emphasis ? TRACK_INK : dim ? TRACK_DIM : TRACK,
          transitionEnd: { clipPath: "none" },
        }}
        transition={{
          left: move,
          width: move,
          clipPath: { ...move, delay: enter },
          opacity: reveal != null ? { delay: reveal, duration: 0 } : { duration: 0.3 },
        }}
        className={`focus-ring absolute cursor-pointer overflow-hidden ${selected ? "outline-[1.5px] outline-offset-[3px] outline-ink outline-solid" : ""}`}
        style={{ top, height, borderRadius: r }}
      >
        <motion.span
          className="absolute inset-y-0 left-0 flex items-center justify-end bg-ink pr-3"
          style={{ borderRadius: r }}
          initial={false}
          animate={{ width: fill }}
          transition={move}
        >
          {task.status === "done" ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden className="text-on-ink">
              <path d="M2.5 6.2l2.3 2.3 4.7-5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            inside && <span className="t-data text-on-ink">{task.progress}%</span>
          )}
        </motion.span>
        {!inside && task.status !== "done" && (
          <motion.span className="t-data absolute inset-y-0 flex items-center text-text-2" initial={false} animate={{ left: fill + 8 }} transition={move}>
            {task.progress}%
          </motion.span>
        )}
        {highlight && (
          <span className="absolute inset-y-0 right-2.5 flex items-center">
            <span className="h-[7px] w-[7px] rounded-full bg-signal-graphic" />
          </span>
        )}
      </motion.button>
      {range !== null && (
        <motion.span
          className="t-data pointer-events-none absolute whitespace-nowrap text-text-3"
          style={{ top: top + height / 2 - 6 }}
          initial={{ opacity: 0, left: left + w + 10 }}
          animate={{ opacity: 1, left: left + w + 10 }}
          transition={{ left: move, opacity: { delay: enter + 0.4, duration: 0.4 } }}
        >
          {fmtShort(range[0])}–{fmtShort(range[1])}
        </motion.span>
      )}
    </>
  );
}
