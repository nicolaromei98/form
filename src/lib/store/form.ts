import { createStore, type StoreApi } from "zustand/vanilla";
import { setAssetAliases } from "@/lib/assets";
import { isIanaZone } from "@/lib/domain/dates";
import { type Minter, nanoMinter } from "@/lib/domain/ids";
import { HISTORY_LIMIT } from "@/lib/domain/limits";
import type { DemoEnvelope } from "@/lib/domain/schema/demo";
import type { ProjectId, TaskId } from "@/lib/domain/schema/ids";
import { defaultLocalViewState, type LocalViewState } from "@/lib/domain/schema/local";
import type { IsoDate, Timestamp, ViewKind } from "@/lib/domain/schema/primitives";
import type { ProjectDoc } from "@/lib/domain/schema/project";
import { type DemoLoadKind, type DemoStorage, loadDemo } from "@/lib/demo/storage";
import { fastParse, toCommand } from "@/lib/interpret/fast";
import { CREATE_TOTAL_MS, PROCESS_BEAT_MS } from "@/lib/motion";
import type { Caption } from "@/lib/ops/caption";
import type { LocalIntent } from "@/lib/ops/local-intents";
import { NOTICE_TEXT } from "@/lib/ops/notices";
import type { Op } from "@/lib/ops/registry";
import {
  beginGesture,
  type CommandResult,
  type DocsState,
  endGesture,
  type EngineCtx,
  type Gesture,
  type HistoryEntry,
  historyEntry,
  landing,
  liveGesture,
  parserContext,
  redo as redoEntry,
  resolveProject,
  run,
  undo as undoEntry,
  type Where,
} from "@/lib/store/engine";
import { type Fx, fxFor, INITIAL_FX, type Rect, restoreFx, shiftFx } from "@/lib/store/fx";
import { attachPersistence, type Persistence } from "@/lib/store/persist";
import { FALLBACK_ZONE, todayFor } from "@/lib/store/today";
import { initialView } from "@/lib/store/view-url";

/**
 * The /demo store (plan §8.1): Zustand over the engine. It holds the documents, the open project
 * and its local view state, the history, the gesture, and the session state of the agent (phase,
 * caption, fx, composer). Every write goes through `run` (the command runner with the real
 * planning engine) or the engine's undo, redo and gesture functions; this file adds no document
 * logic of its own.
 *
 * Only `hooks.ts` and `actions.ts` import it (lint-enforced): components read through hooks and
 * change data through the action creators.
 */

export type Phase = "rest" | "processing" | "creating";

export interface StoreCaption extends Caption {
  /** Grows with every caption, so the same text twice still animates */
  id: number;
}

export interface CommitMeta {
  /** The history entry's label */
  label: string;
  /** Default false: a direct edit shows no caption unless something was refused or a proposal resolved (v0 parity) */
  caption?: boolean;
  /** Local intents to apply after the ops (show, select, zoom) */
  local?: readonly LocalIntent[];
  /** Default "direct" */
  source?: "direct" | "agent";
}

export interface FormState {
  /* Documents and where the user is (saved in the demo envelope) */
  docs: DocsState;
  activeProjectId: ProjectId | null;
  local: LocalViewState;
  /** Today in the workspace's time zone, re-ticked at local midnight */
  today: IsoDate;
  /** "{n} changes · saved locally": one per history entry */
  changes: number;
  notices: DemoEnvelope["notices"];
  assetAliases: DemoEnvelope["assetAliases"];
  migratedFrom: DemoEnvelope["migratedFrom"];

  /* History (session) */
  past: readonly HistoryEntry[];
  future: readonly HistoryEntry[];
  gesture: Gesture | null;

  /* The agent and the page (session) */
  composerOpen: boolean;
  phase: Phase;
  caption: StoreCaption | null;
  fx: Fx;
  spawn: Rect[] | null;
  commandHistory: string[];
  reducedMotion: boolean;
  intro: boolean;

