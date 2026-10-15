import type { DemoEnvelope } from "@/lib/domain/schema/demo";
import type { ProjectId } from "@/lib/domain/schema/ids";
import type { ViewKind } from "@/lib/domain/schema/primitives";
import { type DemoSnapshot, type DemoStorage, envelopeOf, saveDemo } from "@/lib/demo/storage";
import type { DocsState } from "@/lib/store/engine";

/**
 * Debounced saving of the demo (plan §7.3, §8.1): 250 ms after the last change to what the
 * envelope holds (documents, the open project and view, the counter, notices, asset aliases), and
 * never while a gesture is open: a drag saves once, when it is sealed. Selection, captions, the
 * composer and the history are session-only and never trigger a save.
 */

export const SAVE_DEBOUNCE_MS = 250;

/** What the store holds that the envelope saves (structural, so this module never imports form.ts) */
export interface PersistedState {
  readonly docs: DocsState;
  readonly activeProjectId: ProjectId | null;
  readonly local: { readonly activeView: ViewKind };
  readonly changes: number;
  readonly notices: DemoEnvelope["notices"];
  readonly assetAliases: DemoEnvelope["assetAliases"];
  readonly migratedFrom: DemoEnvelope["migratedFrom"];
  /** Open while a drag or slider is live */
  readonly gesture: unknown;
}

export interface Subscribable<S> {
  getState(): S;
  subscribe(listener: (state: S, previous: S) => void): () => void;
}

/** The snapshot the envelope is built from; `lastView` only means something with a project open */
export function snapshotOf(s: PersistedState): DemoSnapshot {
  return {
    workspace: s.docs.workspace,
    projects: s.docs.projects,
    activeProjectId: s.activeProjectId,
    lastView: s.activeProjectId === null ? null : s.local.activeView,
    changes: s.changes,
    notices: s.notices,
    assetAliases: s.assetAliases,
    migratedFrom: s.migratedFrom,
  };
}

/** The identity of a snapshot: documents and objects by reference, the rest by value */
function keyOf(s: DemoSnapshot): readonly unknown[] {
  return [s.workspace, s.projects, s.activeProjectId, s.lastView, s.changes, s.notices, s.assetAliases, s.migratedFrom];
}

const sameKey = (a: readonly unknown[] | null, b: readonly unknown[]) => a !== null && a.length === b.length && a.every((v, i) => v === b[i]);

export interface Persistence {
  /** Saves now if a save is pending (page hide, tests) */
  flush(): void;
  /** Schedules a save if the state differs from the last one saved (after hydration) */
  check(): void;
  /** Stops listening; a pending save is dropped */
  stop(): void;
  /** Saves so far, for tests and diagnostics */
  readonly saves: number;
}

export interface PersistenceOptions {
  /** Null, or not writable: nothing is ever written (server render, an unreadable save that couldn't be copied aside) */
  storage: DemoStorage | null;
  writable: boolean;
  /** The snapshot already in storage (or the one a fresh demo starts from): not saved again */
  saved: DemoSnapshot;
  debounceMs?: number;
}

export function attachPersistence<S extends PersistedState>(store: Subscribable<S>, o: PersistenceOptions): Persistence {
  const delay = o.debounceMs ?? SAVE_DEBOUNCE_MS;
  let lastSaved: readonly unknown[] | null = keyOf(o.saved);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let saves = 0;
  const enabled = o.storage !== null && o.writable;

  const save = () => {
    timer = null;
    const state = store.getState();
    if (state.gesture) return;
    const snapshot = snapshotOf(state);
    const key = keyOf(snapshot);
    if (sameKey(lastSaved, key)) return;
    if (saveDemo(o.storage!, envelopeOf(snapshot))) {
      lastSaved = key;
      saves++;
    }
  };

  const check = () => {
    if (!enabled) return;
    const state = store.getState();
    if (state.gesture) return;
    if (sameKey(lastSaved, keyOf(snapshotOf(state)))) {
      // Back to what is saved (an undone change): nothing to write
      if (timer !== null) clearTimeout(timer);
      timer = null;
      return;
    }
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(save, delay);
  };

  const unsubscribe = store.subscribe(check);
  return {
    flush() {
      if (timer === null) return;
      clearTimeout(timer);
      save();
    },
    check,
    stop() {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
    get saves() {
      return saves;
    },
  };
}
