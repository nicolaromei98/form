"use client";

import { AnimatePresence, motion } from "motion/react";
import { useMemo, type Ref } from "react";
import { useForm } from "@/lib/store";
import { move } from "@/lib/motion";
import { taskNumber, tasksByStatus } from "@/lib/selectors";
import { STATUS_LABEL, STATUS_ORDER, type Status, type Task } from "@/lib/schema";
import { CostTag, EditableText, EstimateControl, NumberBadge, PriorityControl, ProgressControl, ProposalBlock, StatusGlyph, SubtaskList } from "./parts";
import { Clip, InkSkin, Reveal, useTaskSurface } from "./TaskCard";
import { useReveal } from "./reveal";
import { ShuffleText } from "../text/ShuffleText";

/** Representation: board — the same tasks, grouped into status lanes. */
export function BoardView() {
  const doc = useForm((s) => s.doc);
  const lanes = useMemo(() => tasksByStatus(doc), [doc]);
  const hideDone = doc.view.hideDone;
  const statuses = hideDone ? STATUS_ORDER.filter((s) => s !== "done") : STATUS_ORDER;
  let spawn = 0;

  return (
    <div className="no-scrollbar -mx-4 overflow-x-auto px-4 pb-2 md:mx-0 md:overflow-visible md:px-0">
      <div className="grid min-w-[880px] gap-3 md:min-w-0" style={{ gridTemplateColumns: `repeat(${statuses.length}, minmax(0, 1fr))` }}>
        {statuses.map((status, ci) => (
          <Lane key={status} status={status} index={ci} count={lanes[status].length}>
            <AnimatePresence mode="popLayout">
              {lanes[status].map((t) => (
                <BoardCard key={t.id} task={t} number={taskNumber(doc, t.id)} spawnIndex={spawn < 6 ? spawn++ : null} />
              ))}
            </AnimatePresence>
          </Lane>
        ))}
      </div>
    </div>
  );
}

function Lane({ status, index, count, children }: { status: Status; index: number; count: number; children: React.ReactNode }) {
  return (
    <section className="relative flex min-h-[340px] flex-col p-2.5">
      {/* Lane surface reveals on its own so it never clips morphing cards */}
      <motion.div
        aria-hidden
        className="glass absolute inset-0"
        style={{ borderRadius: 32 }}
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1, transition: { delay: 0.05 + index * 0.04, ...move } }}
      />
      <motion.header
        className="relative flex items-center justify-between px-2.5 pt-1.5 pb-3"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { delay: 0.15 + index * 0.04 } }}
      >
        <span className="tone-light flex items-center gap-2">
          <StatusGlyph status={status} size={13} />
          <span className="t-meta">{STATUS_LABEL[status]}</span>
        </span>
        <span className="t-micro grid h-[22px] min-w-[22px] place-items-center rounded-full bg-ink px-1.5 text-on-ink tabular-nums">{count}</span>
      </motion.header>
      <div className="relative flex flex-1 flex-col gap-2">
        {children}
        {count === 0 && (
          <motion.div
            className="t-body-s grid flex-1 place-items-center rounded-[22px] border border-dashed border-line py-8 text-text-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { delay: 0.25 } }}
          >
            Nothing here
          </motion.div>
        )}
      </div>
    </section>
  );
}

function BoardCard({ task, number, spawnIndex, ref }: { task: Task; number: string; spawnIndex: number | null; ref?: Ref<HTMLElement> }) {
  const { selected, view, dim, onClick, highlight } = useTaskSurface(task);
  const update = useForm((s) => s.updateTask);
  const reveal = useReveal(spawnIndex);
  const f = view.fields;
  const compact = view.density === "compact";
  const i = STATUS_ORDER.indexOf(task.status);

  return (
    <motion.article
      ref={ref}
      layout
      layoutId={`task-${task.id}`}
      data-task-id={task.id}
      data-spawn={spawnIndex ?? undefined}
      onClick={onClick}
      initial={reveal != null ? { opacity: 0 } : false}
      animate={{ backgroundColor: task.emphasis ? "#0c0c0c" : "rgba(255,255,255,0.72)", opacity: reveal != null ? 1 : dim ? 0.55 : 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.2 } }}
      transition={{ layout: move, opacity: reveal != null ? { delay: reveal, duration: 0 } : { duration: 0.3 }, backgroundColor: { duration: 0.35 } }}
      className={`${task.emphasis ? "tone-dark" : "tone-light"} group relative cursor-pointer ${
        selected ? "outline-[1.5px] outline-offset-[3px] outline-ink outline-solid" : ""
      }`}
      style={{ borderRadius: 22, boxShadow: "0 1px 0 rgba(255,255,255,0.9) inset, 0 10px 24px -18px rgba(0,0,0,0.3)" }}
    >
      <InkSkin reveal={reveal} />
      <NumberBadge task={task} number={number} />
      <Clip scope="board" className={compact ? "p-3" : "p-3.5"}>
        <Reveal reveal={reveal} className="flex items-start gap-2 pr-4">
          {highlight && <span className="mt-[6px] h-[7px] w-[7px] shrink-0 rounded-full bg-signal" aria-label="Urgent" />}
          <EditableText
            value={task.title}
            label="Task title"
            onCommit={(v) => update(task.id, { title: v })}
            className={compact ? "t-body" : "t-body-l"}
          />
        </Reveal>
        <Reveal reveal={reveal} className={`flex flex-col gap-1.5 ${compact ? "mt-2" : "mt-5"}`}>
          {(f.priority || f.estimate) && (
            <div className="flex items-center justify-between">
              {f.priority ? <PriorityControl task={task} /> : <span />}
              <div className="flex items-center gap-1">
                <CostTag task={task} />
                {f.estimate && <EstimateControl task={task} />}
              </div>
            </div>
          )}
          {f.progress && <ProgressControl task={task} size="s" />}
          <div className="flex items-center justify-between">
            <LaneButton dir={-1} disabled={i === 0} onClick={() => update(task.id, { status: STATUS_ORDER[i - 1] })} label={i > 0 ? STATUS_LABEL[STATUS_ORDER[i - 1]] : ""} />
            <LaneButton dir={1} disabled={i === STATUS_ORDER.length - 1} onClick={() => update(task.id, { status: STATUS_ORDER[i + 1] })} label={i < 3 ? STATUS_LABEL[STATUS_ORDER[i + 1]] : ""} />
          </div>
        </Reveal>
        <SubtaskList parentId={task.id} />
        <ProposalBlock parentId={task.id} />
      </Clip>
    </motion.article>
  );
}

function LaneButton({ dir, disabled, onClick, label }: { dir: 1 | -1; disabled: boolean; onClick: () => void; label: string }) {
  if (disabled) return <span />;
  return (
    <button
      type="button"
      data-interactive
      aria-label={`Move to ${label}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`focus-ring t-data flex h-[24px] cursor-pointer items-center gap-1 rounded-full px-2 text-[var(--c-fg-3)] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--c-hover)] hover:text-[var(--c-fg)] focus-visible:opacity-100 ${
        dir > 0 ? "flex-row-reverse" : ""
      }`}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden style={{ transform: dir > 0 ? "none" : "scaleX(-1)" }}>
        <path d="M2 5h6M5.5 2.5L8 5 5.5 7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <ShuffleText text={label} />
    </button>
  );
}