  /* Actions */
  /** Parses and runs a typed command after the 340 ms beat; true when it was accepted */
  submit(text: string): Promise<boolean>;
  /** Runs ops as one command and one history entry (direct edits) */
  commit(ops: readonly Op[], meta: CommitMeta): CommandResult;
  beginGesture(): void;
  /** One live frame: recomputed from the gesture's base; sealed after 400 ms without a frame */
  live(ops: readonly Op[]): void;
  endGesture(): void;
  /** Drops the gesture and restores its base */
  cancelGesture(): void;
  /** A tab: local only, never history (Q6) */
  showView(view: ViewKind): void;
  /** Point & Ask: local only */
  select(id: TaskId | null): void;
  resolveProposal(accept: boolean, only?: readonly string[]): void;
  undo(): boolean;
  redo(): boolean;
  /** Deletes the open project: undoable, "Workspace reset" */
  reset(): boolean;
  openComposer(): void;
  closeComposer(): void;
  dismissCaption(): void;
  setSpawn(rects: Rect[] | null): void;
  setReducedMotion(v: boolean): void;
  setIntro(open: boolean): void;
  tick(today: IsoDate): void;
  /** Saves now if a save is pending */
  flushSave(): void;
}

/** What the store needs from the outside world: injected, so tests run it on a fixed clock */
export interface FormDeps {
  /** localStorage, or null (server render, blocked storage, tests that don't save) */
  storage: DemoStorage | null;
  /** Milliseconds since the epoch */
  now: () => number;
  /** Commit and group ids (uuids) */
  newId: () => string;
  /** Entity ids for parsed commands and action creators */
  mint: Minter;
  /** The browser's IANA zone, for a new demo workspace */
  timezone: () => string;
  /** `location.search` when the store hydrates (`?view=`) */
  search: () => string;
  /** Start from these documents instead of storage (tests, the property suite); nothing is saved */
  initial?: { docs: DocsState; activeProjectId: ProjectId | null; local?: LocalViewState };
  /** The persistence debounce (default 250 ms) */
  saveDebounceMs?: number;
}

export interface FormStore extends StoreApi<FormState> {
  readonly deps: FormDeps;
  /** How the demo was loaded */
  readonly loaded: DemoLoadKind | "initial";
  readonly persistence: Persistence;
}

/** A sealed gesture's quiet time: a drag with no frame for this long is over (plan §5.8) */
export const GESTURE_IDLE_MS = 400;
/** Typed commands kept for the composer's history */
const COMMAND_HISTORY = 20;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const projectOf = (docs: DocsState, id: ProjectId | null): ProjectDoc | null =>
  id !== null && Object.hasOwn(docs.projects, id) ? docs.projects[id] : null;

const viewsOf = (docs: DocsState, id: ProjectId | null) => projectOf(docs, id)?.views ?? [];

/* ------------------------------------------------------------------
   Hydration
   ------------------------------------------------------------------ */

interface Hydrated {
  kind: DemoLoadKind | "initial";
  state: Pick<FormState, "docs" | "activeProjectId" | "local" | "today" | "changes" | "notices" | "assetAliases" | "migratedFrom" | "caption">;
  /** What storage holds already (null: nothing to compare, the start state counts as saved) */
  saved: DemoEnvelope | null;
  writable: boolean;
}

