"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useForm } from "@/lib/store";
import { ease } from "@/lib/motion";
import { useViewport } from "@/lib/useViewport";
import type { Capsule, Circle } from "./geometry";
import { suggestionsFor } from "./suggestions";
import { CommandSheet } from "./CommandSheet";
import { ShuffleText } from "../text/ShuffleText";

/** Clicks on these never dismiss the composer: they are the workspace being used. */
const WORKSPACE_TARGET = "button, a, input, [contenteditable], [data-interactive], [data-task-id], [role=menu], [role=switch], [role=tab]";

interface Props {
  open: boolean;
  frame: { body: Capsule; satellite: Circle };
  placement: "center" | "dock";
}

export function Composer({ open, frame, placement }: Props) {
  const { h: vh } = useViewport();
  const doc = useForm((s) => s.doc);
  const selectedId = useForm((s) => s.selectedId);
  const phase = useForm((s) => s.phase);
  const history = useForm((s) => s.commandHistory);
  const submit = useForm((s) => s.submit);
  const close = useForm((s) => s.closeComposer);
  const select = useForm((s) => s.select);

  const [value, setValue] = useState("");
  const [sheet, setSheet] = useState(false);
  const [histIdx, setHistIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const satRef = useRef<HTMLButtonElement>(null);
  const assistRef = useRef<HTMLDivElement>(null);
  const sheetOpen = useRef(sheet);
  const [wasOpen, setWasOpen] = useState(open);

  // Reset transient UI when the composer closes (render-phase reset, no effect)
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setSheet(false);
      setHistIdx(-1);
    }
  }

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 160);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    sheetOpen.current = sheet;
  }, [sheet]);

  // Click outside: first dismisses the command sheet, then the composer itself (on empty space only)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if ([pillRef, satRef, assistRef].some((r) => r.current?.contains(t))) return;
      if (sheetOpen.current) {
        setSheet(false);
        return;
      }
      if (t.closest(WORKSPACE_TARGET)) return;
      close();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open, close]);

  const selected = selectedId ? doc.tasks[selectedId] : null;
  const suggestions = suggestionsFor(doc, selectedId);
  const busy = phase !== "rest";

  async function run(text: string) {
    if (!text.trim() || busy) return;
    setSheet(false);
    const ok = await submit(text);
    if (ok) setValue("");
    else requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (sheet) setSheet(false);
      else close();
    } else if (e.key === "ArrowUp" && history.length) {
      e.preventDefault();
      const i = Math.min(history.length - 1, histIdx + 1);
      setHistIdx(i);
      setValue(history[i]);
    } else if (e.key === "ArrowDown" && histIdx >= 0) {
      e.preventDefault();
      const i = histIdx - 1;
      setHistIdx(i);
      setValue(i >= 0 ? history[i] : "");
    } else if (e.key === "Tab" && !value && suggestions[0]) {
      e.preventDefault();
      setValue(suggestions[0]);
    }
  }

  const { body, satellite } = frame;
  const below = placement === "center";
  const placeholder = selected ? `Ask about ${selected.title}` : doc.tool ? "Change the workspace" : "Describe what you need";

  return (
    <AnimatePresence>
      {open && (
        <motion.div key="composer-root" className="contents" exit={{ opacity: 1 }}>
          {/* Material layer: the Ask AI surface "cures" over the goo silhouette */}
          <motion.div
            key="composer"
            ref={pillRef}
            className="fixed z-50"
            style={{ left: body.x, top: body.y, width: body.w, height: body.h }}
            initial={{ opacity: 0 }}
            // The crisp surface "cures" only once the fluid has settled into the capsule
            animate={{ opacity: busy ? 0 : 1, transition: { delay: busy ? 0 : 0.38, duration: busy ? 0.12 : 0.3, ease: ease.out } }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
          >
            <div className="ink-material absolute inset-0 rounded-full" />
            <form
              className="relative flex h-full items-center gap-1 px-[11px]"
              onSubmit={(e) => {
                e.preventDefault();
                run(value);
              }}
            >
              <button
                type="button"
                aria-label={sheet ? "Hide commands" : "Show commands"}
                aria-expanded={sheet}
                onClick={() => setSheet((v) => !v)}
                // Active state is a lit surface, not a rotated "×" — the satellite already means close
                className={`focus-ring-ink grid h-[46px] w-[46px] shrink-0 cursor-pointer place-items-center rounded-full transition-colors ${
                  sheet ? "bg-white/[0.12] text-on-ink" : "text-on-ink-2 hover:bg-white/[0.06] hover:text-on-ink"
                }`}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                  <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </button>

              <AnimatePresence initial={false}>
                {selected && (
                  <motion.button
                    key="ctx"
                    type="button"
                    layout
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    onClick={() => select(null)}
                    aria-label={`Remove ${selected.title} from context`}
                    className="focus-ring-ink group flex h-[32px] max-w-[42%] shrink-0 cursor-pointer items-center gap-2 rounded-full bg-white/[0.09] pr-2 pl-2.5 text-on-ink"
                  >
                    <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-on-ink" />
                    <span className="t-body-s truncate">{selected.title}</span>
                    <svg width="10" height="10" viewBox="0 0 10 10" className="shrink-0 opacity-50 group-hover:opacity-100" aria-hidden>
                      <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                  </motion.button>
                )}
              </AnimatePresence>

              <input
                ref={inputRef}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setHistIdx(-1);
                }}
                onKeyDown={onKey}
                disabled={busy}
                placeholder={placeholder}
                aria-label="Command"
                autoComplete="off"
                spellCheck={false}
                className="t-body-l min-w-0 flex-1 bg-transparent px-1.5 text-on-ink caret-on-ink max-sm:text-[15px]"
              />

              <AnimatePresence initial={false}>
                {value && (
                  <motion.button
                    key="clear"
                    type="button"
                    aria-label="Clear"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => {
                      setValue("");
                      inputRef.current?.focus();
                    }}
                    className="focus-ring-ink t-body-s shrink-0 cursor-pointer rounded-full px-3 py-2 text-on-ink-3 transition-colors hover:text-on-ink-2"
                  >
                    <ShuffleText text="Clear" />
                  </motion.button>
                )}
              </AnimatePresence>

              <button
                type="submit"
                aria-label="Send"
                disabled={!value.trim() || busy}
                // Empty: a quiet glyph on the surface. Ready: the only white volume in the capsule.
                className={`focus-ring-ink grid h-[46px] w-[46px] shrink-0 cursor-pointer place-items-center rounded-full transition-[background-color,color,transform] duration-300 disabled:cursor-default ${
                  value.trim() ? "bg-on-ink text-ink hover:scale-[1.04]" : "bg-transparent text-on-ink-3"
                }`}
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </form>
          </motion.div>

          {/* Satellite: the volume that detached becomes "close" */}
          <motion.button
            key="close"
            ref={satRef}
            type="button"
            aria-label="Close composer"
            onClick={close}
            className="focus-ring-ink ink-material fixed z-50 grid cursor-pointer place-items-center rounded-full text-on-ink-2 transition-colors hover:text-on-ink"
            style={{ left: satellite.cx - satellite.r, top: satellite.cy - satellite.r, width: satellite.r * 2, height: satellite.r * 2 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: busy ? 0 : 1, transition: { delay: busy ? 0 : 0.5, duration: 0.3 } }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
          >
            <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden>
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
            </svg>
          </motion.button>

          {/* Suggestions / command sheet — aligned to the field, not to field + close */}
          <motion.div
            key="assist"
            ref={assistRef}
            className={`fixed z-50 flex flex-col items-center ${below ? "" : "flex-col-reverse"}`}
            style={below ? { left: body.x, width: body.w, top: body.y + body.h + 14 } : { left: body.x, width: body.w, bottom: vh - body.y + 14 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: busy ? 0 : 1, transition: { delay: busy ? 0 : 0.42, duration: 0.2 } }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
          >
            <AnimatePresence mode="wait" initial={false}>
              {sheet ? (
                <CommandSheet
                  key="sheet"
                  query={value}
                  hasTool={!!doc.tool}
                  hasSelection={!!selected}
                  origin={below ? "top" : "bottom"}
                  maxHeight={Math.max(240, below ? vh - (body.y + body.h + 14) - 24 : body.y - 14 - 84)}
                  onRun={run}
                  onClose={() => {
                    setSheet(false);
                    inputRef.current?.focus({ preventScroll: true });
                  }}
                />
              ) : (
                <motion.div key="chips" className="flex w-full flex-wrap justify-center gap-1.5" exit={{ opacity: 0, transition: { duration: 0.1 } }}>
                  {suggestions.map((s, i) => (
                    <motion.button
                      key={s}
                      type="button"
                      onClick={() => run(s)}
                      disabled={busy}
                      initial={{ opacity: 0, filter: "blur(12px)", scale: 1.06 }}
                      animate={{ opacity: 1, filter: "blur(0px)", scale: 1, transition: { delay: 0.46 + i * 0.07, duration: 0.9, ease: ease.out } }}
                      className="focus-ring t-body-s h-[32px] cursor-pointer rounded-full bg-white/60 px-3.5 text-text-2 shadow-[0_0_0_1px_rgba(10,10,10,0.05)] backdrop-blur-md transition-colors hover:bg-white/90 hover:text-text"
                    >
                      <ShuffleText text={s} />
                    </motion.button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
