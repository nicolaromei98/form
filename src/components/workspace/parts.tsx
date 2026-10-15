"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as RPointerEvent,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { PRIORITY_LABEL, PRIORITY_ORDER, STATUS_LABEL, STATUS_ORDER } from "@/lib/domain/labels";
import { ESTIMATE_MAX_DAYS } from "@/lib/domain/limits";
import { formatMoney } from "@/lib/domain/money";
import type { TaskId } from "@/lib/domain/schema/ids";
import type { Status } from "@/lib/domain/schema/primitives";
import type { Task } from "@/lib/domain/schema/project";
import { ease, springs, move } from "@/lib/motion";
import { fmtDays } from "@/lib/planning/format";
import { useActions, useIsSelected, useProject, useSteps, useSubtaskProposal, useViewConfig } from "@/lib/store/hooks";
import { ShuffleText } from "../text/ShuffleText";

/* ------------------------------------------------------------------
   The task a control reads
   ------------------------------------------------------------------ */

/**
 * The fields a task control reads from its task. Every surface on the store passes a `Task`.
 * Until the step 18 integration, the views still on the v0 store (Timeline, Team, Focus) hand
 * these controls their own task objects, so the id is a plain string here and only the fields
 * both shapes share are required. Integration narrows the id to `TaskId` and drops `asTaskId`.
 */
export type TaskFields<K extends keyof Task = never> = Readonly<Pick<Task, K>> & { readonly id: string };

/** A task id as the store knows it (see TaskFields) */
export const asTaskId = (id: string): TaskId => id as TaskId;

/* ------------------------------------------------------------------
   Status
   ------------------------------------------------------------------ */

export function StatusGlyph({ status, size = 15 }: { status: Status; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0">
      {status === "done" ? (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path d="M5 8.3l2 2 4-4.4" stroke="var(--c-on-fill, #fff)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <circle cx="8" cy="8" r="6.3" stroke="currentColor" strokeWidth="1.3" />
          {status === "active" && <path d="M8 1.7A6.3 6.3 0 0 1 8 14.3Z" fill="currentColor" />}
          {status === "review" && <path d="M8 8V1.7A6.3 6.3 0 1 1 1.7 8Z" fill="currentColor" />}
        </>
      )}
    </svg>
  );
}

/** Popover state: position is measured in the event handler, not during render. */
export function usePopover<T extends HTMLElement>() {
  const [anchor, setAnchor] = useState<T | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const close = useCallback(() => setPos(null), []);
  const toggle = useCallback(() => {
    setPos((cur) => {
      if (cur || !anchor) return null;
      const r = anchor.getBoundingClientRect();
      return { x: Math.min(r.left, window.innerWidth - 200), y: r.bottom + 8 };
    });
  }, [anchor]);
  return { setAnchor, anchor, pos, open: pos != null, toggle, close };
}