function hydrate(deps: FormDeps): Hydrated {
  const nowMs = deps.now();
  if (deps.initial) {
    const { docs, activeProjectId } = deps.initial;
    const local = deps.initial.local ?? defaultLocalViewState(projectOf(docs, activeProjectId));
    return {
      kind: "initial",
      state: {
        docs,
        activeProjectId,
        local,
        today: todayFor(docs.workspace.timezone, nowMs),
        changes: 0,
        notices: { weekendsPending: false },
        assetAliases: {},
        migratedFrom: null,
        caption: null,
      },
      saved: null,
      writable: false,
    };
  }

  const zone = deps.timezone();
  const loaded = loadDemo(deps.storage, {
    now: new Date(nowMs).toISOString() as Timestamp,
    timezone: isIanaZone(zone) ? zone : FALLBACK_ZONE,
    mint: deps.mint,
  });
  const e = loaded.envelope;
  const docs: DocsState = { workspace: e.workspace, projects: e.projects };
  const activeProjectId = resolveProject(docs, e.activeProjectId);
  const project = projectOf(docs, activeProjectId);
  const local: LocalViewState = { ...defaultLocalViewState(project), activeView: initialView(deps.search(), project, e.lastView) };

  // One-off captions: the copy of an unreadable save, or the working-days notice of a migration (ED-10)
  let caption: StoreCaption | null = null;
  let notices = e.notices;
  if (loaded.kind === "recovered") caption = { id: 1, text: NOTICE_TEXT.demoReadFailed, tone: "info", undoable: false };
  else if (notices.weekendsPending) {
    caption = { id: 1, text: NOTICE_TEXT.weekendsNow, tone: "info", undoable: false };
    notices = { weekendsPending: false };
  }
  setAssetAliases(e.assetAliases);
  return {
    kind: loaded.kind,
    state: {
      docs,
      activeProjectId,
      local,
      today: todayFor(e.workspace.timezone, nowMs),
      changes: e.changes,
      notices,
      assetAliases: e.assetAliases,
      migratedFrom: e.migratedFrom,
      caption,
    },
    saved: loaded.kind === "saved" || loaded.kind === "migrated" ? e : null,
    writable: loaded.writable,
  };
}

/* ------------------------------------------------------------------
   The store
   ------------------------------------------------------------------ */

