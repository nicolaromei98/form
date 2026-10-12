"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { DecodeText, TEXT, revealBlocks, revealWords } from "../text/TextMotion";
import { useForm } from "@/lib/store";
import { move } from "@/lib/motion";
import { focusPick, pickFor, summaryOf, type FocusPick } from "@/lib/focus";
import { fmtDays, taskNumber, topLevel } from "@/lib/selectors";
import { STATUS_LABEL, type Doc, type Task } from "@/lib/schema";
import { useViewport } from "@/lib/useViewport";
import { EditableText, ProposalBlock } from "./parts";
import { useTaskSurface } from "./TaskCard";
import { ShuffleText } from "../text/ShuffleText";

/**
 * Representation: focus — a full-viewport stage, readable in one glance.
 * Left: the decision (what, why, next). Right: every task is a persistent
 * volume of the fluid; the focused one is the nucleus, the rest cling to it.
 * Changing focus never swaps elements — the volumes trade places.
 */
export function FocusView() {
  const doc = useForm((s) => s.doc);
  const pick = useMemo(() => focusPick(doc), [doc]);
  const volumes = useMemo(() => topLevel(doc).filter((t) => t.id === pick?.task.id || !(doc.view.hideDone && t.status === "done")), [doc, pick]);

  if (!pick) {
    return (
      <div className="grid min-h-[calc(100svh-300px)] place-items-center text-center">
        <div>
          <p className="t-display-l">Nothing left to focus on.</p>
          <p className="t-body mt-3 text-text-2">Every task is done.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-[calc(100svh-300px)] grid-cols-1 items-center gap-x-16 gap-y-14 pb-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      <DecisionStack pick={pick} doc={doc} />
      <Fluid pick={pick} volumes={volumes} doc={doc} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Overlapping swap: every focus that has been shown stays mounted in the same
 * grid cell until its GSAP exit completes, so old and new never jump layout.
 */
function useStack(id: string) {
  const [items, setItems] = useState<{ id: string; leaving: boolean }[]>([{ id, leaving: false }]);
  const last = items[items.length - 1];
  if (last.id !== id || last.leaving) {
    setItems([...items.filter((i) => i.id !== id).map((i) => ({ ...i, leaving: true })), { id, leaving: false }]);
  }
  const gone = useCallback((gid: string) => setItems((cur) => cur.filter((i) => !(i.id === gid && i.leaving))), []);
  return { items, gone };
}

function DecisionStack({ pick, doc }: { pick: FocusPick; doc: Doc }) {
  const { items, gone } = useStack(pick.task.id);
  return (
    <div className="grid min-w-0">
      {items.map((it) => {
        const p = it.id === pick.task.id ? pick : pickFor(doc, it.id, pick.chosenBy);
        if (!p) return null;
        return <Decision key={it.id} pick={p} number={taskNumber(doc, it.id)} leaving={it.leaving} onGone={gone} />;
      })}
    </div>
  );
}

function Decision({ pick, number, leaving, onGone }: { pick: FocusPick; number: string; leaving: boolean; onGone: (id: string) => void }) {
  const { task, next, chosenBy } = pick;
  const { lead, point } = summaryOf(pick);
  const root = useRef<HTMLElement>(null);
  const update = useForm((s) => s.updateTask);
  const commit = useForm((s) => s.commit);
  const select = useForm((s) => s.select);
  const submit = useForm((s) => s.submit);
  const reduced = useForm((s) => s.reducedMotion);

  // Enter: the product's one text motion — title words condense out of a blur, the rest follows
  useGSAP(
    () => {
      if (reduced) return;
      const title = root.current?.querySelector('[aria-label="Task title"]');
      if (title) revealWords(title, { delay: 0.3 });
      revealBlocks(root.current!.querySelectorAll('[data-r="body"]'), { delay: 0.5 });
    },
    { scope: root },
  );

  // Exit: dissolve in place while the next focus condenses into the same cell
  useGSAP(
    () => {
      if (!leaving) return;
      gsap.to("[data-r]", { ...TEXT.out, duration: reduced ? 0 : TEXT.out.duration, stagger: 0.04, onComplete: () => onGone(task.id) });
    },
    { scope: root, dependencies: [leaving] },
  );

  return (
    <section
      ref={root}
      className={`tone-light min-w-0 [grid-area:1/1] ${leaving ? "pointer-events-none" : ""}`}
      aria-label="Focus"
      aria-hidden={leaving || undefined}
    >
      <div data-r="eyebrow" className="flex items-center gap-2">
        <span className="h-[6px] w-[6px] rounded-full bg-ink" />
        <DecodeText text={`${chosenBy === "form" ? "FORM suggests" : "Your focus"} · ${number}`} delay={0.2} className="t-micro text-text-3" />
      </div>

      <div data-r="title" className="mt-5">
        <EditableText value={task.title} label="Task title" onCommit={(v) => update(task.id, { title: v })} className="t-display-xl" />
      </div>

      {/* One sentence instead of chips and lists: where it stands, then why it matters now */}
      <p data-r="body" className="mt-7 max-w-[34ch] font-body text-[21px] leading-[1.38] tracking-[-0.02em] text-text-3">
        {lead} <span className="text-text">{point}</span>
      </p>

      {/* The next concrete move — one ink capsule, the agent's material */}
      <div data-r="body" className="mt-10 max-w-[520px]">
        <div className="tone-dark flex min-h-[56px] items-center gap-3 rounded-full bg-ink py-2 pr-2 pl-6 text-on-ink">
          <span className="t-micro shrink-0 text-on-ink-3">Next</span>
          <span className="t-body min-w-0 flex-1 truncate">{next ? next.title : "Break it into smaller steps"}</span>
          {next && <span className="t-data shrink-0 text-on-ink-3">{fmtDays(next.estimate)}</span>}
          <button
            type="button"
            onClick={() => {
              if (next) commit([{ op: "updateTask", id: next.id, patch: { status: "done" } }], "step done");
              else {
                select(task.id);
                submit("Break this task into smaller steps");
              }
            }}
            className="focus-ring-ink t-body-s h-[40px] shrink-0 cursor-pointer rounded-full bg-on-ink px-5 text-ink transition-transform hover:scale-[1.03]"
          >
            <ShuffleText text={next ? "Mark done" : "Break it down"} />
          </button>
        </div>
        <ProposalBlock parentId={task.id} />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

// Volumes drift far enough that necks to the mass open and close on their own
const FLOAT_X = [0, 6, 1, -5, 0];
const FLOAT_Y = [0, -5, -7, 3, 0];
const floatT = (i: number) => ({
  x: { duration: 6.5 + i * 1.3, repeat: Infinity, ease: "easeInOut" as const },
  y: { duration: 5.2 + i * 0.9, repeat: Infinity, ease: "easeInOut" as const },
});

/** Free-floating positions around the mass, in units of D — deliberately not a ring. */
const SLOTS: Record<number, [number, number][]> = {
  1: [[0.78, -0.55]],
  2: [[-0.72, -0.5], [0.8, 0.12]],
  3: [[-0.7, -0.52], [0.74, -0.42], [0.52, 0.66]],
  4: [[-0.72, -0.5], [0.74, -0.44], [0.62, 0.58], [-0.74, 0.42]],
};
function slotAt(i: number, n: number): [number, number] {
  if (SLOTS[n]) return SLOTS[n][i];
  const a = ((-150 + (i * 300) / (n - 1)) * Math.PI) / 180;
  const r = i % 2 ? 0.92 : 0.78;
  return [Math.cos(a) * r, Math.sin(a) * r];
}

/** Lobes fused to the focus volume give the mass an irregular, living outline. */
const LOBES = [
  { x: 0.3, y: -0.22, d: 0.62, dx: [0, 5, -2, 0], dy: [0, -4, 3, 0], s: [1, 1.05, 0.97, 1], dur: 7 },
  { x: -0.27, y: 0.28, d: 0.5, dx: [0, -4, 3, 0], dy: [0, 5, -2, 0], s: [1, 0.95, 1.04, 1], dur: 8.4 },
];

/** Crown slots keep their owners: the old nucleus takes the slot of the volume that replaced it. */
function useSlots(focusId: string, volumes: Task[]) {
  const ids = volumes.filter((t) => t.id !== focusId).map((t) => t.id);
  const [state, setState] = useState({ focusId, slots: ids });
  let slots = state.slots;
  if (state.focusId !== focusId) {
    const at = state.slots.indexOf(focusId);
    slots = at >= 0 ? state.slots.map((id) => (id === focusId ? state.focusId : id)) : ids;
    setState({ focusId, slots });
  }
  // Reconcile with membership changes (hide done, removals, new tasks)
  const kept = slots.filter((id) => ids.includes(id));
  return kept.concat(ids.filter((id) => !kept.includes(id)));
}

function Fluid({ pick, volumes, doc }: { pick: FocusPick; volumes: Task[]; doc: Doc }) {
  const { w: vw } = useViewport();
  const { task } = pick;
  const { onClick: selectFocus } = useTaskSurface(task);
  const commit = useForm((s) => s.commit);
  const [hover, setHover] = useState<Task | null>(null);
  const slots = useSlots(task.id, volumes);

  const D = Math.round(Math.max(200, Math.min(290, vw * 0.2)));
  const vol = (t: Task) => Math.round(D * (t.status === "done" ? 0.17 : 0.26 + Math.min(8, t.estimate ?? 3) * 0.008));
  const geometry = (t: Task) => {
    if (t.id === task.id) return { x: 0, y: 0, d: D, slot: -1 };
    const i = slots.indexOf(t.id);
    const [x, y] = slotAt(i, slots.length);
    return { x: x * D, y: y * D, d: vol(t), slot: i };
  };

  const boxW = Math.round(D * 2.3);
  const boxH = Math.round(D * 1.75);
  const cy = Math.round(D * 0.8);

  return (
    <section className="flex flex-col items-center" aria-label="Project volumes">
      <div className="relative" style={{ width: boxW, height: boxH, maxWidth: "100%" }}>
        {/* Goo layer: generous inset keeps morphing cards inside the filter region */}
        <div className="pointer-events-none absolute -inset-[300px]" style={{ filter: "url(#form-goo)" }}>
          <div className="absolute left-1/2" style={{ top: 300 + cy }}>
            {LOBES.map((l, i) => (
              // Outer: grows out of the mass on entry. Inner: breathes and drifts forever.
              <motion.div
                key={i}
                aria-hidden
                className="absolute"
                style={{ width: l.d * D, height: l.d * D, left: l.x * D - (l.d * D) / 2, top: l.y * D - (l.d * D) / 2 }}
                initial={{ scale: 0.2, x: -l.x * D * 0.6, y: -l.y * D * 0.6 }}
                animate={{ scale: 1, x: 0, y: 0 }}
                transition={{ ...move, delay: 0.25 + i * 0.12 }}
              >
                <motion.div
                  className="h-full w-full bg-ink"
                  style={{ borderRadius: 999 }}
                  animate={{ scale: l.s, x: l.dx, y: l.dy }}
                  transition={{
                    scale: { duration: l.dur, repeat: Infinity, ease: "easeInOut" },
                    x: { duration: l.dur * 1.1, repeat: Infinity, ease: "easeInOut" },
                    y: { duration: l.dur * 0.9, repeat: Infinity, ease: "easeInOut" },
                  }}
                />
              </motion.div>
            ))}
            {volumes.map((t) => {
              const g = geometry(t);
              const focus = g.slot < 0;
              return (
                <motion.button
                  key={t.id}
                  type="button"
                  layout
                  layoutId={`task-${t.id}`}
                  data-task-id={t.id}
                  aria-label={focus ? `${t.title}, in focus` : `Focus on ${t.title}`}
                  // Pointer clicks shouldn't move keyboard focus — the browser would scroll to it
                  onMouseDown={(e) => e.preventDefault()}
                  onPointerEnter={() => !focus && setHover(t)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => !focus && setHover(t)}
                  onBlur={() => setHover(null)}
                  onClick={(e) => {
                    if (focus) return selectFocus(e);
                    e.stopPropagation();
                    setHover(null);
                    commit([{ op: "setView", patch: { focusId: t.id } }], `focus ${t.title}`);
                  }}
                  animate={focus ? { x: 0, y: 0 } : { x: FLOAT_X, y: FLOAT_Y }}
                  transition={{ layout: move, ...(focus ? { x: move, y: move } : floatT(g.slot)) }}
                  className="pointer-events-auto absolute cursor-pointer bg-ink"
                  style={{ width: g.d, height: g.d, left: g.x - g.d / 2, top: g.y - g.d / 2, borderRadius: 999 }}
                />
              );
            })}
          </div>
        </div>

        {/* Crisp layer above the goo: the nucleus readout and the volume numbers ride the same curve */}
        <div className="pointer-events-none absolute left-1/2" style={{ top: cy }}>
          <Readout task={task} size={D} doc={doc} />
          {volumes.map((t) => {
            const g = geometry(t);
            const focus = g.slot < 0;
            return (
              <motion.span
                key={t.id}
                className="absolute"
                style={{ left: -20, top: -10 }}
                initial={false}
                animate={{ x: g.x, y: g.y, opacity: focus ? 0 : 1, scale: focus ? 0.6 : 1 }}
                transition={{ x: move, y: move, opacity: { duration: focus ? 0.12 : 0.3, delay: focus ? 0 : 0.25 }, scale: move }}
              >
                <motion.span
                  className="t-micro grid h-[20px] w-[40px] place-items-center text-on-ink"
                  animate={focus ? { x: 0, y: 0 } : { x: FLOAT_X, y: FLOAT_Y }}
                  transition={focus ? undefined : floatT(Math.max(0, g.slot))}
                >
                  {t.status === "done" ? "✓" : taskNumber(doc, t.id)}
                </motion.span>
              </motion.span>
            );
          })}
        </div>
      </div>

      <div className="mt-2 h-5 text-center">
        <AnimatePresence mode="wait">
          <motion.span
            key={hover?.id ?? "hint"}
            className={`t-body-s block ${hover ? "text-text-2" : "text-text-3"}`}
            initial={{ opacity: 0, filter: "blur(4px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
          >
            {hover ? `${hover.title} · ${STATUS_LABEL[hover.status]} · ${hover.progress}%` : slots.length ? "Click a volume to bring it into focus" : ""}
          </motion.span>
        </AnimatePresence>
      </div>
    </section>
  );
}

/** The figure inside the nucleus: the old value blurs away while the new one comes into focus. */
function Readout({ task, size, doc }: { task: Task; size: number; doc: Doc }) {
  const { items, gone } = useStack(task.id);
  return (
    <div className="absolute grid place-items-center" style={{ width: size, height: size, left: -size / 2, top: -size / 2 }}>
      {items.map((it) => {
        const t = doc.tasks[it.id];
        return t ? <ReadoutItem key={it.id} task={t} leaving={it.leaving} onGone={gone} /> : null;
      })}
    </div>
  );
}

function ReadoutItem({ task, leaving, onGone }: { task: Task; leaving: boolean; onGone: (id: string) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const reduced = useForm((s) => s.reducedMotion);

  useGSAP(
    () => {
      if (reduced) return;
      gsap.fromTo(root.current, TEXT.from, { ...TEXT.to, delay: 0.3 });
    },
    { scope: root },
  );
  useGSAP(
    () => {
      if (!leaving) return;
      gsap.to(root.current, { ...TEXT.out, duration: reduced ? 0 : TEXT.out.duration, onComplete: () => onGone(task.id) });
    },
    { scope: root, dependencies: [leaving] },
  );

  return (
    <div ref={root} className="flex flex-col items-center text-on-ink [grid-area:1/1]">
      {/* The % hangs outside the figure, so the digits sit on the optical centre */}
      <span className="t-num relative text-[76px] leading-[0.8]">
        {task.progress}
        <span className="absolute top-[0.04em] left-full ml-[0.08em] text-[0.3em] leading-none text-on-ink-3">%</span>
      </span>
      <span className="t-micro mt-5 text-on-ink-3">Complete</span>
    </div>
  );
}