/** Popover rendered in a portal so it never gets clipped or stacked under sibling cards. */
export function Popover({
  anchor,
  pos,
  onClose,
  children,
}: {
  anchor: HTMLElement | null;
  pos: { x: number; y: number } | null;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const open = pos != null;

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node) || anchor?.contains(e.target as Node)) return;
      onClose();
    };
    const key = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [open, anchor, onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {pos && (
        <motion.div
          ref={ref}
          className="tone-light glass-hi fixed z-[70] rounded-[22px] p-1.5"
          style={{ left: pos.x, top: pos.y, transformOrigin: "top left" }}
          initial={{ opacity: 0, scale: 0.94, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.1 } }}
          transition={move}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function StatusControl({ task, variant = "chip" }: { task: TaskFields<"status">; variant?: "chip" | "glyph" | "bare" }) {
  const { commit } = useActions();
  const { setAnchor: statusPopAnchor, anchor: statusPopEl, pos: statusPopPos, open: statusPopOpen, toggle: statusPopToggle, close: statusPopClose } = usePopover<HTMLButtonElement>();

  const cls =
    variant === "chip"
      ? "h-[30px] gap-1.5 rounded-full bg-[var(--c-chip)] pr-3 pl-2 hover:bg-[var(--c-chip-hover)]"
      : variant === "glyph"
        ? "h-[44px] w-[44px] justify-center rounded-full bg-[var(--c-chip)] hover:bg-[var(--c-chip-hover)]"
        : "h-[26px] w-[26px] justify-center rounded-full hover:bg-[var(--c-hover)]";

  return (
    <>
      <button
        ref={statusPopAnchor}
        type="button"
        data-interactive
        aria-haspopup="menu"
        aria-expanded={statusPopOpen}
        aria-label={`Status: ${STATUS_LABEL[task.status]}. Change status`}
        onClick={(e) => {
          e.stopPropagation();
          statusPopToggle();
        }}
        className={`focus-ring flex shrink-0 cursor-pointer items-center text-[var(--c-fg)] transition-colors ${cls}`}
      >
        <motion.span layout="position" className="flex">
          <StatusGlyph status={task.status} />
        </motion.span>
        {variant === "chip" && <ShuffleText text={STATUS_LABEL[task.status]} className="t-body-s whitespace-nowrap" />}
      </button>
      <Popover anchor={statusPopEl} pos={statusPopPos} onClose={statusPopClose}>
        <div role="menu" className="flex w-[176px] flex-col">
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              role="menuitemradio"
              aria-checked={task.status === s}
              type="button"
              onClick={() => {
                // The §5.7 table moves progress with the status
                if (s !== task.status) commit([{ op: "updateTask", taskId: asTaskId(task.id), field: "status", value: s }], { label: "status" });
                statusPopClose();
              }}
              className={`focus-ring t-body-s flex h-9 cursor-pointer items-center gap-2.5 rounded-full px-3 text-left transition-colors ${
                task.status === s ? "bg-ink text-on-ink" : "text-text hover:bg-black/[0.05]"
              }`}
              style={task.status === s ? ({ "--c-on-fill": "var(--ink)" } as React.CSSProperties) : undefined}
            >
              <StatusGlyph status={s} />
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}

/* ------------------------------------------------------------------
   Priority — four volumes, the fourth turns signal-red when urgent
   ------------------------------------------------------------------ */

export function PriorityControl({ task, label = false }: { task: TaskFields<"priority">; label?: boolean }) {
  const { commit } = useActions();
  const level = PRIORITY_ORDER.indexOf(task.priority);
  return (
    <div className="flex items-center gap-2" role="group" aria-label={`Priority: ${PRIORITY_LABEL[task.priority]}`}>
      <div className="flex items-center">
        {PRIORITY_ORDER.map((p, i) => (
          <button
            key={p}
            type="button"
            data-interactive
            aria-label={`Set priority to ${PRIORITY_LABEL[p]}`}
            aria-pressed={task.priority === p}
            onClick={(e) => {
              e.stopPropagation();
              if (p !== task.priority) commit([{ op: "updateTask", taskId: asTaskId(task.id), field: "priority", value: p }], { label: "priority" });
            }}
            className="focus-ring group grid h-[18px] w-[13px] cursor-pointer place-items-center rounded-full"
          >
            <motion.span
              className="block rounded-full"
              initial={false}
              animate={{
                width: 7,
                height: 7,
                backgroundColor: i <= level ? (task.priority === "urgent" && i === 3 ? "var(--signal)" : "var(--c-fill)") : "rgba(0,0,0,0)",
                boxShadow: i <= level ? "inset 0 0 0 0px var(--c-dot-off)" : "inset 0 0 0 1.1px var(--c-dot-off)",
              }}
              transition={{ duration: 0.2 }}
            />
          </button>
        ))}
      </div>
      {label && <span className="t-data text-[var(--c-fg-3)]">{PRIORITY_LABEL[task.priority]}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------
   Progress — capsule track, draggable, keyboard accessible
   ------------------------------------------------------------------ */

export function ProgressControl({
  task,
  size = "m",
  className = "",
  showLabel = true,
}: {
  task: TaskFields<"title" | "progress">;
  size?: "m" | "s";
  className?: string;
  showLabel?: boolean;
}) {
  const { commit, beginGesture, live, endGesture } = useActions();
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const h = size === "m" ? 6 : 4;
  const taskId = asTaskId(task.id);

  // A drag is one gesture: each frame is recomputed from where it began, and the release seals one change
  const fromEvent = (e: RPointerEvent) => {
    const r = track.current!.getBoundingClientRect();
    const pct = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * 20) * 5;
    if (pct !== task.progress) live([{ op: "updateTask", taskId, field: "progress", value: pct }]);
  };
  const release = () => {
    if (!dragging.current) return;
    dragging.current = false;
    endGesture();
  };

  const set = (value: number) => {
    if (value !== task.progress) commit([{ op: "updateTask", taskId, field: "progress", value }], { label: "progress" });
  };

  const onKey = (e: KeyboardEvent) => {
    const step = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5 }[e.key];
    if (step) {
      e.preventDefault();
      set(Math.max(0, Math.min(100, task.progress + step)));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      set(e.key === "Home" ? 0 : 100);
    }
  };

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        data-interactive
        aria-label={`${task.title} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={task.progress}
        onKeyDown={onKey}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.current = true;
          beginGesture();
          fromEvent(e);
        }}
        onPointerMove={(e) => dragging.current && fromEvent(e)}
        onPointerUp={release}
        onPointerCancel={release}
        className="focus-ring group relative flex-1 cursor-ew-resize touch-none rounded-full py-2"
      >
        <div className="relative w-full rounded-full bg-[var(--c-track)]" style={{ height: h }}>
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full bg-[var(--c-fill)]"
            initial={false}
            animate={{ width: `${task.progress}%` }}
            transition={springs.snappy}
          />
          <motion.div
            className="absolute top-1/2 h-[12px] w-[12px] -translate-x-1/2 -translate-y-1/2 scale-0 rounded-full bg-[var(--c-fill)] opacity-0 transition-[opacity,transform] duration-200 group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100"
            initial={false}
            animate={{ left: `${task.progress}%` }}
            transition={springs.snappy}
          />
        </div>
      </div>
      {showLabel && <span className="t-data w-[32px] shrink-0 text-right text-[var(--c-fg-2)]">{task.progress}%</span>}
    </div>
  );
}

/* ------------------------------------------------------------------
   Estimate
   ------------------------------------------------------------------ */

/**
 * The duration stepper. A task with no estimate shows "+ Duration", which opens the stepper empty
 * ("—"): nothing is written until the first "+", which sets half a day, and "−" closes it again
 * (Q3: FORM never invents a duration).
 */
export function EstimateControl({
  task,
}: {
  // Optional only until the step 18 integration: the v0 tasks the Timeline still passes name it `estimate`
  task: TaskFields & { readonly estimateDays?: Task["estimateDays"] };
}) {
  const { commit } = useActions();
  const [open, setOpen] = useState(false);
  const days = task.estimateDays ?? null;
  // Once there is an estimate the empty stepper has done its job: clearing it later shows "+ Duration" again
  if (open && days !== null) setOpen(false);

  // Opening or closing the empty stepper from the keyboard moves focus to what replaced the button
  const handoff = useRef(false);
  const add = useRef<HTMLButtonElement>(null);
  const longer = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!handoff.current) return;
    handoff.current = false;
    (open ? longer : add).current?.focus();
  }, [open]);
  const toggle = (next: boolean, keyboard: boolean) => {
    handoff.current = keyboard;
    setOpen(next);
  };

  const set = (value: number) => commit([{ op: "updateTask", taskId: asTaskId(task.id), field: "estimateDays", value }], { label: "duration" });

  if (days === null && !open) {
    return (
      <button
        ref={add}
        type="button"
        data-interactive
        onClick={(e) => {
          e.stopPropagation();
          // A click from the keyboard has no pointer detail
          toggle(true, e.detail === 0);
        }}
        className="focus-ring t-data cursor-pointer rounded-full border border-dashed border-[var(--c-line)] px-2.5 py-1 text-[var(--c-fg-3)] transition-colors hover:text-[var(--c-fg)]"
      >
        <ShuffleText text="+ Duration" />
      </button>
    );
  }
  const step = (d: number, keyboard: boolean) => {
    if (days === null) {
      if (d > 0) set(0.5);
      else toggle(false, keyboard);
      return;
    }
    const inc = days < 2 || (days === 2 && d < 0) ? 0.5 : 1;
    const next = Math.max(0.5, Math.min(ESTIMATE_MAX_DAYS, days + d * inc));
    if (next !== days) set(next);
  };
  return (
    <div className="group flex items-center" data-interactive onClick={(e) => e.stopPropagation()}>
      <StepButton label="Shorter" onClick={(e) => step(-1, e.detail === 0)}>
        <path d="M3 6h6" />
      </StepButton>
      <span className="t-data min-w-[28px] text-center text-[var(--c-fg-2)]">{fmtDays(days)}</span>
      <StepButton ref={longer} label="Longer" onClick={(e) => step(1, e.detail === 0)}>
        <path d="M3 6h6M6 3v6" />
      </StepButton>
    </div>
  );
}

function StepButton({
  label,
  onClick,
  children,
  ref,
}: {
  label: string;
  onClick: (e: ReactMouseEvent) => void;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      onClick={onClick}
      className="focus-ring grid h-[20px] w-[20px] cursor-pointer place-items-center rounded-full text-[var(--c-fg-3)] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--c-hover)] hover:text-[var(--c-fg)] focus-visible:opacity-100"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

export function CostTag({ task }: { task: TaskFields<"costCents"> }) {
  if (task.costCents === null) return null;
  return <CostFigure cents={task.costCents} />;
}

/** A manual cost in the project's currency; its own component, so only tasks with a cost read the project */
function CostFigure({ cents }: { cents: number }) {
  const currency = useProject()?.currency;
  if (currency === undefined) return null;
  return <span className="t-data rounded-full bg-[var(--c-chip)] px-2.5 py-1 text-[var(--c-fg-2)]">{formatMoney(cents, currency)}</span>;
}

/* ------------------------------------------------------------------
   Editable text — direct manipulation of entity fields
   ------------------------------------------------------------------ */

export function EditableText({
  value,
  onCommit,
  className = "",
  label,
  maxLength = 140,
}: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
  label: string;
  /** The field's stored limit: longer text is cut here, so the document always parses */
  maxLength?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.textContent !== value) el.textContent = value;
  }, [value]);

  return (
    <motion.span
      ref={ref}
      layout="position"
      role="textbox"
      aria-label={label}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      data-interactive
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          e.currentTarget.textContent = value;
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        const v = (e.currentTarget.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength).trim();
        if (!v) e.currentTarget.textContent = value;
        else if (v !== value) onCommit(v);
      }}
      className={`editable inline-block ${className}`}
    />
  );
}

/* ------------------------------------------------------------------
   Number badge — selection handle (Point & Ask)
   ------------------------------------------------------------------ */

export function NumberBadge({ task, number, inline = false }: { task: TaskFields<"title" | "priority" | "status">; number: string; inline?: boolean }) {
  const taskId = asTaskId(task.id);
  const selected = useIsSelected(taskId);
  const { select } = useActions();
  const highlightUrgent = useViewConfig()?.highlightUrgent ?? false;
  const urgent = highlightUrgent && task.priority === "urgent" && task.status !== "done";
  return (
    // The wrapper rides the layout (position only, so it stays round while the card morphs).
    // A new badge can't track a morphing corner (it has no previous box), so the button
    // arrives once the surface has settled. Its fade lives below the projection node,
    // which would otherwise override it with its own layout opacity.
    <motion.span layout="position" className={`flex shrink-0 ${inline ? "relative" : "absolute -top-[9px] -right-[9px] z-10"}`}>
      <motion.button
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.2, ease: ease.out } }}
        transition={{ delay: 0.5, duration: 0.35, ease: ease.out }}
        type="button"
        data-interactive
        aria-pressed={selected}
        aria-label={selected ? `Deselect ${task.title}` : `Select ${task.title} to ask FORM about it`}
        onClick={(e) => {
          e.stopPropagation();
          select(selected ? null : taskId);
        }}
        className={`focus-ring t-micro relative grid h-[30px] w-[30px] cursor-pointer place-items-center rounded-full tabular-nums transition-[background-color,color,scale] duration-200 hover:scale-105 ${
          selected ? "bg-ink text-on-ink" : "bg-[#f6f6f4] text-text-2 shadow-[0_1px_0_rgba(255,255,255,0.9)_inset,0_4px_12px_-6px_rgba(0,0,0,0.25)]"
        }`}
      >
        {number}
        {urgent && <span className="absolute -top-0.5 -right-0.5 h-[8px] w-[8px] rounded-full bg-signal ring-2 ring-[#f6f6f4]" />}
      </motion.button>
    </motion.span>
  );
}

/* ------------------------------------------------------------------
   Steps (task.steps)
   ------------------------------------------------------------------ */

export function SubtaskList({ parentId, dense = false }: { parentId: TaskId; dense?: boolean }) {
  const subs = useSteps(parentId);
  const { commit } = useActions();
  if (!subs.length) return null;
  const done = subs.filter((s) => s.done).length;
  return (
    <motion.div layout="position" className={`flex flex-col ${dense ? "mt-1 px-2 pb-1" : "mt-4"}`}>
      <div className="t-micro mb-1.5 flex justify-between text-[var(--c-fg-3)]">
        <span>Steps</span>
        <span className="tabular-nums">
          {done}/{subs.length}
        </span>
      </div>
      <ul className="flex flex-col">
        {subs.map((s) => (
          <motion.li
            key={s.id}
            layoutId={`sub-${s.id}`}
            // Position only: a step travelling to a full-width timeline row must not stretch
            layout="position"
            className="group flex min-h-[30px] items-center gap-2 rounded-full"
            transition={move}
          >
            <button
              type="button"
              data-interactive
              aria-label={s.done ? `Mark ${s.title} not done` : `Mark ${s.title} done`}
              onClick={(e) => {
                e.stopPropagation();
                commit([{ op: "updateStep", taskId: parentId, stepId: s.id, field: "done", value: !s.done }], { label: "step done" });
              }}
              className="focus-ring grid h-[22px] w-[22px] shrink-0 cursor-pointer place-items-center rounded-full text-[var(--c-fg)]"
            >
              <StatusGlyph status={s.done ? "done" : "todo"} size={13} />
            </button>
            <EditableText
              value={s.title}
              label="Step title"
              onCommit={(v) => commit([{ op: "updateStep", taskId: parentId, stepId: s.id, field: "title", value: v }], { label: "rename step" })}
              className={`t-body-s min-w-0 flex-1 ${s.done ? "text-[var(--c-fg-3)] line-through decoration-1" : ""}`}
            />
            {/* Duration and remove share one slot: the action replaces the figure on hover */}
            <span className="relative grid h-[22px] min-w-[30px] shrink-0 place-items-center">
              <span className="t-data text-[var(--c-fg-3)] transition-opacity group-hover:opacity-0">{fmtDays(s.estimateDays)}</span>
              <button
                type="button"
                data-interactive
                aria-label={`Remove ${s.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  commit([{ op: "removeStep", taskId: parentId, stepId: s.id }], { label: "remove step" });
                }}
                className="focus-ring absolute inset-0 grid cursor-pointer place-items-center rounded-full text-[var(--c-fg-3)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--c-fg)] focus-visible:opacity-100"
              >
                <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden>
                  <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </button>
            </span>
          </motion.li>
        ))}
      </ul>
    </motion.div>
  );
}

