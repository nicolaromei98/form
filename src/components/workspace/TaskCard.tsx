"use client";

import { motion } from "motion/react";
import type { MouseEvent, ReactNode, Ref } from "react";
import { useForm } from "@/lib/store";
import { CREATE, ease, springs } from "@/lib/motion";
import type { Task } from "@/lib/schema";
import { CostTag, EditableText, EstimateControl, NumberBadge, PriorityControl, ProgressControl, ProposalBlock, StatusControl, SubtaskList } from "./parts";
import { useReveal } from "./reveal";

const GLASS = "rgba(255,255,255,0.52)";
const INK = "#0c0c0c";

interface Props {
  task: Task;
  number: string;
  spawnIndex: number | null;
  variant: "card" | "row";
  /** Columns in the current grid, so emphasis never creates implicit tracks */
  cols: number;
  ref?: Ref<HTMLElement>;
}

/** Shared behaviour for every task surface: selection, emphasis, highlight, creation skin. */
export function useTaskSurface(task: Task) {
  const selected = useForm((s) => s.selectedId === task.id);
  const select = useForm((s) => s.select);
  const view = useForm((s) => s.doc.view);
  const hasProposal = useForm((s) => s.doc.proposal?.parentId === task.id);
  const urgent = task.priority === "urgent" && task.status !== "done";
  // Highlighting urgent work recedes the rest — except what the user is focused on
  const dim = view.highlightUrgent && !urgent && !task.emphasis && !selected;
  const onClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-interactive]")) return;
    e.stopPropagation();
    select(selected ? null : task.id);
  };
  return { selected, view, hasProposal, urgent, dim, onClick, highlight: view.highlightUrgent && urgent };
}

export function InkSkin({ reveal }: { reveal: number | null }) {
  if (reveal == null) return null;
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-20 bg-ink"
      style={{ borderRadius: "inherit" }}
      initial={{ opacity: 1 }}
      animate={{ opacity: 0 }}
      transition={{ delay: reveal, duration: CREATE.skin, ease: ease.inOut }}
    />
  );
}

export function Reveal({ reveal, children, className = "" }: { reveal: number | null; children: ReactNode; className?: string }) {
  return (
    <motion.div
      layout="position"
      className={className}
      initial={reveal != null ? { opacity: 0, filter: "blur(12px)", scale: 1.03 } : false}
      animate={{ opacity: 1, filter: "blur(0px)", scale: 1 }}
      transition={reveal != null ? { delay: reveal + 0.16, duration: 0.9, ease: ease.out } : springs.layout}
    >
      {children}
    </motion.div>
  );
}

