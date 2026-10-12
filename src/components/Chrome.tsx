"use client";

import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { useForm } from "@/lib/store";
import { AgentMark } from "./agent/AgentMark";
import { ShuffleText } from "./text/ShuffleText";

/** Minimal, contextual chrome: wordmark, history controls, engine status, metadata. */
export function Chrome() {
  const hasTool = useForm((s) => !!s.doc.tool);
  const canUndo = useForm((s) => s.past.length > 0);
  const canRedo = useForm((s) => s.future.length > 0);
  const undo = useForm((s) => s.undo);
  const redo = useForm((s) => s.redo);
  const reset = useForm((s) => s.reset);
  const engine = useForm((s) => s.engine);
  const changes = useForm((s) => s.log.length);
  const setIntro = useForm((s) => s.setIntro);

  return (
    <>
      {/* A short veil keeps the fixed header legible over scrolled content; nothing at the bottom */}
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-20 h-[72px] bg-gradient-to-b from-[var(--paper)] to-transparent" />
      <header className="pointer-events-none fixed inset-x-0 top-0 z-30 flex items-start justify-between px-4 pt-4 md:px-7 md:pt-6">
        {/* The lockup sits in a glass capsule like the controls opposite, so content scrolling under it never mixes with it */}
        <div className="glass pointer-events-auto flex h-[36px] items-center gap-2 rounded-full pr-4 pl-2">
          <AgentMark size={22} tone="dark" />
          <span className="font-display text-[15px] leading-none font-medium tracking-[-0.03em]">FORM</span>
        </div>

        <div className="pointer-events-auto flex items-center gap-1.5">
          <span
            className="t-micro mr-1 hidden items-center gap-1.5 rounded-full px-2.5 py-1.5 text-text-3 sm:flex"
            title={engine === "demo" ? "Commands are interpreted by a deterministic, rule-based parser. No AI model is involved." : "Commands are interpreted by Claude on the server."}
          >
            <span className={`h-[6px] w-[6px] rounded-full ${engine === "demo" ? "border border-text-3" : "bg-ink"}`} />
            {engine === "demo" ? "Demo parser · no API key" : "Claude · server-side"}
          </span>
          <IconButton label="About this project" disabled={false} onClick={() => setIntro(true)}>
            <circle cx="8" cy="8" r="5.6" />
            <path d="M8 7.3v3.4M8 5.2v.01" />
          </IconButton>
          <AnimatePresence initial={false}>
            {(hasTool || canUndo) && (
              <motion.div
                key="history"
                className="flex items-center gap-1.5"
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
              >
                <IconButton label="Undo (⌘Z)" disabled={!canUndo} onClick={undo}>
                  <path d="M5.5 4.5L3 7l2.5 2.5M3.5 7h6a3 3 0 010 6H8" />
                </IconButton>
                <IconButton label="Redo (⇧⌘Z)" disabled={!canRedo} onClick={redo}>
                  <path d="M10.5 4.5L13 7l-2.5 2.5M12.5 7h-6a3 3 0 000 6H8" />
                </IconButton>
                {hasTool && (
                  <button
                    type="button"
                    onClick={reset}
                    className="focus-ring glass t-body-s ml-1 h-[36px] cursor-pointer rounded-full px-4 text-text-2 transition-colors hover:text-text"
                  >
                    <ShuffleText text="Reset demo" />
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </header>

      {/* PXDX-style corner metadata */}
      {/* Corners only where they can never meet the dock, the composer or the caption */}
      <div className="t-micro pointer-events-none fixed bottom-6 left-7 z-20 hidden flex-col gap-0.5 text-text-3 xl:flex">
        <span>FORM / 01 — Adaptive workspace</span>
        <span>Intent → interface</span>
        <span className="tabular-nums">{changes ? `${changes} changes · saved locally` : "Saved locally"}</span>
      </div>
      <div className="t-micro pointer-events-none fixed right-7 bottom-6 z-20 hidden flex-col items-end gap-0.5 text-text-3 xl:flex">
        <span>/ — ask</span>
        <span>⌘Z — undo</span>
        <span>Esc — close · deselect</span>
      </div>
    </>
  );
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="focus-ring glass grid h-[36px] w-[36px] cursor-pointer place-items-center rounded-full text-text transition-opacity disabled:cursor-default disabled:opacity-35"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}