/* ------------------------------------------------------------------
   Proposal — agent suggestions the user must accept
   ------------------------------------------------------------------ */

// `parentId` stays a string until the step 18 integration: the Focus view still passes v0 ids (see TaskFields)
export function ProposalBlock({ parentId, dense = false }: { parentId: string; dense?: boolean }) {
  const proposal = useSubtaskProposal(asTaskId(parentId));
  const { resolveProposal: resolve } = useActions();
  return (
    <AnimatePresence>
      {proposal && (
        <motion.div
          key="proposal"
          layout
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0, transition: { duration: 0.2 } }}
          transition={move}
          className={`overflow-hidden ${dense ? "px-2" : ""}`}
          data-interactive
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mt-4 rounded-[22px] border border-dashed border-[var(--c-line)] p-2.5">
            <div className="t-micro flex justify-between px-1.5 pt-0.5 pb-2 text-[var(--c-fg-3)]">
              <span>Proposed by FORM</span>
              <span className="tabular-nums">
                {proposal.items.length} steps
                {proposal.items.every((i) => i.estimateDays !== null) && ` · ${fmtDays(proposal.items.reduce((s, i) => s + (i.estimateDays ?? 0), 0))}`}
              </span>
            </div>
            <ul className="flex flex-col gap-1">
              {/* A proposed step keeps its id when accepted, so it morphs into the step list */}
              {proposal.items.map((item, i) => (
                <motion.li
                  key={item.stepId}
                  layoutId={`sub-${item.stepId}`}
                  layout="position"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: 0.12 + i * 0.06, ...move } }}
                  className="flex h-[32px] items-center gap-2 rounded-full bg-[var(--c-chip)] pr-3 pl-2"
                >
                  <span className="grid h-[22px] w-[22px] place-items-center text-[var(--c-fg-3)]">
                    <StatusGlyph status="todo" size={13} />
                  </span>
                  <span className="t-body-s min-w-0 flex-1 truncate">{item.title}</span>
                  <span className="t-data text-[var(--c-fg-3)]">{fmtDays(item.estimateDays)}</span>
                </motion.li>
              ))}
            </ul>
            <div className="mt-2.5 flex gap-1.5">
              <button
                type="button"
                onClick={() => resolve(true)}
                className="focus-ring t-body-s h-[34px] flex-1 cursor-pointer rounded-full bg-[var(--c-fill)] px-4 text-[var(--c-on-fill)] transition-transform hover:scale-[1.015]"
              >
                <ShuffleText text={`Accept ${proposal.items.length} steps`} />
              </button>
              <button
                type="button"
                onClick={() => resolve(false)}
                className="focus-ring t-body-s h-[34px] cursor-pointer rounded-full px-4 text-[var(--c-fg-2)] transition-colors hover:bg-[var(--c-hover)] hover:text-[var(--c-fg)]"
              >
                <ShuffleText text="Discard" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
