"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { applyOperations } from "./ops";
import { emptyDoc } from "./seed";
import { claudeInterpreter, demoInterpreter, type EngineId } from "./interpret";
import { interpretDemo } from "./interpret/demo";
import { CREATE_TOTAL_MS, PROCESS_BEAT_MS } from "./motion";
import { addedView, addedViews, announceView, migrateViews } from "./views";
import {
  DocSchema,
  OperationListSchema,
  type Doc,
  type Interpretation,
  type Operation,
  type Representation,
  type Task,
} from "./schema";

export type Phase = "rest" | "processing" | "creating";
export type FxKind = "create" | "shift" | "reflow" | "edit" | "restore";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Caption {
  id: number;
  text: string;
  tone: Interpretation["tone"] | "info";
  undoable: boolean;
}

export interface Fx {
  kind: FxKind;
  seq: number;
  from: Representation | null;
  /** The view this change created (its tab grows in), if any */
  added: Representation | null;
}

interface LogEntry {
  at: number;
  label: string;
  source: "agent" | "direct";
}

const HISTORY_LIMIT = 60;

interface FormState {
  /* semantic + representation state (persisted) */
  doc: Doc;
  log: LogEntry[];

  /* history (session) */
  past: Doc[];
  future: Doc[];

  /* interaction + agent state (transient) */
  selectedId: string | null;
  composerOpen: boolean;
  phase: Phase;
  caption: Caption | null;
  fx: Fx;
  spawn: Rect[] | null;
  engine: EngineId;
  commandHistory: string[];
  reducedMotion: boolean;
  /** The "about this project" intro over the workspace */
  intro: boolean;

  /* actions */
  /** engine overrides the chosen engine for this command (agent nodes run canned, demo-routable phrases) */
  submit: (command: string, opts?: { engine?: EngineId }) => Promise<boolean>;
  commit: (ops: Operation[], label: string, source?: LogEntry["source"], extra?: Partial<FormState>) => void;
  checkpoint: () => void;
  live: (ops: Operation[]) => void;
  updateTask: (id: string, patch: Partial<Task>, opts?: { history?: boolean }) => void;
  setRepresentation: (r: Representation) => void;
  resolveProposal: (accept: boolean) => void;
  resolvePlan: (accept: boolean) => void;
  select: (id: string | null) => void;
  openComposer: () => void;
  closeComposer: () => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
  dismissCaption: () => void;
  setSpawn: (rects: Rect[] | null) => void;
  setEngine: (e: EngineId) => void;
  setReducedMotion: (v: boolean) => void;
  setIntro: (open: boolean) => void;
}

let captionId = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fxFor(ops: Operation[], prev: Doc, next: Doc, seq: number): Fx {
  const added = addedView(prev, next);
  if (ops.some((o) => o.op === "createProject")) return { kind: "create", seq, from: null, added: null };
  if (
    ops.some(
      (o) =>
        (o.op === "setRepresentation" && o.representation !== prev.view.representation) ||
        // Closing the view on screen hands over to its neighbour
        (o.op === "removeView" && o.representation === prev.view.representation),
    )
  )
    return { kind: "shift", seq, from: prev.view.representation, added };
  if (ops.some((o) => o.op === "setView" || o.op === "setFields" || o.op === "addBlock" || o.op === "removeBlock"))
    return { kind: "reflow", seq, from: prev.view.representation, added };
  return { kind: "edit", seq, from: prev.view.representation, added };
}

