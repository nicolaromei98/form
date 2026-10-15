"use client";

import { AnimatePresence, LayoutGroup, motion, useIsPresent } from "motion/react";
import { type MouseEvent, type ReactNode, type Ref, useState } from "react";
import type { TaskId } from "@/lib/domain/schema/ids";
import type { Task } from "@/lib/domain/schema/project";
import { CREATE, ease, move } from "@/lib/motion";
import { useActions, useIsSelected, useSteps, useSubtaskProposal, useTask, useTaskNumber, useViewConfig } from "@/lib/store/hooks";
import {
  asTaskId,
  CostTag,
  EditableText,
  EstimateControl,
  NumberBadge,
  PriorityControl,
  ProgressControl,
  ProposalBlock,
  StatusControl,
  SubtaskList,
  type TaskFields,
} from "./parts";
import { useReveal } from "./reveal";

const GLASS = "rgba(255,255,255,0.52)";
/** A dimmed card (Q14): the surface recedes to 55% of the glass, its text never does */
const GLASS_DIM = "rgba(255,255,255,0.29)";
const INK = "#0c0c0c";

interface Props {
  id: TaskId;
  spawnIndex: number | null;
  variant: "card" | "row";
  /** Columns in the current grid, so emphasis never creates implicit tracks */
  cols: number;
  ref?: Ref<HTMLElement>;
}

/** Shared behaviour for every task surface: selection, emphasis, highlight, creation skin. */
export function useTaskSurface(task: TaskFields<"priority" | "status" | "emphasis">) {
  const taskId = asTaskId(task.id);
  const selected = useIsSelected(taskId);
  const { select } = useActions();
  const view = useViewConfig();
  const hasProposal = useSubtaskProposal(taskId) !== null;
  const highlightUrgent = view?.highlightUrgent ?? false;
  const urgent = task.priority === "urgent" && task.status !== "done";
  // Highlighting urgent work recedes the rest — except what the user is focused on
  const dim = highlightUrgent && !urgent && !task.emphasis && !selected;
  const onClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-interactive]")) return;
    e.stopPropagation();
    select(selected ? null : taskId);
  };
  return { selected, view, hasProposal, urgent, dim, onClick, highlight: highlightUrgent && urgent };
}

/**
 * A task surface's task and workflow number. While the surface is in the view they are the
 * store's. Once it leaves (its task removed, or a board card moving to another lane), it keeps
 * what it last showed through its exit animation, as the v0 surfaces kept the props they were
 * given; the rest of what it reads (selection, the view) stays live, as it did in v0.
 */
export function useSurfaceTask(id: TaskId): { task: Task | null; number: string } {
  const present = useIsPresent();
  const task = useTask(id);
  const number = useTaskNumber(id);
  const [shown, setShown] = useState({ task, number });
  const live = present && task !== null;
  if (live && (shown.task !== task || shown.number !== number)) setShown({ task, number });
  return live ? { task, number } : shown;
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
      transition={reveal != null ? { delay: reveal + 0.16, duration: 0.9, ease: ease.out } : move}
    >
      {children}
    </motion.div>
  );
}

/**
 * Content window of a morphing surface. During shared-layout morphs the surface
 * is scaled and its content scale-corrected; this clips that content to the
 * surface's live shape, so nothing spills out or stretches while it settles.
 * Content stays anchored to the window. When the layout changes (card ↔ row) the
 * old window steps out of flow and dissolves in place over the new one, which
 * condenses in — the same blur + opacity as every text in FORM.
 * Steps travel only within one kind of surface (proposal → accepted): across
 * card, row and board they'd cut through the new layout, so each kind is its own scope.
 */
