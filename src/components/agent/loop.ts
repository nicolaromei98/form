"use client";

import { cancelFrame, frame, type FrameData } from "motion/react";
import { useEffect, useLayoutEffect, useState } from "react";

/*
 * The agent's animation loop, which sleeps once the material has settled (plan §9.1, AUDIT §11.2a,
 * DECISIONS Q26 and Q29).
 *
 * v0 ran Motion's useAnimationFrame for as long as the page was open: about 3,000 SVG attribute
 * writes per second at rest, also under reduced motion. This loop runs on the same Motion frame
 * loop, with the same time base (ms since its first frame) and the same frame delta, so while it
 * runs the fluid moves exactly as before. Its step returns true once the material is still; the
 * loop then schedules no more frames until something wakes it:
 *   - a change of `awake` (the agent passes a signature of its props);
 *   - wake(), which the agent calls for a pointer moving near it;
 *   - the tab becoming visible again, when the loop was running (or asked to) as it was hidden.
 * A hidden tab never runs it, and a disabled loop (reduced motion) never runs at all.
 */

/** Q29: the material breathes until 4 s after the last input, then the breath fades over 0.8 s. */
export const BREATH = { idle: 4, fade: 0.8 } as const;

/**
 * Plan §9.1: a volume is settled below these speeds and distances (px/s and px), and the material
 * once every volume has stayed settled for `hold` seconds.
 */
export const REST = { speed: 2, radiusSpeed: 1, distance: 0.25, hold: 0.5 } as const;

/** The pointer's influence radius at scale 1 (the fluid's surface-tension falloff, px). */
export const INFLUENCE = 220;

/** A pointer wakes the agent within 1.5 × the influence radius of its anchor (330 × scale px). */
export const WAKE_RADIUS = 1.5 * INFLUENCE;

/** Where the pointer's pull starts fading out, as a share of the wake radius. */
const REACH_FADE_START = 0.7;

/** Moves the breath level (0 to 1) toward its target at the fade rate. */
export function nextBreath(level: number, target: 0 | 1, dt: number): number {
  const step = dt / BREATH.fade;
  return target > level ? Math.min(target, level + step) : Math.max(target, level - step);
}

/** The breath's amplitude for a level: eased in and out, exactly 1 at full breath and 0 at rest. */
export function breathAmplitude(level: number): number {
  return level * level * (3 - 2 * level);
}

/**
 * The share of its pull a pointer keeps at `distance` px from the agent's anchor: all of it well
 * inside the wake radius, none beyond it. A pointer that can't wake the loop can't move the material
 * either, so a sleeping agent never holds a stale pull.
 */
export function pointerReach(distance: number, scale: number): number {
  const outer = WAKE_RADIUS * scale;
  const inner = outer * REACH_FADE_START;
  if (distance <= inner) return 1;
  if (distance >= outer) return 0;
  const x = (outer - distance) / (outer - inner);
  return x * x * (3 - 2 * x);
}

/** Whether a pointer at (x, y) is near enough to the anchor to wake the agent. */
export function nearAnchor(x: number, y: number, anchor: { x: number; y: number }, scale: number): boolean {
  return Math.hypot(x - anchor.x, y - anchor.y) <= WAKE_RADIUS * scale;
}

/** One frame: the time since the loop's first frame and the frame delta (ms). True once settled. */
export type LoopStep = (ms: number, deltaMs: number) => boolean;

export interface SettlingLoop {
  /**
   * The loop's clock (ms since its first frame): the last frame's time while it runs, as Motion's
   * useAnimationFrame gave it, and the current time while it sleeps. 0 before the first frame.
   */
  time(): number;
  /** Runs the loop if it sleeps. While the tab is hidden, the wake waits until it is visible. */
  wake(): void;
  /** Whether the loop is scheduling frames. */
  running(): boolean;
}

interface Loop extends SettlingLoop {
  setStep(step: LoopStep): void;
  setEnabled(enabled: boolean): void;
  sleep(): void;
  visibilityChanged(): void;
}

const tabHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

function createLoop(): Loop {
  let step: LoopStep = () => true;
  let enabled = true;
  let running = false;
  /** A frame has run since the last wake, so `last` is current */
  let ticked = false;
  /** The first frame's timestamp: the loop's time origin, kept across sleeps */
  let origin = 0;
  let last = 0;
  /** A wake that waits for the tab to be visible */
  let deferred = false;

  const tick = ({ timestamp, delta }: FrameData) => {
    if (!origin) origin = timestamp;
    last = timestamp - origin;
    ticked = true;
    if (step(last, delta)) loop.sleep();
  };

  const loop: Loop = {
    time: () => (running && ticked ? last : origin ? performance.now() - origin : 0),
    running: () => running,
    wake() {
      if (!enabled) return;
      if (tabHidden()) {
        deferred = true;
        return;
      }
      if (running) return;
      running = true;
      ticked = false;
      frame.update(tick, true);
    },
    sleep() {
      if (!running) return;
      running = false;
      cancelFrame(tick);
    },
    setStep(next) {
      step = next;
    },
    setEnabled(next) {
      enabled = next;
      if (next) return;
      deferred = false;
      loop.sleep();
    },
    visibilityChanged() {
      if (tabHidden()) {
        // Stop explicitly: some browsers keep a hidden tab's frames running for a while
        if (running) deferred = true;
        loop.sleep();
      } else if (deferred) {
        deferred = false;
        loop.wake();
      }
    },
  };
  return loop;
}

/**
 * A requestAnimationFrame loop the agent can put to sleep. `step` runs every frame while the loop
 * is awake and returns true once the material has settled; any change of `awake` wakes it; with
 * `enabled` false (reduced motion) it never runs.
 */
export function useSettlingLoop(step: LoopStep, { awake, enabled = true }: { awake: unknown; enabled?: boolean }): SettlingLoop {
  const [loop] = useState(createLoop);

  // The latest step, so it reads the latest props
  useLayoutEffect(() => loop.setStep(step));

  useEffect(() => {
    loop.setEnabled(enabled);
    loop.wake();
  }, [loop, enabled]);

  useEffect(() => loop.wake(), [loop, awake]);

  useEffect(() => {
    const onVisibility = () => loop.visibilityChanged();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      loop.sleep();
    };
  }, [loop]);

  return loop;
}
