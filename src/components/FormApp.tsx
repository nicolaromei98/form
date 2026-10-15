"use client";

import { MotionConfig, useReducedMotion } from "motion/react";
import { useEffect, useSyncExternalStore } from "react";
import { useActions, useFormRuntime } from "@/lib/store/hooks";
import { move } from "@/lib/motion";
import { AgentLayer } from "./agent/AgentLayer";
import { Workspace } from "./workspace/Workspace";
import { Chrome } from "./Chrome";
import { Intro } from "./Intro";

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");

export function FormApp() {
  const reduced = useReducedMotion();
  const actions = useActions();

  // The store's runtime (plan §8.2): the view in the URL, today re-ticked at local midnight, a save
  // before the page goes away, and the `window.__form` handle outside production builds
  useFormRuntime();

  useEffect(() => actions.setReducedMotion(!!reduced), [reduced, actions]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Read at the moment of the key press, without subscribing the app's root to it
      const st = actions.peek();
      // The intro owns the keyboard while it's open
      if (st.intro) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z" && !isTyping(e.target)) {
        e.preventDefault();
        if (e.shiftKey) actions.redo();
        else actions.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (st.composerOpen) actions.closeComposer();
        else actions.openComposer();
        return;
      }
      if (isTyping(e.target)) return;
      if (e.key === "/") {
        e.preventDefault();
        actions.openComposer();
      } else if (e.key === "Escape") {
        if (st.composerOpen) actions.closeComposer();
        else if (st.selectedTaskId) actions.select(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actions]);

  return (
    <MotionConfig reducedMotion="user" transition={move}>
      <div className="ground" aria-hidden />
      <Chrome />
      <main
        className="relative z-10 min-h-screen"
        onClick={(e) => {
          // Only a click on empty space clears the Point & Ask selection
          if ((e.target as HTMLElement).closest("button, a, input, [data-interactive], [data-task-id], [role=menu], [role=switch], [role=tab]")) return;
          actions.select(null);
        }}
      >
        <h1 className="sr-only">FORM — a living workspace that turns intention into interactive tools</h1>
        <Workspace />
      </main>
      <AgentLayer />
      <Intro />
    </MotionConfig>
  );
}

/**
 * Client-only root: the demo lives in this browser's storage, so render after mount. The store
 * (lib/store) is created and hydrated by the first hook that reads it, inside this tree.
 */
const noop = () => () => {};

export function ClientRoot() {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  if (!mounted) return <div className="ground" aria-hidden />;
  return <FormApp />;
}