export function Clip({ scope, className = "", children }: { scope: "card" | "row" | "board"; className?: string; children: ReactNode }) {
  const present = useIsPresent();
  return (
    <motion.div
      aria-hidden={present ? undefined : true}
      className={`overflow-hidden rounded-[inherit] ${present ? "" : "pointer-events-none absolute inset-0"} ${className}`}
      initial={{ opacity: 0, filter: "blur(8px)" }}
      animate={{ opacity: 1, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
      exit={{ opacity: 0, filter: "blur(8px)", transition: { duration: 0.3, ease: ease.out } }}
      transition={{ duration: 0.55, ease: ease.out, delay: 0.08 }}
    >
      <LayoutGroup id={scope}>{children}</LayoutGroup>
    </motion.div>
  );
}

/** A tracker card or row: the task's id in, the store's task out (kept through its exit) */
export function TaskCard({ id, ...rest }: Props) {
  const { task, number } = useSurfaceTask(id);
  return task === null ? null : <TaskSurface task={task} number={number} {...rest} />;
}

function TaskSurface({ task, number, spawnIndex, variant, cols, ref }: Omit<Props, "id"> & { task: Task; number: string }) {
  const { selected, view, hasProposal, dim, onClick, highlight } = useTaskSurface(task);
  const hasSubs = useSteps(task.id).length > 0;
  const reveal = useReveal(spawnIndex);
  const { commit } = useActions();
  if (view === null) return null;
  const rename = (v: string) => commit([{ op: "updateTask", taskId: task.id, field: "title", value: v }], { label: "rename task" });
  const emphasis = task.emphasis;
  const f = view.fields;

  // Dimming lightens the surface, its frame and its shadow; the content keeps full contrast
  const surface = { backgroundColor: emphasis ? INK : dim ? GLASS_DIM : GLASS };
  const shadow = dim ? "var(--shadow-card-dim)" : "var(--shadow-card)";

  const row = variant === "row";
  const tall = hasSubs || hasProposal;

  // One surface for both densities: it morphs between card and row while its content cross-dissolves
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
      animate={{ ...surface, opacity: 1 }}
      transition={{ layout: move, opacity: reveal != null ? { delay: reveal, duration: 0 } : { duration: 0.3 }, backgroundColor: { duration: 0.35 } }}
      className={`${emphasis ? "tone-dark" : "tone-light"} relative cursor-pointer backdrop-blur-[22px] ${row ? "" : "flex flex-col"} ${
        selected ? "outline-[1.5px] outline-offset-[3px] outline-ink outline-solid" : ""
      }`}
      style={
        row
          ? {
              borderRadius: tall ? 28 : 31,
              boxShadow: emphasis ? "0 24px 48px -26px rgba(0,0,0,0.55)" : shadow,
              gridColumn: emphasis && cols > 1 ? "1 / -1" : undefined,
            }
          : {
              borderRadius: 28,
              minHeight: 272,
              boxShadow: emphasis ? "0 30px 60px -30px rgba(0,0,0,0.6)" : shadow,
              gridColumn: emphasis && cols > 1 ? `span ${Math.min(2, cols)}` : undefined,
            }
      }
    >
      <InkSkin key="skin" reveal={reveal} />
      <AnimatePresence key="badge">{!row && <NumberBadge key="corner" task={task} number={number} />}</AnimatePresence>
      <AnimatePresence key="content">
        {row ? (
          <Clip key="row" scope="row" className="p-2">
            <Reveal reveal={reveal} className="flex h-[46px] items-center gap-3">
              <StatusControl task={task} variant="glyph" />
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {highlight && <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-signal" aria-label="Urgent" />}
                <EditableText
                  value={task.title}
                  label="Task title"
                  onCommit={rename}
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
          </Clip>
        ) : (
          <Clip key="card" scope="card" className="flex flex-1 flex-col p-[18px]">
            <Reveal reveal={reveal} className="flex items-center justify-between gap-2 pr-4">
              <StatusControl task={task} />
              {highlight && (
                <span className="t-micro flex items-center gap-1.5 text-signal-text">
                  <span className="h-[6px] w-[6px] rounded-full bg-signal" />
                  Urgent
                </span>
              )}
            </Reveal>

            <Reveal reveal={reveal} className="mt-7">
              <EditableText
                value={task.title}
                label="Task title"
                onCommit={rename}
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
              {(f.priority || task.costCents !== null) && (
                <div className="flex items-center justify-between gap-2">
                  {f.priority ? <PriorityControl task={task} label /> : <span />}
                  <CostTag task={task} />
                </div>
              )}
            </Reveal>

            <SubtaskList parentId={task.id} />
            <ProposalBlock parentId={task.id} />
          </Clip>
        )}
      </AnimatePresence>
    </motion.article>
  );
}
