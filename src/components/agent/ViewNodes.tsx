"use client";

import { AnimatePresence, animate, motion, useIsPresent, useMotionValue, useTransform, type Transition } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { ease, springs } from "@/lib/motion";
import { REPRESENTATION_LABEL, type Representation } from "@/lib/schema";
import { REST_INSET, type NodeFrame, type Vec } from "./geometry";
import { ShuffleText } from "../text/ShuffleText";

/** Nodes wait for the agent to settle at the dock, then bud off it one after another */
export const NODE_TIMING = { bud: 0.6, stagger: 0.07, surface: 0.28, label: 0.35, retract: 0.3 };
/** Slots, not nodes: a slot's capsule retracts and re-buds without unmounting */
const SLOTS = [0, 1, 2];

/**
 * Ink half of the suggestion nodes. Lives inside the goo group, so each volume
 * fuses with the pill while it leaves and pinches off as it comes to rest. At rest it
 * sits just inside the node's crisp capsule (like the composer's body), because the goo
 * filter erodes a small capsule's ends into an oval.
 */
export function NodeBlobs({ frames, origin, shown, reduced }: { frames: NodeFrame[]; origin: Vec; shown: boolean; reduced: boolean }) {
  return (
    <>
      {SLOTS.map((i) => (
        <NodeBlob key={i} index={i} frame={frames[i] ?? null} origin={origin} shown={shown && !!frames[i]} reduced={reduced} />
      ))}
    </>
  );
}

function NodeBlob({ index, frame, origin, shown, reduced }: { index: number; frame: NodeFrame | null; origin: Vec; shown: boolean; reduced: boolean }) {
  // Hidden = collapsed to nothing inside the agent
  const t =
    shown && frame
      ? { x: frame.x + REST_INSET, y: frame.y + REST_INSET, w: frame.w - REST_INSET * 2, h: frame.h - REST_INSET * 2 }
      : { x: origin.x, y: origin.y, w: 0, h: 0 };
  // Always born inside the agent, also on a reload with a project open
  const x = useMotionValue(origin.x);
  const y = useMotionValue(origin.y);
  const w = useMotionValue(0);
  const h = useMotionValue(0);
  const wasShown = useRef(false);
  useEffect(() => {
    // Only budding waits and staggers; retraction answers at once
    const budding = shown && !wasShown.current;
    wasShown.current = shown;
    const tr: Transition = reduced ? { duration: 0 } : { ...springs.pill, delay: budding ? NODE_TIMING.bud + index * NODE_TIMING.stagger : 0 };
    const a = [animate(x, t.x, tr), animate(y, t.y, tr), animate(w, t.w, tr), animate(h, t.h, tr)];
    return () => a.forEach((v) => v.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.x, t.y, t.w, t.h, shown]);
  // Springs overshoot when collapsing to nothing; SVG rejects negative sizes
  const W = useTransform(() => Math.max(0, w.get()));
  const H = useTransform(() => Math.max(0, h.get()));
  const rx = useTransform(() => Math.max(0, h.get() / 2));
  return <motion.rect x={x} y={y} width={W} height={H} rx={rx} />;
}

/** Crisp half: an ink capsule with its label, settling over the budded volume. */
export function NodeLabels({
  frames,
  shown,
  reduced,
  onHover,
  onPick,
}: {
  frames: NodeFrame[];
  shown: boolean;
  reduced: boolean;
  onHover: (i: number | null) => void;
  onPick: (view: Representation, keyboard: boolean) => void;
}) {
  return (
    <div role="group" aria-label="Views FORM suggests">
      <AnimatePresence>
        {/* Keyed by the whole set: every bud is a fresh label, even for a view offered again in another place */}
        {shown && frames.map((f, i) => <NodeLabel key={`${frames.map((x) => x.view).join()}:${f.view}`} frame={f} index={i} reduced={reduced} onHover={onHover} onPick={onPick} />)}
      </AnimatePresence>
    </div>
  );
}

function NodeLabel({
  frame: f,
  index: i,
  reduced,
  onHover,
  onPick,
}: {
  frame: NodeFrame;
  index: number;
  reduced: boolean;
  onHover: (i: number | null) => void;
  onPick: (view: Representation, keyboard: boolean) => void;
}) {
  const bud = NODE_TIMING.bud + i * NODE_TIMING.stagger;
  const delay = reduced ? 0 : bud + NODE_TIMING.label;
  // Inert until its ink has budded and the label starts to show: no invisible button catches a click meant for the page
  const [live, setLive] = useState(reduced);
  useEffect(() => {
    if (live) return;
    const t = setTimeout(() => setLive(true), delay * 1000);
    return () => clearTimeout(t);
  }, [live, delay]);
  const present = useIsPresent();
  const active = live && present;
  return (
    <motion.button
      type="button"
      aria-label={`Add the ${REPRESENTATION_LABEL[f.view]} view`}
      tabIndex={active ? 0 : -1}
      // ::before widens the hit area; the capsule is the pill's height
      className={`focus-ring-ink fixed z-50 flex cursor-pointer items-center justify-center rounded-full bg-ink text-on-ink-2 transition-colors before:absolute before:-inset-1 before:rounded-full hover:text-on-ink ${active ? "" : "pointer-events-none"}`}
      style={{ left: f.x, top: f.y, width: f.w, height: f.h }}
      // The crisp capsule settles over the volume once it has landed: a true capsule, not the goo's oval
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { delay: reduced ? 0 : bud + NODE_TIMING.surface, duration: 0.22, ease: ease.out } }}
      exit={{ opacity: 0, transition: { duration: 0.08 } }}
      onPointerEnter={() => onHover(i)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(i)}
      onBlur={() => onHover(null)}
      onClick={(e) => {
        onHover(null);
        onPick(f.view, e.detail === 0);
      }}
    >
      <motion.span
        className="flex items-center gap-1.5"
        initial={{ opacity: 0, filter: "blur(8px)" }}
        animate={{ opacity: 1, filter: "blur(0px)", transition: { delay, duration: 0.4, ease: ease.out } }}
      >
        <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden className="shrink-0">
          <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <ShuffleText text={REPRESENTATION_LABEL[f.view]} className="t-body-s text-on-ink" />
      </motion.span>
    </motion.button>
  );
}