export const useForm = create<FormState>()(
  persist(
    (set, get) => ({
      doc: emptyDoc(),
      log: [],
      past: [],
      future: [],
      selectedId: null,
      composerOpen: false,
      phase: "rest",
      caption: null,
      fx: { kind: "edit", seq: 0, from: null, added: null },
      spawn: null,
      engine: "demo",
      commandHistory: [],
      reducedMotion: false,
      intro: false,

      async submit(command, opts) {
        const text = command.trim();
        // Only an in-flight interpretation blocks input; creation choreography never does
        if (!text || get().phase === "processing") return false;
        set({ phase: "processing", caption: null, spawn: null });

        const t0 = performance.now();
        const ctx = { doc: get().doc, selectedId: get().selectedId };
        let result: Interpretation;
        let fellBack = false;
        try {
          result = await ((opts?.engine ?? get().engine) === "claude" ? claudeInterpreter : demoInterpreter).interpret(text, ctx);
        } catch {
          result = interpretDemo(text, ctx);
          fellBack = get().engine === "claude";
        }

        // A short, honest beat so the shape change reads — no fake reasoning.
        const beat = get().reducedMotion ? 0 : PROCESS_BEAT_MS;
        const elapsed = performance.now() - t0;
        if (elapsed < beat) await sleep(beat - elapsed);

        set((st) => ({ commandHistory: [text, ...st.commandHistory.filter((c) => c !== text)].slice(0, 20) }));

        if (result.control) {
          if (result.control === "undo") get().undo();
          if (result.control === "redo") get().redo();
          if (result.control === "reset") get().reset();
          set({ phase: "rest", composerOpen: false, caption: { id: ++captionId, text: result.message, tone: "info", undoable: result.control === "reset" } });
          return true;
        }

        const parsed = OperationListSchema.safeParse(result.ops);
        if (!parsed.success) {
          set({ phase: "rest", caption: { id: ++captionId, text: "The response didn't match FORM's operation schema — nothing changed.", tone: "unsupported", undoable: false } });
          return false;
        }

        const ops = parsed.data;
        const creating = ops.some((o) => o.op === "createProject");
        const ok = result.tone === "done" || result.tone === "proposal";
        const suffix = fellBack ? " · Claude unavailable, demo parser used" : "";
        const nextDoc = ops.length ? applyOperations(get().doc, ops) : get().doc;
        const keep = (id: string | null | undefined) => (id && nextDoc.tasks[id] ? id : null);

        // One atomic update: the new document and the agent phase render together,
        // so freshly created surfaces mount already knowing they must wait for the agent.
        get().commit(ops, text, "agent", {
          phase: creating && !get().reducedMotion ? "creating" : "rest",
          composerOpen: !ok,
          // Any engine: a command that created a view says so ("Team view added · …")
          caption: { id: ++captionId, text: announceView(result.message, addedViews(get().doc, nextDoc)) + suffix, tone: result.tone, undoable: ops.length > 0 },
          // Point & Ask: selection is explicit — commands never select on their own
          selectedId: creating ? null : keep(get().selectedId),
        });
        if (creating && !get().reducedMotion) {
          const seq = get().fx.seq;
          setTimeout(() => {
            if (get().phase === "creating" && get().fx.seq === seq) set({ phase: "rest", spawn: null });
          }, CREATE_TOTAL_MS);
        }
        return ok;
      },

      commit(ops, label, source = "direct", extra) {
        const prev = get().doc;
        const next = ops.length ? applyOperations(prev, ops) : prev;
        if (next === prev) {
          if (extra) set(extra);
          return;
        }
        set((st) => ({
          ...extra,
          doc: next,
          past: [...st.past, prev].slice(-HISTORY_LIMIT),
          future: [],
          fx: fxFor(ops, prev, next, st.fx.seq + 1),
          log: [{ at: Date.now(), label, source }, ...st.log].slice(0, 40),
        }));
      },

      checkpoint() {
        set((st) => ({ past: [...st.past, st.doc].slice(-HISTORY_LIMIT), future: [] }));
      },

      live(ops) {
        set((st) => ({ doc: applyOperations(st.doc, ops) }));
      },

      updateTask(id, patch, opts) {
        const op: Operation = { op: "updateTask", id, patch };
        if (opts?.history === false) get().live([op]);
        else get().commit([op], "edit", "direct");
      },

      setRepresentation(r) {
        // Tabs only switch between created views; creating one goes through the agent
        if (get().doc.view.representation === r || !get().doc.tool?.views.includes(r)) return;
        get().commit([{ op: "setRepresentation", representation: r }], `view → ${r}`, "direct");
      },

      resolveProposal(accept) {
        const p = get().doc.proposal;
        if (!p) return;
        const parent = get().doc.tasks[p.parentId];
        get().commit([{ op: accept ? "acceptProposal" : "discardProposal" }], accept ? "accept steps" : "discard steps", "direct", {
          caption: {
            id: ++captionId,
            text: accept ? `${p.items.length} steps added to ${parent?.title ?? "the task"}` : "Proposal discarded",
            tone: "done",
            undoable: true,
          },
        });
      },

      resolvePlan(accept) {
        const plan = get().doc.plan;
        if (!plan) return;
        const n = plan.moves.length;
        get().commit([{ op: accept ? "acceptReassign" : "discardReassign" }], accept ? "rebalance team" : "discard plan", "direct", {
          caption: {
            id: ++captionId,
            text: accept ? `${n} task${n > 1 ? "s" : ""} reassigned` : "Plan discarded · nothing moved",
            tone: "done",
            undoable: true,
          },
        });
      },

      select(id) {
        set({ selectedId: id && get().doc.tasks[id] ? id : null });
      },

      openComposer() {
        if (get().phase === "processing") return;
        set({ composerOpen: true, ...(get().phase === "creating" ? { phase: "rest" as Phase, spawn: null } : {}) });
      },

      closeComposer() {
        set({ composerOpen: false });
      },

      undo() {
        const { past, doc, future, fx } = get();
        if (!past.length) return;
        const prev = past[past.length - 1];
        set({
          doc: prev,
          past: past.slice(0, -1),
          future: [doc, ...future].slice(0, HISTORY_LIMIT),
          fx: { kind: "restore", seq: fx.seq + 1, from: doc.view.representation, added: addedView(doc, prev) },
          selectedId: get().selectedId && prev.tasks[get().selectedId!] ? get().selectedId : null,
        });
      },

      redo() {
        const { past, doc, future, fx } = get();
        if (!future.length) return;
        const next = future[0];
        set({
          doc: next,
          past: [...past, doc].slice(-HISTORY_LIMIT),
          future: future.slice(1),
          fx: { kind: "restore", seq: fx.seq + 1, from: doc.view.representation, added: addedView(doc, next) },
          selectedId: get().selectedId && next.tasks[get().selectedId!] ? get().selectedId : null,
        });
      },

      reset() {
        const { doc, past, fx } = get();
        set({
          doc: emptyDoc(),
          past: doc.tool ? [...past, doc].slice(-HISTORY_LIMIT) : past,
          future: [],
          selectedId: null,
          composerOpen: false,
          phase: "rest",
          spawn: null,
          fx: { kind: "restore", seq: fx.seq + 1, from: null, added: null },
        });
      },

      dismissCaption() {
        set({ caption: null });
      },

      setSpawn(rects) {
        set({ spawn: rects });
      },

      setEngine(e) {
        set({ engine: e });
      },

      setReducedMotion(v) {
        set({ reducedMotion: v });
      },

      setIntro(open) {
        set(open ? { intro: true, composerOpen: false } : { intro: false });
      },
    }),
    {
      name: "form.workspace.v1",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (st) => ({ doc: st.doc, log: st.log }),
      merge: (persisted, current) => {
        const p = persisted as Partial<FormState> | undefined;
        const ok = p?.doc ? DocSchema.safeParse(p.doc) : null;
        return { ...current, doc: ok?.success ? migrateViews(p!.doc, ok.data) : current.doc, log: Array.isArray(p?.log) ? p!.log! : current.log };
      },
    },
  ),
);
