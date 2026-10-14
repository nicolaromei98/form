"use client";

import { useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from "react";
import { normaliseHex } from "@/lib/mood";
import { ShuffleText } from "../text/ShuffleText";

/**
 * FORM's own colour picker, replacing the browser's native one so the
 * moodboard keeps one material: a saturation/brightness field, a hue capsule,
 * hex entry, an eyedropper where the browser has one, and a studio palette.
 */

type HSV = { h: number; s: number; v: number };

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

function hsvToHex({ h, s, v }: HSV) {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };
  return `#${[f(5), f(3), f(1)].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

function hexToHsv(hex: string): HSV | null {
  const n = normaliseHex(hex);
  if (!n) return null;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

/** A studio palette to start from */
const PRESETS = ["#0c0c0c", "#f2efe8", "#c65d3b", "#d4a017", "#9caf88", "#2a8c86", "#1f2a44", "#c3aed6"];

interface EyeDropperCtor {
  new (): { open: () => Promise<{ sRGBHex: string }> };
}

export function ColorPicker({ onAdd }: { onAdd: (hex: string, name: string | null) => void }) {
  const [hsv, setHsv] = useState<HSV>(() => hexToHsv("#c8b8a6")!);
  const [draft, setDraft] = useState<string | null>(null);
  const [name, setName] = useState("");
  const hex = hsvToHex(hsv);
  const dropper = typeof window !== "undefined" ? (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper : undefined;

  const pick = (value: string) => {
    const next = hexToHsv(value);
    if (next) setHsv(next);
  };
  const add = () => onAdd(hex, name.trim() || null);

  /** Pointer drag on a field: x/y as 0–1 within its box, captured so it keeps tracking outside */
  const track = (update: (x: number, y: number) => void) => (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    el.focus({ preventScroll: true });
    const apply = (ev: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      update(clamp((ev.clientX - r.left) / r.width), clamp((ev.clientY - r.top) / r.height));
    };
    apply(e);
    const onMove = (ev: PointerEvent) => apply(ev);
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  };

  /** Arrow keys nudge the fields: 1%, or 10% with Shift */
  const nudge = (axis: "sv" | "h") => (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    const dx = e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
    const dy = e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    setHsv((c) => (axis === "h" ? { ...c, h: (c.h + (dx + dy) * 360 + 360) % 360 } : { ...c, s: clamp(c.s + dx), v: clamp(c.v + dy) }));
  };

  return (
    <div className="flex w-[264px] flex-col gap-3 p-2" onKeyDown={(e) => e.key === "Enter" && !(e.target instanceof HTMLButtonElement) && add()}>
      {/* Saturation → right, brightness → up, over the current hue */}
      <div
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.s * 100)}
        aria-valuetext={hex.toUpperCase()}
        onPointerDown={track((x, y) => setHsv((c) => ({ ...c, s: x, v: 1 - y })))}
        onKeyDown={nudge("sv")}
        className="focus-ring relative h-[150px] w-full cursor-crosshair touch-none rounded-[16px]"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hsv.h} 100% 50%)` }}
      >
        <span
          className="pointer-events-none absolute h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_1px_6px_rgba(0,0,0,0.35)]"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }}
        />
      </div>

      <div
        role="slider"
        tabIndex={0}
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        onPointerDown={track((x) => setHsv((c) => ({ ...c, h: x * 359.9 })))}
        onKeyDown={nudge("h")}
        className="focus-ring relative mx-[9px] h-[14px] cursor-pointer touch-none rounded-full"
        style={{ background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" }}
      >
        <span
          className="pointer-events-none absolute top-1/2 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_1px_6px_rgba(0,0,0,0.35)]"
          style={{ left: `${(hsv.h / 360) * 100}%`, background: `hsl(${hsv.h} 100% 50%)` }}
        />
      </div>

      <div className="flex items-center gap-1.5">
        <span className="h-[34px] w-[34px] shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]" style={{ background: hex }} />
        <label className="flex h-[34px] min-w-0 flex-1 items-center gap-1 rounded-full bg-black/[0.05] px-3 focus-within:bg-black/[0.08] focus-within:shadow-[0_0_0_1px_var(--line-strong)]">
          <span className="t-data text-text-3">#</span>
          <input
            aria-label="Hex colour"
            value={draft ?? hex.slice(1).toUpperCase()}
            maxLength={6}
            spellCheck={false}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9a-f]/gi, "").toUpperCase();
              setDraft(v);
              if (v.length === 6 || v.length === 3) pick(v);
            }}
            onBlur={() => setDraft(null)}
            className="t-data w-full min-w-0 bg-transparent tracking-[0.04em] text-text uppercase outline-none"
          />
        </label>
        {dropper && (
          <button
            type="button"
            aria-label="Pick a colour from the screen"
            onClick={() =>
              new dropper()
                .open()
                .then((r) => pick(r.sRGBHex))
                .catch(() => {})
            }
            className="focus-ring grid h-[34px] w-[34px] shrink-0 cursor-pointer place-items-center rounded-full text-text-2 transition-colors hover:bg-black/[0.05] hover:text-text"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M10.2 2.6a1.9 1.9 0 012.7 2.7l-1.5 1.5-2.7-2.7 1.5-1.5zM8.7 4.1l3.2 3.2M9.6 6.4l-5.5 5.5-1.6.5.5-1.6 5.5-5.5" />
            </svg>
          </button>
        )}
      </div>

      <div className="flex items-center justify-between px-0.5">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            aria-label={`Use ${p}`}
            onClick={() => pick(p)}
            className={`focus-ring h-[24px] w-[24px] cursor-pointer rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)] transition-[scale] hover:scale-110 ${
              p === hex ? "ring-[1.5px] ring-ink ring-offset-2 ring-offset-[var(--glass-hi)]" : ""
            }`}
            style={{ background: p }}
          />
        ))}
      </div>

      <div className="flex items-center gap-1.5 border-t border-line pt-3">
        <input
          aria-label="Colour name"
          placeholder="Name, optional"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          className="t-body-s h-[34px] min-w-0 flex-1 rounded-full bg-black/[0.05] px-3 text-text outline-none placeholder:text-text-3! focus:bg-black/[0.08] focus:shadow-[0_0_0_1px_var(--line-strong)]"
        />
        <button
          type="button"
          onClick={add}
          className="focus-ring t-body-s h-[34px] shrink-0 cursor-pointer rounded-full bg-ink px-4 text-on-ink transition-transform hover:scale-[1.02]"
        >
          <ShuffleText text="Add" />
        </button>
      </div>
    </div>
  );
}
