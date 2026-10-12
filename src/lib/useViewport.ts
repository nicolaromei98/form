"use client";

import { useSyncExternalStore } from "react";

let cached = { w: 1440, h: 900 };

function read() {
  if (typeof window === "undefined") return cached;
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w !== cached.w || h !== cached.h) cached = { w, h };
  return cached;
}

function subscribe(cb: () => void) {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
}

export function useViewport() {
  return useSyncExternalStore(subscribe, read, () => cached);
}
