"use client";

import { AnimatePresence, motion } from "motion/react";
import { Fragment, useMemo } from "react";
import { useForm } from "@/lib/store";
import { springs } from "@/lib/motion";
import { addDays, dayDiff, fmtDay, fmtDays, fmtShort, parseISODate, schedule, subtasksOf, taskNumber, toISODate, topLevel } from "@/lib/selectors";
import { STATUS_LABEL, type Task } from "@/lib/schema";
import { useWidth } from "@/lib/useWidth";
import { EditableText, EstimateControl, NumberBadge, StatusControl, StatusGlyph } from "./parts";
import { useTaskSurface } from "./TaskCard";
import { useReveal } from "./reveal";

/**
 * Representation: timeline. Dates are derived — start date + estimates in
 * workflow order — and labelled as a sample until the user sets a start.
 */
export function TimelineView() {
  const doc = useForm((s) => s.doc);
  const commit = useForm((s) => s.commit);
  const resolve = useForm((s) => s.resolveProposal);
  const tool = doc.tool!;
  const sch = useMemo(() => schedule(doc), [doc]);
  const [ref, width] = useWidth<HTMLDivElement>();
  const compact = doc.view.density === "compact";

  const start = parseISODate(tool.startDate);
  const todayOff = dayDiff(start, new Date());
  const from = -1;
  let end = Math.max(sch.totalDays, 1) + 2;
  if (todayOff >= end && todayOff < end + 10) end = todayOff + 2;
  const days = end - from;

  const labelW = width < 640 ? 164 : compact ? 248 : 280;
  const tail = 84; // room for the date range printed after the last bar
  const chartW = Math.max(days * 24, width - labelW - tail);
  const dayW = chartW / days;
  const X = (d: number) => (d - from) * dayW;
  const rowH = compact ? 48 : 62;
  const barH = compact ? 26 : 34;
  const subH = compact ? 32 : 36;

  const rows = topLevel(doc).filter((t) => !(doc.view.hideDone && t.status === "done"));
  let spawn = 0;

  const ticks = Array.from({ length: days }, (_, i) => {
    const d = from + i;
    const date = addDays(start, d);
    return { d, date, monday: date.getDay() === 1, weekend: date.getDay() === 0 || date.getDay() === 6 };
  });

  return (
    <div className="relative">
      <motion.div
        aria-hidden
        className="glass absolute inset-0"
        style={{ borderRadius: 36 }}
        initial={{ opacity: 0, scale: 0.985 }}
        animate={{ opacity: 1, scale: 1, transition: springs.soft }}
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
              {todayOff >= from && todayOff <= end && (
                <div className="absolute top-0 bottom-0 w-px bg-ink" style={{ left: X(todayOff) + dayW / 2 }}>
                  <span className="t-micro absolute top-[10px] left-1/2 z-10 -translate-x-1/2 rounded-full bg-ink px-2 py-[3px] whitespace-nowrap text-on-ink">
                    Today {fmtShort(new Date())}
                  </span>
                </div>
              )}
            </motion.div>

            {/* Header: weeks above, days below */}
            <div className="relative flex h-[56px] items-end pb-2.5">
              <div className="flex shrink-0 flex-col gap-1 pl-2" style={{ width: labelW }}>
                <span className="t-micro text-text-2">Task</span>
                <span className="t-micro text-text-3">Workflow order</span>
              </div>
              <div className="relative h-full" style={{ width: chartW }}>
                {ticks.map((t, i) =>
                  (t.monday || (i === 0 && !ticks.slice(1, 4).some((n) => n.monday))) &&
                  // The today tag owns its slot in the week row
                  !(todayOff >= from && todayOff <= end && Math.abs(X(t.d) - X(todayOff)) < 72) ? (
                    <span key={`w${t.d}`} className="t-micro absolute top-[14px] pl-1.5 whitespace-nowrap text-text-2" style={{ left: X(t.d) }}>
                      {fmtDay(t.date)}
                    </span>
                  ) : null,
                )}
                {dayW >= 22 &&
                  ticks.map((t) => (
                    <span
                      key={`d${t.d}`}
                      className={`t-data absolute bottom-0 text-center text-[11px] ${t.weekend ? "text-text-4" : "text-text-3"}`}
                      style={{ left: X(t.d), width: dayW }}
                    >
                      {String(t.date.getDate()).padStart(2, "0")}
                    </span>
                  ))}
              </div>
            </div>

            {/* Rows */}
            <div className="relative">
              {rows.map((t) => {
                const slot = sch.slots[t.id];
                const subs = subtasksOf(doc, t.id);
                const proposal = doc.proposal?.parentId === t.id ? doc.proposal : null;
                const spawnIndex = slot && spawn < 6 ? spawn++ : null;
                return (
                  <Fragment key={t.id}>
                    <Row height={rowH} labelW={labelW} label={<RowLabel task={t} number={taskNumber(doc, t.id)} compact={compact} />}>
                      {slot ? (
                        <Bar task={t} left={X(slot.start)} width={slot.days * dayW} top={(rowH - barH) / 2} height={barH} spawnIndex={spawnIndex} range={[addDays(start, slot.start), addDays(start, slot.start + slot.days - 1)]} />
                      ) : (
                        <div className="absolute flex items-center gap-2" style={{ left: X(sch.totalDays) + 8, top: (rowH - 26) / 2 }}>
                          <span className="t-data text-text-3">Needs a duration</span>
                          <span className="tone-light">
                            <EstimateControl task={t} />
                          </span>
                        </div>
                      )}
                    </Row>

                    {subs.map((s) => {
                      const ss = sch.slots[s.id];
                      return (
                        <Row key={s.id} height={subH} labelW={labelW} label={<SubLabel task={s} />} layoutId={`sub-${s.id}`}>
                          {ss && (
                            <motion.div
                              className="absolute rounded-full"
                              initial={{ opacity: 0, scaleX: 0.6 }}
                              animate={{ opacity: 1, scaleX: 1, backgroundColor: s.status === "done" ? "#0a0a0a" : "rgba(10,10,10,0.1)" }}
                              transition={springs.soft}
                              style={{ left: X(ss.start) + 1, width: Math.max(10, ss.days * dayW - 2), top: (subH - 12) / 2, height: 12, transformOrigin: "left center" }}
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
                          transition={springs.soft}
                          className="overflow-hidden"
                        >
                          {(() => {
                            let cur = slot?.start ?? 0;
                            return proposal.items.map((item, i) => {
                              const left = X(cur);
                              const w = (item.estimate ?? 0) * dayW;
                              cur += item.estimate ?? 0;
                              return (
                                <Row
                                  key={item.id}
                                  height={subH}
                                  labelW={labelW}
                                  layoutId={`sub-${item.id}`}
                                  label={
                                    <div className="flex min-w-0 items-center gap-2 pl-9 text-text-3">
                                      <StatusGlyph status="todo" size={12} />
                                      <span className="t-body-s truncate">{item.title}</span>
                                    </div>
                                  }
                                >
                                  {item.estimate != null && slot && (
                                    <motion.div
                                      className="absolute rounded-full border border-dashed border-text-3"
                                      initial={{ opacity: 0, x: -8 }}
                                      animate={{ opacity: 1, x: 0, transition: { delay: 0.1 + i * 0.06, ...springs.soft } }}
                                      style={{ left: left + 1, width: Math.max(10, w - 2), top: (subH - 14) / 2, height: 14 }}
                                    />
                                  )}
                                </Row>
                              );
                            });
                          })()}
                          <div className="flex items-center gap-1.5 py-2 pl-9">
                            <span className="t-micro mr-2 text-text-3">Proposed by FORM</span>
                            <button
                              type="button"
                              onClick={() => resolve(true)}
                              className="focus-ring t-body-s h-[32px] cursor-pointer rounded-full bg-ink px-4 text-on-ink transition-transform hover:scale-[1.02]"
                            >
                              Accept {proposal.items.length} steps
                            </button>
                            <button
                              type="button"
                              onClick={() => resolve(false)}
                              className="focus-ring t-body-s h-[32px] cursor-pointer rounded-full px-4 text-text-2 transition-colors hover:bg-black/[0.05] hover:text-text"
                            >
                              Discard
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
            {tool.startDateIsSample ? "Sample schedule" : "Schedule"} · derived from estimates in workflow order
            {sch.unscheduled.length > 0 && ` · ${sch.unscheduled.length} without duration`}
          </span>
          <div className="flex items-center gap-1">
            <span className="t-micro mr-1 text-text-3">Start</span>
            <ShiftButton label="Start one week earlier" onClick={() => commit([{ op: "setStartDate", date: toISODate(addDays(start, -7)) }], "start date")} d="M6.5 2.5L3.5 5l3 2.5" />
            <span className="t-data rounded-full bg-white/70 px-2.5 py-1.5 text-text">
              {start.getDate()} {start.toLocaleString("en-US", { month: "short" })} {start.getFullYear()}
              {tool.startDateIsSample && <span className="text-text-3"> · sample date</span>}
            </span>
            <ShiftButton label="Start one week later" onClick={() => commit([{ op: "setStartDate", date: toISODate(addDays(start, 7)) }], "start date")} d="M3.5 2.5L6.5 5l-3 2.5" />
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

function Row({ height, labelW, label, children, layoutId }: { height: number; labelW: number; label: React.ReactNode; children?: React.ReactNode; layoutId?: string }) {
  return (
    <motion.div layout="position" layoutId={layoutId} transition={springs.layout} className="relative flex border-b border-line last:border-b-0" style={{ height }}>
      <div className="flex min-w-0 shrink-0 items-center pr-3" style={{ width: labelW }}>
        {label}
      </div>
      <div className="relative flex-1">{children}</div>
    </motion.div>
  );
}

function RowLabel({ task, number, compact }: { task: Task; number: string; compact: boolean }) {
  const update = useForm((s) => s.updateTask);
  const { highlight } = useTaskSurface(task);
  return (
    <div className="tone-light flex min-w-0 flex-1 items-center gap-2">
      <NumberBadge task={task} number={number} inline />
      <StatusControl task={task} variant="bare" />
      {highlight && <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-signal" aria-label="Urgent" />}
      <EditableText
        value={task.title}
        label="Task title"
        layoutId={`title-${task.id}`}
        onCommit={(v) => update(task.id, { title: v })}
        className={`${compact ? "t-body" : task.emphasis ? "t-body-l" : "t-body"} min-w-0 truncate`}
      />
    </div>
  );
}

function SubLabel({ task }: { task: Task }) {
  const update = useForm((s) => s.updateTask);
  return (
    <div className="tone-light flex min-w-0 flex-1 items-center gap-2 pl-9">
      <button
        type="button"
        aria-label={task.status === "done" ? `Mark ${task.title} not done` : `Mark ${task.title} done`}
        onClick={() => update(task.id, { status: task.status === "done" ? "todo" : "done" })}
        className="focus-ring grid h-[20px] w-[20px] shrink-0 cursor-pointer place-items-center rounded-full"
      >
        <StatusGlyph status={task.status === "done" ? "done" : "todo"} size={12} />
      </button>
      <EditableText
        value={task.title}
        label="Step title"
        onCommit={(v) => update(task.id, { title: v })}
        className={`t-body-s min-w-0 truncate ${task.status === "done" ? "text-text-3 line-through" : "text-text-2"}`}
      />
      <span className="t-data ml-auto shrink-0 text-text-3">{fmtDays(task.estimate)}</span>
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
  range,
}: {
  task: Task;
  left: number;
  width: number;
  top: number;
  height: number;
  spawnIndex: number | null;
  range: [Date, Date];
}) {
  const { selected, dim, onClick, highlight } = useTaskSurface(task);
  const reveal = useReveal(spawnIndex);
  const w = Math.max(height, width - 2);
  const fill = task.status === "done" ? w : Math.max(height, (task.progress / 100) * w);
  const inside = fill > 58;

  return (
    <>
      <motion.button
        type="button"
        layoutId={`task-${task.id}`}
        data-task-id={task.id}
        data-spawn={spawnIndex ?? undefined}
        aria-label={`${task.title}: ${STATUS_LABEL[task.status]}, ${task.progress}%`}
        aria-pressed={selected}
        onClick={onClick}
        initial={reveal != null ? { opacity: 0 } : false}
        animate={{ opacity: reveal != null ? 1 : dim ? 0.5 : 1, backgroundColor: task.emphasis ? "rgba(10,10,10,0.2)" : "rgba(10,10,10,0.075)" }}
        transition={{ layout: springs.layout, opacity: reveal != null ? { delay: reveal, duration: 0 } : { duration: 0.3 } }}
        className={`focus-ring absolute cursor-pointer overflow-hidden ${selected ? "outline-[1.5px] outline-offset-[3px] outline-ink outline-solid" : ""}`}
        style={{ left: left + 1, width: w, top, height, borderRadius: height / 2 }}
      >
        <motion.span
          className="absolute inset-y-0 left-0 flex items-center justify-end bg-ink pr-3"
          style={{ borderRadius: height / 2 }}
          initial={{ width: height }}
          animate={{ width: fill, transition: { ...springs.soft, delay: reveal != null ? reveal : 0.12 } }}
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
          <span className="t-data absolute top-1/2 -translate-y-1/2 text-text-2" style={{ left: fill + 8 }}>
            {task.progress}%
          </span>
        )}
        {highlight && <span className="absolute top-1/2 right-2.5 h-[7px] w-[7px] -translate-y-1/2 rounded-full bg-signal" />}
      </motion.button>
      <motion.span
        className="t-data pointer-events-none absolute whitespace-nowrap text-text-3"
        style={{ left: left + w + 10, top: top + height / 2 - 6 }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { delay: 0.3 } }}
      >
        {fmtShort(range[0])}–{fmtShort(range[1])}
      </motion.span>
    </>
  );
}
