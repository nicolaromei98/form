"use client";

import { motion } from "motion/react";
import { springs } from "@/lib/motion";
import { CAPABILITIES, REQUIREMENT_HINT, type Requirement } from "./suggestions";

interface Props {
  /** What's typed in the field — the palette filters as you type */
  query: string;
  hasTool: boolean;
  hasSelection: boolean;
  origin: "top" | "bottom";
  maxHeight: number;
  onRun: (command: string) => void;
  onClose: () => void;
}

/** Command palette: every phrase demo mode understands, runnable in one click. */
export function CommandSheet({ query, hasTool, hasSelection, origin, maxHeight, onRun, onClose }: Props) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const groups = CAPABILITIES.map((g) => ({ ...g, items: g.items.filter((it) => tokens.every((t) => it.toLowerCase().includes(t))) })).filter(
    (g) => g.items.length,
  );
  const available = (needs: Requirement) => needs === "none" || (hasTool && (needs === "tool" || hasSelection));

  return (
    <motion.div
      role="dialog"
      aria-label="Commands"
      initial={{ opacity: 0, scale: 0.96, y: origin === "top" ? -10 : 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, y: origin === "top" ? -6 : 6, transition: { duration: 0.14 } }}
      transition={springs.soft}
      className="glass-hi flex w-full flex-col overflow-hidden rounded-[24px]"
      style={{ transformOrigin: origin === "top" ? "top left" : "bottom left", maxHeight }}
    >
      <header className="flex items-start justify-between gap-4 px-5 pt-4 pb-3.5">
        <div>
          <h2 className="t-body font-medium text-text">Commands</h2>
          <p className="t-body-s mt-0.5 text-text-3">Click one to run it, or type your own request in plain English.</p>
        </div>
        <button
          type="button"
          aria-label="Close commands"
          onClick={onClose}
          className="focus-ring grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full bg-black/[0.05] text-text-2 transition-colors hover:bg-black/[0.09] hover:text-text"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-line px-3 pt-3 pb-1 sm:columns-2 sm:gap-x-2">
        {groups.map((g) => {
          const enabled = available(g.needs);
          return (
            <section key={g.group} className="mb-3 break-inside-avoid">
              <div className="flex items-baseline justify-between gap-2 px-2 pb-1">
                <span className="t-micro text-text-3">{g.group}</span>
                {!enabled && <span className="t-micro text-text-4">{REQUIREMENT_HINT[g.needs]}</span>}
              </div>
              <ul>
                {g.items.map((it) => (
                  <li key={it}>
                    <button
                      type="button"
                      disabled={!enabled}
                      onClick={() => onRun(it)}
                      className="focus-ring group t-body-s flex w-full cursor-pointer items-center justify-between gap-3 rounded-[12px] px-2 py-[7px] text-left text-text-2 transition-colors enabled:hover:bg-black/[0.04] enabled:hover:text-text disabled:cursor-not-allowed disabled:text-text-4"
                    >
                      <span>{it}</span>
                      {enabled && (
                        <span className="t-micro shrink-0 text-text-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">Run</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {!groups.length && (
          <p className="t-body-s px-2 py-6 text-center text-text-3 sm:[column-span:all]">
            No matching command. Press Enter to send it anyway.
          </p>
        )}
      </div>

      <footer className="flex items-center justify-between border-t border-line px-5 py-2.5">
        <span className="t-micro text-text-3">Demo parser · deterministic</span>
        <span className="t-micro text-text-3">Esc to close</span>
      </footer>
    </motion.div>
  );
}
