"use client";

import { useIsCreating } from "@/lib/store/hooks";
import { createRevealAt } from "@/lib/motion";

/**
 * When a tool is being created, each task surface waits for the agent volume
 * that flies to its slot. Returns the reveal delay (s) or null.
 */
export function useReveal(spawnIndex: number | null): number | null {
  const creating = useIsCreating();
  if (!creating || spawnIndex == null) return null;
  return createRevealAt(spawnIndex);
}

/** Header/meta blocks emerge after the surfaces settle. */
export function useBlockReveal(): number | null {
  const creating = useIsCreating();
  return creating ? createRevealAt(3) + 0.1 : null;
}
