"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useForm } from "@/lib/store";
import { ease, move } from "@/lib/motion";
import { AgentMark } from "./agent/AgentMark";
import { DecodeText, RevealText } from "./text/TextMotion";
import { ShuffleText } from "./text/ShuffleText";

const KEY = "form.intro.seen.v1";
const seen = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};
const remember = () => {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // Private mode: the intro simply shows again next visit
  }
};

const WORKS = ["Project tracker", "Tracker · Board · Timeline · Team · Focus", "Team workload", "Breaking a task into steps", "Moodboard"];

/** Same text motion as the rest of FORM: blocks condense out of a blur, one after another */
const block = (i: number) => ({
  initial: { opacity: 0, filter: "blur(10px)" },
  animate: { opacity: 1, filter: "blur(0px)", transition: { duration: 0.8, ease: ease.out, delay: 0.55 + i * 0.09 } },
});

/**
 * First-visit intro: what this is (a personal project), and an honest note that
 * it's in development and only some features work. The workspace stays visible,
 * out of focus, behind it. Reopened from the About button in the top bar.
 */
export function Intro() {
  const open = useForm((s) => s.intro);
  const setIntro = useForm((s) => s.setIntro);
  const engine = useForm((s) => s.engine);
  const dialog = useRef<HTMLElement>(null);

  // Decide before the first paint, so a first-time visitor never sees the workspace flash in unblurred
  useLayoutEffect(() => {
    if (!seen()) setIntro(true);
  }, [setIntro]);

  const close = useCallback(() => {
    remember();
    setIntro(false);
  }, [setIntro]);

  useEffect(() => {
    if (!open) return;
    dialog.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <AnimatePresence>
      {open && (
        <div key="intro" className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto p-4">
          {/* The blur is animated on the backdrop itself: fading a parent's opacity would switch backdrop-filter off mid-fade */}
          <motion.div
            aria-hidden
            className="absolute inset-0"
            onClick={close}
            initial={{ backdropFilter: "blur(0px)", backgroundColor: "rgba(238, 237, 233, 0)" }}
            animate={{ backdropFilter: "blur(18px)", backgroundColor: "rgba(238, 237, 233, 0.45)" }}
            exit={{ backdropFilter: "blur(0px)", backgroundColor: "rgba(238, 237, 233, 0)", transition: { duration: 0.6, ease: ease.out, delay: 0.1 } }}
            transition={{ duration: 0.9, ease: ease.out }}
          />

          <motion.section
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="intro-title"
            tabIndex={-1}
            className="tone-light glass-hi relative w-full max-w-[560px] rounded-[32px] p-7 outline-none md:p-10"
            initial={{ opacity: 0, filter: "blur(14px)", scale: 0.97 }}
            animate={{ opacity: 1, filter: "blur(0px)", scale: 1, transition: { ...move, delay: 0.2 } }}
            exit={{ opacity: 0, filter: "blur(12px)", scale: 0.98, transition: { duration: 0.45, ease: ease.out } }}
          >
            <div className="flex items-center gap-3">
              <AgentMark size={26} tone="dark" />
              <DecodeText text="Personal project · Work in progress" delay={0.45} className="t-micro text-text-3" />
            </div>

            <h2 id="intro-title" className="mt-7">
              <RevealText text="The living interface" delay={0.5} className="t-display-l block" />
            </h2>

            <motion.p {...block(0)} className="t-body-l mt-5 text-text-2">
              FORM is a personal project: an experimental workspace where you describe what you need, and the interface reshapes itself around it.
            </motion.p>

            <motion.p {...block(1)} className="t-body-l mt-3 text-text">
              It&rsquo;s a work in progress, still in active development. Only some features work for now; anything else, FORM will tell you it doesn&rsquo;t
              support yet.
            </motion.p>

            <motion.div {...block(2)} className="mt-7">
              <span className="t-micro text-text-3">Works today</span>
              <ul className="mt-2.5 flex flex-wrap gap-1.5">
                {WORKS.map((w) => (
                  <li key={w} className="t-body-s rounded-full bg-black/[0.05] px-3 py-1.5 text-text-2">
                    {w}
                  </li>
                ))}
              </ul>
            </motion.div>

            <motion.div {...block(3)} className="mt-9 flex flex-wrap items-center justify-between gap-x-6 gap-y-4 border-t border-line pt-6">
              <span className="t-data max-w-[30ch] text-text-3">
                {engine === "claude" ? "Commands are interpreted by Claude, server-side." : "Commands run on a built-in demo parser. Your work is saved in this browser."}
              </span>
              <button
                type="button"
                onClick={close}
                className="focus-ring t-body flex h-[46px] cursor-pointer items-center gap-2.5 rounded-full bg-ink pr-4 pl-5 text-on-ink transition-transform hover:scale-[1.02]"
              >
                <ShuffleText text="Enter FORM" />
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path d="M3 7h8M7.5 3.5L11 7l-3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </motion.div>
          </motion.section>
        </div>
      )}
    </AnimatePresence>
  );
}
