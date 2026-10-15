"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { useActions, useCanUndo, useCaption, usePhase, useReducedMotion } from "@/lib/store/hooks";
import { ease, move } from "@/lib/motion";
import { RevealText } from "../text/TextMotion";
import { useViewport } from "@/lib/useViewport";
import type { Vec } from "./geometry";
import { ShuffleText } from "../text/ShuffleText";

interface Props {
  anchor: Vec;
  placement: "center" | "dock";
  composerOpen: boolean;
  /** Extra rise (px) while something sits between the caption and the dock */
  lift?: number;
}

/** The agent's only verbal channel: a one-line caption of what changed. */
export function Caption({ anchor, placement, composerOpen, lift = 0 }: Props) {
  const { w: vw, h: vh } = useViewport();
  const caption = useCaption();
  const phase = usePhase();
  const { dismissCaption: dismiss, undo } = useActions();
  const canUndo = useCanUndo();
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!caption) return;
    const sticky = caption.tone === "clarify" || caption.tone === "unsupported" || caption.tone === "proposal";
    const t = setTimeout(dismiss, sticky ? 14000 : 6500);
    return () => clearTimeout(t);
  }, [caption, dismiss]);

  const width = Math.min(600, vw - 32);
  const style =
    placement === "dock"
      ? { left: anchor.x - width / 2, width, bottom: vh - anchor.y + 40 }
      : { left: anchor.x - width / 2, width, bottom: vh - anchor.y + (composerOpen ? 56 : 150) };

  const show = caption && phase !== "processing";
  // At the dock the caption clears the open composer, or the nodes above the pill on phones —
  // one transform on the move curve, so switching between them glides instead of jumping
  const rise = placement === "dock" ? Math.max(lift, composerOpen ? 52 : 0) : 0;

  return (
    // One grid cell: an outgoing caption dissolves in place (no popLayout, which would collapse
    // this bottom-anchored box and drop the caption before it fades), and a new one overlaps it
    // A transform (not bottom, which would snap) keeps the glass blur
    <motion.div className="pointer-events-none fixed z-50 grid justify-items-center" style={style} initial={false} animate={{ y: -rise }} transition={reduced ? { duration: 0 } : move}>
      <AnimatePresence>
        {show && (
          <motion.div
            key={caption.id}
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, filter: "blur(12px)" }}
            animate={{ opacity: 1, filter: "blur(0px)", transition: { duration: 0.6, ease: ease.out, delay: phase === "creating" ? 0.9 : 0.12 } }}
            exit={{ opacity: 0, filter: "blur(10px)", transition: { duration: 0.45, ease: ease.out } }}
            className="glass-hi pointer-events-auto flex max-w-full items-center gap-2.5 rounded-[22px] py-2 pr-2 pl-4 [grid-area:1/1]"
          >
            <ToneDot tone={caption.tone} />
            <RevealText text={caption.text} delay={phase === "creating" ? 1 : 0.2} className="t-body-s py-1 text-text" />
            {caption.undoable && canUndo && (
              <button
                type="button"
                onClick={() => {
                  undo();
                  dismiss();
                }}
                className="focus-ring t-body-s shrink-0 cursor-pointer rounded-full bg-ink px-3.5 py-[6px] text-on-ink transition-transform hover:scale-[1.03]"
              >
                <ShuffleText text="Undo" />
              </button>
            )}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={dismiss}
              className="focus-ring grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-full text-text-3 transition-colors hover:text-text"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ToneDot({ tone }: { tone: string }) {
  if (tone === "done" || tone === "info") return <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-ink" />;
  if (tone === "proposal") return <span className="h-[9px] w-[9px] shrink-0 rounded-full border-[1.5px] border-ink" />;
  return <span className="h-[9px] w-[9px] shrink-0 rounded-full border-[1.5px] border-dashed border-text-3" />;
}