export function TaskCard({ task, number, spawnIndex, variant, cols, ref }: Props) {
  const { selected, view, hasProposal, dim, onClick, highlight } = useTaskSurface(task);
  const hasSubs = useForm((s) => Object.values(s.doc.tasks).some((t) => t.parentId === task.id));
  const reveal = useReveal(spawnIndex);
  const emphasis = task.emphasis;
  const f = view.fields;

  const surface = {
    backgroundColor: emphasis ? INK : GLASS,
    opacity: dim ? 0.55 : 1,
  };

  if (variant === "row") {
    const tall = hasSubs || hasProposal;
    return (
      <motion.article
        layout
        ref={ref}
        layoutId={`task-${task.id}`}
        exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.2 } }}
        data-task-id={task.id}
        data-spawn={spawnIndex ?? undefined}
        onClick={onClick}
        initial={reveal != null ? { opacity: 0 } : false}
        animate={{ ...surface, opacity: reveal != null ? 1 : surface.opacity }}
        transition={{ layout: springs.layout, opacity: reveal != null ? { delay: reveal, duration: 0 } : { duration: 0.3 }, backgroundColor: { duration: 0.35 } }}
        className={`${emphasis ? "tone-dark" : "tone-light"} relative cursor-pointer p-2 backdrop-blur-[22px] ${selected ? "outline-[1.5px] outline-offset-[3px] outline-ink outline-solid" : ""}`}
        style={{
          borderRadius: tall ? 28 : 31,
          boxShadow: emphasis ? "0 24px 48px -26px rgba(0,0,0,0.55)" : "var(--shadow-card)",
          gridColumn: emphasis && cols > 1 ? "1 / -1" : undefined,
        }}
      >
        <InkSkin reveal={reveal} />
        <Reveal reveal={reveal} className="flex h-[46px] items-center gap-3">
          <StatusControl task={task} variant="glyph" />
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {highlight && <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-signal" aria-label="Urgent" />}
            <EditableText
              value={task.title}
              label="Task title"
              layoutId={`title-${task.id}`}
              onCommit={(v) => useForm.getState().updateTask(task.id, { title: v })}
              className="t-body min-w-0 truncate"
            />
          </div>
          {f.priority && (
            <div className="hidden sm:block">
              <PriorityControl task={task} />
            </div>
          )}
          {f.estimate && (
            <div className="hidden lg:block">
              <EstimateControl task={task} />
            </div>
          )}
          <CostTag task={task} />
          {f.progress && <ProgressControl task={task} size="s" className="hidden w-[96px] sm:flex" />}
          <NumberBadge task={task} number={number} inline />
        </Reveal>
        {tall && (
          <div className="px-1">
            <SubtaskList parentId={task.id} dense />
            <ProposalBlock parentId={task.id} dense />
          </div>
        )}
      </motion.article>
    );
  }

  return (
    <motion.article
      layout
      ref={ref}
      layoutId={`task-${task.id}`}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.2 } }}
      data-task-id={task.id}
      data-spawn={spawnIndex ?? undefined}
      onClick={onClick}
      initial={reveal != null ? { opacity: 0 } : false}
      animate={{ ...surface, opacity: reveal != null ? 1 : surface.opacity }}
      transition={{ layout: springs.layout, opacity: reveal != null ? { delay: reveal, duration: 0 } : { duration: 0.3 }, backgroundColor: { duration: 0.35 } }}
      className={`${emphasis ? "tone-dark" : "tone-light"} relative flex cursor-pointer flex-col p-[18px] backdrop-blur-[22px] ${
        selected ? "outline-[1.5px] outline-offset-[3px] outline-ink outline-solid" : ""
      }`}
      style={{
        borderRadius: 28,
        minHeight: 272,
        boxShadow: emphasis ? "0 30px 60px -30px rgba(0,0,0,0.6)" : "var(--shadow-card)",
        gridColumn: emphasis && cols > 1 ? `span ${Math.min(2, cols)}` : undefined,
      }}
    >
      <InkSkin reveal={reveal} />
      <NumberBadge task={task} number={number} />

      <Reveal reveal={reveal} className="flex items-center justify-between gap-2 pr-4">
        <StatusControl task={task} />
        {highlight && (
          <span className="t-micro flex items-center gap-1.5 text-signal">
            <span className="h-[6px] w-[6px] rounded-full bg-signal" />
            Urgent
          </span>
        )}
      </Reveal>

      <Reveal reveal={reveal} className="mt-7">
        <EditableText
          value={task.title}
          label="Task title"
          layoutId={`title-${task.id}`}
          onCommit={(v) => useForm.getState().updateTask(task.id, { title: v })}
          className={emphasis ? "t-display-m" : "t-title"}
        />
      </Reveal>

      <div className="min-h-6 flex-1" />

      <Reveal reveal={reveal} className="flex flex-col gap-3">
        {(f.progress || f.estimate) && (
          <div className="flex items-end justify-between gap-2">
            {f.progress ? (
              <span className="t-num text-[44px] leading-[0.8] text-[var(--c-fg)]" aria-hidden>
                {task.progress}
                <span className="ml-0.5 align-top text-[18px] leading-none text-[var(--c-fg-2)]">%</span>
              </span>
            ) : (
              <span />
            )}
            {f.estimate && <EstimateControl task={task} />}
          </div>
        )}
        {f.progress && <ProgressControl task={task} showLabel={false} />}
        {(f.priority || task.cost != null) && (
          <div className="flex items-center justify-between gap-2">
            {f.priority ? <PriorityControl task={task} label /> : <span />}
            <CostTag task={task} />
          </div>
        )}
      </Reveal>

      <SubtaskList parentId={task.id} />
      <ProposalBlock parentId={task.id} />
    </motion.article>
  );
}