export function createFormStore(deps: FormDeps): FormStore {
  const hydrated = hydrate(deps);
  let captionSeq = hydrated.state.caption?.id ?? 0;
  let gestureTimer: ReturnType<typeof setTimeout> | null = null;
  let persistence: Persistence | null = null;

  const api = createStore<FormState>()((set, get) => {
    const stamp = () => new Date(deps.now()).toISOString() as Timestamp;
    const ctx = (): EngineCtx => ({ now: stamp(), actorId: null, today: get().today, newId: deps.newId });
    const where = (): Where => ({ projectId: get().activeProjectId, local: get().local });
    const caption = (c: Caption): StoreCaption => ({ ...c, id: ++captionSeq });
    /** Today again when a change moved the workspace to another zone */
    const todayFor_ = (docs: DocsState) => (docs.workspace.timezone === get().docs.workspace.timezone ? get().today : todayFor(docs.workspace.timezone, deps.now()));

    const clearGestureTimer = () => {
      if (gestureTimer !== null) clearTimeout(gestureTimer);
      gestureTimer = null;
    };

    /**
     * Applies a command's result: documents, project and view, a history entry when something
     * changed (the counter counts it, redo is cleared), the fx, and the caption. `quiet` keeps the
     * current caption when the command has none to say.
     */
    function apply(result: CommandResult, o: { label: string; quiet: boolean; fx?: boolean; extra?: Partial<FormState> }): HistoryEntry | null {
      const s = get();
      const before = where();
      const entry = historyEntry(result, o.label, before);
      const patch: Partial<FormState> = { docs: result.state, activeProjectId: result.projectId, local: result.local };
      if (result.state !== s.docs) patch.today = todayFor_(result.state);
      if (entry) {
        patch.past = [...s.past, entry].slice(-HISTORY_LIMIT);
        patch.future = [];
        patch.changes = s.changes + 1;
      }
      const moved = result.projectId !== before.projectId || result.local.activeView !== before.local.activeView;
      if (o.fx !== false && (entry || moved)) patch.fx = fxFor(result, before, s.fx.seq + 1);
      if (result.caption) patch.caption = caption(result.caption);
      else if (!o.quiet) patch.caption = null;
      set({ ...patch, ...o.extra });
      return entry;
    }

    /** Seals an open gesture: on the next action (plan §5.8) */
    function seal(): void {
      const g = get().gesture;
      if (g === null) return;
      clearGestureTimer();
      const result = endGesture(g, [], ctx());
      // The gesture closes in the same update that commits it, so persistence sees one change
      if (result === null) set({ gesture: null, docs: g.base });
      else apply(result, { label: "gesture", quiet: true, fx: false, extra: { gesture: null } });
    }

    function armGestureTimer(): void {
      clearGestureTimer();
      gestureTimer = setTimeout(() => {
        gestureTimer = null;
        seal();
      }, GESTURE_IDLE_MS);
    }

    return {
      ...hydrated.state,
      past: [],
      future: [],
      gesture: null,
      composerOpen: false,
      phase: "rest",
      fx: INITIAL_FX,
      spawn: null,
      commandHistory: [],
      reducedMotion: false,
      intro: false,

      async submit(text) {
        const command = text.trim();
        // Only an in-flight command blocks input; the creation choreography never does
        if (!command || get().phase === "processing") return false;
        seal();
        set({ phase: "processing", caption: null, spawn: null });

        const t0 = deps.now();
        const s0 = get();
        const parsed = fastParse(command, parserContext({ docs: s0.docs, projectId: s0.activeProjectId, local: s0.local, today: s0.today, mint: deps.mint }));

        // A short, honest beat so the shape change reads: no fake reasoning
        const beat = get().reducedMotion ? 0 : PROCESS_BEAT_MS;
        const elapsed = deps.now() - t0;
        if (elapsed < beat) await sleep(beat - elapsed);
        set((st) => ({ commandHistory: [command, ...st.commandHistory.filter((c) => c !== command)].slice(0, COMMAND_HISTORY) }));
        // A drag may have started during the beat
        seal();

        if (parsed.status === "none") {
          set({ phase: "rest", composerOpen: true, caption: caption({ text: parsed.reply.text, tone: "unsupported", undoable: false }) });
          return false;
        }
        if ("control" in parsed) {
          if (parsed.control === "reset") {
            get().reset();
            set({ phase: "rest", composerOpen: false });
            return true;
          }
          const did = parsed.control === "undo" ? get().undo() : get().redo();
          const text = parsed.control === "undo" ? (did ? "Undone" : "Nothing to undo") : did ? "Redone" : "Nothing to redo";
          set({ phase: "rest", composerOpen: false, caption: caption({ text, tone: "info", undoable: false }) });
          return true;
        }
        const cmd = toCommand(parsed, command);
        if (cmd === null) {
          // A question back with nothing to apply: the composer stays open for the answer
          set({ phase: "rest", composerOpen: true, caption: caption({ text: parsed.reply?.text ?? "", tone: "clarify", undoable: false }) });
          return false;
        }

        const result = run(get().docs, cmd, where(), ctx());
        const tone = result.caption?.tone ?? (result.changed ? "done" : "info");
        const ok = tone !== "clarify" && tone !== "unsupported";
        const created = result.outcomes.some((o) => o.result.kind === "applied" && o.def?.name === "createProject");
        const creating = created && !get().reducedMotion;
        // One update: the new documents and the agent's phase render together, so freshly created
        // surfaces mount already knowing they must wait for the agent
        apply(result, { label: command, quiet: false, extra: { phase: creating ? "creating" : "rest", composerOpen: !ok } });
        if (creating) {
          const seq = get().fx.seq;
          setTimeout(() => {
            if (get().phase === "creating" && get().fx.seq === seq) set({ phase: "rest", spawn: null });
          }, CREATE_TOTAL_MS);
        }
        return ok;
      },

      commit(ops, meta) {
        seal();
        const result = run(
          get().docs,
          { ops, local: meta.local ?? [], notes: [], notices: [], source: meta.source ?? "direct", text: null, caption: meta.caption ?? false },
          where(),
          ctx(),
        );
        apply(result, { label: meta.label, quiet: true });
        return result;
      },

      beginGesture() {
        seal();
        set({ gesture: beginGesture(get().docs, where()) });
        armGestureTimer();
      },

      live(ops) {
        const open = get().gesture ?? beginGesture(get().docs, where());
        const g = liveGesture(open, ops, { now: stamp(), actorId: null });
        set({ gesture: g, docs: g.state });
        armGestureTimer();
      },

      endGesture() {
        seal();
      },

      cancelGesture() {
        const g = get().gesture;
        if (g === null) return;
        clearGestureTimer();
        set({ gesture: null, docs: g.base });
      },

      showView(view) {
        seal();
        const s = get();
        const project = projectOf(s.docs, s.activeProjectId);
        // Tabs only switch between created views; creating one goes through a command
        if (!project || !project.views.includes(view) || s.local.activeView === view) return;
        set({ local: { ...s.local, activeView: view }, fx: shiftFx(s.local.activeView, s.fx.seq + 1) });
      },

      select(id) {
        const s = get();
        const project = projectOf(s.docs, s.activeProjectId);
        const selectedTaskId = id !== null && project && Object.hasOwn(project.tasks, id) ? id : null;
        if (selectedTaskId !== s.local.selectedTaskId) set({ local: { ...s.local, selectedTaskId } });
      },

      resolveProposal(accept, only) {
        const s = get();
        const proposal = projectOf(s.docs, s.activeProjectId)?.proposal ?? null;
        if (proposal === null) return;
        const op = accept
          ? ({ op: "acceptProposal", proposalId: proposal.id, ...(only && only.length > 0 ? { only: [...only] } : {}) } as Op)
          : ({ op: "discardProposal", proposalId: proposal.id } as Op);
        get().commit([op], { label: accept ? "accept proposal" : "discard proposal" });
      },

      undo() {
        seal();
        const s = get();
        const entry = s.past.at(-1);
        if (entry === undefined) return false;
        const docs = undoEntry(s.docs, entry);
        const land = landing(docs, entry, "before", where());
        set({
          docs,
          activeProjectId: land.projectId,
          local: land.local,
          today: todayFor_(docs),
          past: s.past.slice(0, -1),
          future: [entry, ...s.future].slice(0, HISTORY_LIMIT),
          fx: restoreFx(
            { projectId: s.activeProjectId, local: s.local, views: viewsOf(s.docs, s.activeProjectId) },
            { projectId: land.projectId, local: land.local, views: viewsOf(docs, land.projectId) },
            s.fx.seq + 1,
          ),
        });
        return true;
      },

      redo() {
        seal();
        const s = get();
        const entry = s.future[0];
        if (entry === undefined) return false;
        const docs = redoEntry(s.docs, entry);
        const land = landing(docs, entry, "after", where());
        set({
          docs,
          activeProjectId: land.projectId,
          local: land.local,
          today: todayFor_(docs),
          // The redone entry now ends at these documents, so a later undo starts from them
          past: [...s.past, { ...entry, after: docs }].slice(-HISTORY_LIMIT),
          future: s.future.slice(1),
          fx: restoreFx(
            { projectId: s.activeProjectId, local: s.local, views: viewsOf(s.docs, s.activeProjectId) },
            { projectId: land.projectId, local: land.local, views: viewsOf(docs, land.projectId) },
            s.fx.seq + 1,
          ),
        });
        return true;
      },

      reset() {
        seal();
        const s = get();
        const settle: Partial<FormState> = { composerOpen: false, phase: "rest", spawn: null };
        if (s.activeProjectId === null) {
          set({ ...settle, caption: caption({ text: "Nothing to reset", tone: "info", undoable: false }) });
          return false;
        }
        const result = run(
          s.docs,
          { ops: [{ op: "deleteProject", projectId: s.activeProjectId }], local: [], notes: [], notices: [], source: "direct", text: null },
          where(),
          ctx(),
        );
        apply(result, { label: "Reset", quiet: false, fx: false, extra: { ...settle, fx: { kind: "restore", seq: s.fx.seq + 1, from: null, added: null } } });
        return result.changed;
      },

      openComposer() {
        if (get().phase === "processing") return;
        set({ composerOpen: true, ...(get().phase === "creating" ? { phase: "rest" as Phase, spawn: null } : {}) });
      },

      closeComposer() {
        set({ composerOpen: false });
      },

      dismissCaption() {
        set({ caption: null });
      },

      setSpawn(rects) {
        set({ spawn: rects });
      },

      setReducedMotion(v) {
        if (get().reducedMotion !== v) set({ reducedMotion: v });
      },

      setIntro(open) {
        set(open ? { intro: true, composerOpen: false } : { intro: false });
      },

      tick(today) {
        if (get().today !== today) set({ today });
      },

      flushSave() {
        persistence?.flush();
      },
    };
  });

  const saved = hydrated.saved;
  persistence = attachPersistence(api, {
    storage: deps.storage,
    writable: hydrated.writable && hydrated.kind !== "initial",
    // A fresh or recovered demo counts as saved until its first change
    saved: saved
      ? {
          workspace: saved.workspace,
          projects: saved.projects,
          activeProjectId: saved.activeProjectId,
          lastView: saved.lastView,
          changes: saved.changes,
          notices: saved.notices,
          assetAliases: saved.assetAliases,
          migratedFrom: saved.migratedFrom,
        }
      : {
          workspace: hydrated.state.docs.workspace,
          projects: hydrated.state.docs.projects,
          activeProjectId: hydrated.state.activeProjectId,
          lastView: hydrated.state.activeProjectId === null ? null : hydrated.state.local.activeView,
          changes: hydrated.state.changes,
          notices: hydrated.state.notices,
          assetAliases: hydrated.state.assetAliases,
          migratedFrom: hydrated.state.migratedFrom,
        },
    debounceMs: deps.saveDebounceMs,
  });
  // The weekends notice shown at load, or a view from the URL: saved like any change
  persistence.check();
  return Object.assign(api, { deps, loaded: hydrated.kind, persistence });
}

