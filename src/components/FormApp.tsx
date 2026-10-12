"use client";

import { MotionConfig, useReducedMotion } from "motion/react";
import { useEffect, useSyncExternalStore } from "react";
import { useForm } from "@/lib/store";
import { springs } from "@/lib/motion";
import { AgentLayer } from "./agent/AgentLayer";
import { Workspace } from "./workspace/Workspace";
import { Chrome } from "./Chrome";

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");

export function FormApp() {
  const reduced = useReducedMotion();
  const setReduced = useForm((s) => s.setReducedMotion);
  const setEngine = useForm((s) => s.setEngine);

  useEffect(() => setReduced(!!reduced), [reduced, setReduced]);

  // Development-only handle for automated verification of the demo flow
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") (window as unknown as { __form: typeof useForm }).__form = useForm;
  }, []);

  // Engine discovery: use Claude only if the server says a key is configured
  useEffect(() => {
    fetch("/api/interpret")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.available && setEngine("claude"))
      .catch(() => {});
  }, [setEngine]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useForm.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z" && !isTyping(e.target)) {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (st.composerOpen) st.closeComposer();
        else st.openComposer();
        return;
      }
      if (isTyping(e.target)) return;
      if (e.key === "/") {
        e.preventDefault();
        st.openComposer();
      } else if (e.key === "Escape") {
        if (st.composerOpen) st.closeComposer();
        else if (st.selectedId) st.select(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <MotionConfig reducedMotion="user" transition={springs.layout}>
      <div className="ground" aria-hidden />
      <Chrome />
      <main
        className="relative z-10 min-h-screen"
        onClick={(e) => {
          // Only a click on empty space clears the Point & Ask selection
          if ((e.target as HTMLElement).closest("button, a, input, [data-interactive], [data-task-id], [role=menu], [role=switch], [role=tab]")) return;
          useForm.getState().select(null);
        }}
      >
        <h1 className="sr-only">FORM — a living workspace that turns intention into interactive tools</h1>
        <Workspace />
      </main>
      <AgentLayer />
    </MotionConfig>
  );
}

/** Client-only root: workspace state lives in localStorage, so render after mount. */
const noop = () => () => {};

export function ClientRoot() {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  if (!mounted) return <div className="ground" aria-hidden />;
  return <FormApp />;
}
