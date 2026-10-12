"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Button 069 (Osmo Supply) text effect, ported to React.
 * On hover — or keyboard focus-visible — the letters of each word rotate right
 * one step per tick until they're back in place. Same tokenizer, rotation,
 * speed and media query as the original; the text is React state, so React
 * stays the owner of the DOM.
 */

type Token = { type: "raw"; raw: string } | { type: "word"; letters: string; trailing: string };

const rotateRight = (s: string) => (s && s.length > 1 ? s.slice(-1) + s.slice(0, -1) : s);

function tokenize(text: string): Token[] {
  const parts = text.match(/\S+|\s+/g) || [];
  return parts.map((p) => {
    if (/^\s+$/.test(p)) return { type: "raw", raw: p };
    const m = p.match(/^([\p{L}'’]+)(.*)$/u);
    if (!m) return { type: "raw", raw: p };
    return { type: "word", letters: m[1], trailing: m[2] || "" };
  });
}

/** Elements whose hover drives the effect; `[data-hover]` lets a parent take over, as in the original. */
const HOVER_ROOT = "[data-hover], button, a, [role='switch'], [role='tab']";

export function ShuffleText({ text, speed = 46, className = "" }: { text: string; speed?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mq = window.matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
    if (!mq.matches) return;
    const root = el.parentElement?.closest<HTMLElement>(HOVER_ROOT) ?? el;
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
      setShown(null);
    };

    const start = () => {
      stop();
      const tokens = tokenize(text);
      const words = tokens.filter((t): t is Extract<Token, { type: "word" }> => t.type === "word");
      if (!words.length) return;
      const maxLen = words.reduce((m, t) => Math.max(m, t.letters.length), 0);
      let tick = 0;
      timer = setInterval(() => {
        for (const w of words) w.letters = rotateRight(w.letters);
        setShown(tokens.map((t) => (t.type === "word" ? t.letters + t.trailing : t.raw)).join(""));
        if (++tick >= maxLen) stop();
      }, speed);
    };

    const onEnter = () => start();
    const onLeave = () => {
      if (root.matches(":focus-visible")) return;
      stop();
    };
    const onFocusIn = () => {
      if (root.matches(":focus-visible")) start();
    };
    const onFocusOut = () => {
      if (root.matches(":hover")) return;
      stop();
    };

    root.addEventListener("pointerenter", onEnter);
    root.addEventListener("pointerleave", onLeave);
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    return () => {
      if (timer) clearInterval(timer);
      root.removeEventListener("pointerenter", onEnter);
      root.removeEventListener("pointerleave", onLeave);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
    };
  }, [text, speed]);

  // Kerning off (as in the original) so reordering the same letters never changes the width
  return (
    <span ref={ref} data-button-069-text="" className={`[font-kerning:none] [font-variant-ligatures:none] ${className}`}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>{shown ?? text}</span>
    </span>
  );
}
