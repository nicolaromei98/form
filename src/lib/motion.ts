import type { Transition } from "motion/react";

/** Spring vocabulary — fluid, precise, slightly organic, never bouncy. */
export const springs = {
  layout: { type: "spring", stiffness: 380, damping: 38, mass: 1 } satisfies Transition,
  soft: { type: "spring", stiffness: 240, damping: 30, mass: 1 } satisfies Transition,
  snappy: { type: "spring", stiffness: 620, damping: 44, mass: 0.8 } satisfies Transition,
  blob: { type: "spring", stiffness: 210, damping: 21, mass: 1 } satisfies Transition,
  pill: { type: "spring", stiffness: 260, damping: 28, mass: 1 } satisfies Transition,
  /** Volumes trading places: a touch of overshoot so the material feels liquid */
  fluid: { type: "spring", stiffness: 150, damping: 19, mass: 1 } satisfies Transition,
};

export const ease = {
  out: [0.22, 1, 0.36, 1] as const,
  inOut: [0.65, 0, 0.35, 1] as const,
};

/** Creation choreography timing (seconds). Shared by agent + workspace. */
export const CREATE = {
  lead: 0.08, // blobs leave the body
  travel: 0.5, // blob flight to the card slot
  expand: 0.34, // circle → card silhouette
  stagger: 0.075, // reading order, card to card
  skin: 0.5, // ink skin cools into glass
};

export function createRevealAt(index: number) {
  return CREATE.lead + index * CREATE.stagger + CREATE.travel + CREATE.expand;
}

export const CREATE_TOTAL_MS = Math.round((createRevealAt(3) + CREATE.skin + 0.1) * 1000);

/** Minimum perceptible beat for local processing — no fake reasoning. */
export const PROCESS_BEAT_MS = 340;
