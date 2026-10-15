import type { Tier } from "@/lib/interpret/fast/context";
import { normalise } from "@/lib/interpret/fast/match";

/**
 * Confidence tiers (Q17, plan §1.3), computed now and used from Phase 5, where a command below the
 * threshold goes to Claude. /demo applies every match (threshold 0).
 *
 * - **1.0**: the command is exactly a palette phrase (after normalisation), or a control word;
 * - **0.9**: an anchored template matched the whole command ("Remove the board", "Accept them");
 * - **0.5**: a keyword rule found its words somewhere in the command.
 */

export type Confidence = 1 | 0.9 | 0.5;

/** /demo applies every match (Q19 waits for Phase 5) */
export const DEMO_THRESHOLD = 0;

/**
 * A palette phrase as the parser compares it: v0's normalisation, in lower case. The caller builds
 * `FastContext.palette` with it from the registry's palette (`paletteEntries()`), so the parser
 * never holds a copy of the phrases.
 */
export function paletteKey(phrase: string): string {
  return normalise(phrase).s;
}

export function confidenceOf(s: string, palette: ReadonlySet<string>, tier: Tier): Confidence {
  if (palette.has(s)) return 1;
  return tier === "anchored" ? 0.9 : 0.5;
}
