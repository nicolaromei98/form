"use client";

import gsap from "gsap";
import { SplitText } from "gsap/SplitText";
import { useGSAP } from "@gsap/react";
import { useEffect, useRef, useState, type ElementType } from "react";
import { useForm } from "@/lib/store";

gsap.registerPlugin(SplitText, useGSAP);

/**
 * FORM's single text motion, taken from the first screen:
 * words condense out of a blur with a slight zoom; mono eyebrows decode in place.
 * Every animated piece of text in the product uses these values.
 */
export const TEXT = {
  from: { autoAlpha: 0, filter: "blur(12px)", scale: 1.12 },
  to: { autoAlpha: 1, filter: "blur(0px)", scale: 1, duration: 0.9, ease: "power3.out" },
  stagger: 0.07,
  /** Blocks (rows, controls) zoom less than words */
  blockFrom: { autoAlpha: 0, filter: "blur(12px)", scale: 1.03 },
  out: { autoAlpha: 0, filter: "blur(10px)", duration: 0.4, ease: "power2.in" },
} as const;

/** Word reveal on any element — including contentEditable titles (split, animate, restore). */
export function revealWords(el: Element, opts: { delay?: number; from?: "start" | "center" } = {}) {
  const split = SplitText.create(el, { type: "words" });
  return gsap.fromTo(split.words, TEXT.from, {
    ...TEXT.to,
    delay: opts.delay ?? 0,
    stagger: { each: TEXT.stagger, from: opts.from ?? "start" },
    transformOrigin: "50% 60%",
    onComplete: () => split.revert(),
  });
}

export function revealBlocks(targets: gsap.TweenTarget, opts: { delay?: number } = {}) {
  return gsap.fromTo(targets, TEXT.blockFrom, { ...TEXT.to, delay: opts.delay ?? 0, stagger: TEXT.stagger });
}

/** Text whose words condense in. Re-runs whenever the text changes (remount by key). */
export function RevealText({
  text,
  className = "",
  delay = 0,
  from = "start",
  as: Tag = "span",
}: {
  text: string;
  className?: string;
  delay?: number;
  from?: "start" | "center";
  as?: ElementType;
}) {
  const ref = useRef<HTMLElement>(null);
  const reduced = useForm((s) => s.reducedMotion);
  const words = text.split(" ");
  useGSAP(
    () => {
      if (reduced || !ref.current) return;
      gsap.fromTo(ref.current.querySelectorAll("[data-w]"), TEXT.from, {
        ...TEXT.to,
        delay,
        stagger: { each: TEXT.stagger, from },
        transformOrigin: "50% 60%",
      });
    },
    { scope: ref },
  );
  return (
    <Tag ref={ref} className={className} aria-label={text}>
      {words.map((w, i) => (
        <span key={i} aria-hidden>
          <span data-w className="inline-block">
            {w}
          </span>
          {i < words.length - 1 && " "}
        </span>
      ))}
    </Tag>
  );
}

const GLYPHS = "/·+—×:01";
const NBSP = " ";

/** Mono eyebrow decodes left to right; width never changes, so nothing reflows. */
export function useDecode(text: string, delay: number, duration = 0.75) {
  const reduced = useForm((s) => s.reducedMotion);
  const [out, setOut] = useState(() => (reduced ? text : text.replace(/./g, NBSP)));
  useEffect(() => {
    let raf = 0;
    const start = performance.now() + delay * 1000;
    const span = (reduced ? 0 : duration) * 1000;
    const tick = (now: number) => {
      const p = span ? Math.min(1, Math.max(0, (now - start) / span)) : 1;
      const head = p * (text.length + 5);
      let s = "";
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === " ") s += NBSP;
        else if (i < head - 5 || p === 1) s += ch;
        else if (i < head) s += GLYPHS[(Math.random() * GLYPHS.length) | 0];
        else s += NBSP;
      }
      setOut(s);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, delay, duration, reduced]);
  return out;
}

export function DecodeText({ text, delay = 0, className = "" }: { text: string; delay?: number; className?: string }) {
  const out = useDecode(text, delay);
  return (
    <span className={`whitespace-pre ${className}`} aria-label={text}>
      <span aria-hidden>{out}</span>
    </span>
  );
}