/* ------------------------------------------------------------------
   The app's store
   ------------------------------------------------------------------ */

/** A v4 uuid: crypto.randomUUID where the context is secure, else from getRandomValues */
function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function browserStorage(): DemoStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // Storage blocked by the browser: the demo runs, and saves nothing
    return null;
  }
}

function browserZone(): string {
  try {
    return Intl.DateTimeFormat("en-US").resolvedOptions().timeZone;
  } catch {
    return FALLBACK_ZONE;
  }
}

/** The browser's clock, storage, zone and URL; on the server, no storage and no URL */
export function browserDeps(): FormDeps {
  return {
    storage: browserStorage(),
    now: () => Date.now(),
    newId: uuid,
    mint: nanoMinter,
    timezone: browserZone,
    search: () => (typeof window === "undefined" ? "" : window.location.search),
  };
}

let appStore: FormStore | null = null;

/** The app's store, created (and hydrated from this browser's storage) on first use */
export function getFormStore(): FormStore {
  return (appStore ??= createFormStore(browserDeps()));
}

/**
 * Exposes the store as `window.__form` for automated checks (e2e/settle.ts reads its phase):
 * in development, or in a production build made with NEXT_PUBLIC_FORM_E2E=1 (plan §8.1).
 */
export function exposeFormHandle(store: FormStore = getFormStore()): void {
  if (typeof window === "undefined") return;
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_FORM_E2E !== "1") return;
  (window as unknown as { __form?: FormStore }).__form = store;
}
