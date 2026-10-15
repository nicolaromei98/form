// Shared helpers of the store tests: a store on a fixed clock with seeded ids, from a fixture
// state or from storage; the v0 fixtures and a storage spy. (The migration tests' helpers read
// their files through import.meta URLs, which happy-dom's URL breaks, so these read by path.)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { seededMinter } from "@/lib/domain/ids";
import { demoWorkspace } from "@/lib/demo/seed";
import type { ViewKind } from "@/lib/domain/schema/primitives";
import { createFormStore, type FormDeps, type FormStore } from "@/lib/store/form";
import { activeProject, demoState, type FixtureState, FIXTURE_NOW } from "../../../../test/fixtures/v2/build";

export const NOW_MS = Date.parse(FIXTURE_NOW);

/** Deterministic deps: the (fake) system clock, seeded entity ids, counted uuids, no storage */
export function testDeps(o: Partial<FormDeps> = {}): FormDeps {
  let n = 0;
  return {
    storage: null,
    now: () => Date.now(),
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    mint: seededMinter(21),
    timezone: () => "Europe/Rome",
    search: () => "",
    ...o,
  };
}

/** A store on a fixture state (nothing saved) */
export function storeOn(state: FixtureState, o: Partial<FormDeps> = {}): FormStore {
  return createFormStore(testDeps({ initial: { docs: { workspace: state.workspace, projects: state.projects }, activeProjectId: state.projectId }, ...o }));
}

/** The demo before any project: the demo workspace with its sample team, as a first load makes it */
export function emptyDemo(): FixtureState {
  return { workspace: demoWorkspace(FIXTURE_NOW, "Europe/Rome"), projects: {}, projectId: null };
}

/** A store on the demo template, with the given views (the first one active) */
export function demoStore(views: ViewKind[] = ["cards"], o: Partial<FormDeps> = {}): FormStore {
  return storeOn(demoState({ views }), o);
}

/** The open project; throws when there is none */
export function openProject(store: FormStore) {
  const s = store.getState();
  if (s.activeProjectId === null) throw new Error("No project is open");
  return s.docs.projects[s.activeProjectId];
}

export { activeProject };

/* ------------------------------------------------------------------
   v0 fixtures and a storage spy
   ------------------------------------------------------------------ */

const V0_DIR = join(process.cwd(), "test/fixtures/v0");

export interface V0Entry {
  name: string;
  file: string;
  kind: "envelope" | "storage";
}

export const V0_MANIFEST: readonly V0Entry[] = JSON.parse(readFileSync(join(V0_DIR, "manifest.json"), "utf8"));

/** The raw localStorage strings a v0 fixture stands for: envelopes sit under the main key */
export function v0Storage(entry: V0Entry): Record<string, string> {
  const text = readFileSync(join(V0_DIR, entry.file), "utf8");
  return entry.kind === "storage" ? (JSON.parse(text) as Record<string, string>) : { "form.workspace.v1": JSON.stringify(JSON.parse(text)) };
}

export interface SpyStorage extends Storage {
  readonly calls: { method: string; args: unknown[] }[];
  readonly values: Map<string, string>;
}

/** A Storage over a map that records every call */
export function spyStorage(initial: Record<string, string>): SpyStorage {
  const values = new Map(Object.entries(initial));
  const calls: { method: string; args: unknown[] }[] = [];
  const record = (method: string, args: unknown[]) => calls.push({ method, args });
  return {
    calls,
    values,
    get length() {
      record("length", []);
      return values.size;
    },
    key(i: number) {
      record("key", [i]);
      return [...values.keys()][i] ?? null;
    },
    getItem(key: string) {
      record("getItem", [key]);
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      record("setItem", [key, value]);
      values.set(key, value);
    },
    removeItem(key: string) {
      record("removeItem", [key]);
      values.delete(key);
    },
    clear() {
      record("clear", []);
      values.clear();
    },
  };
}
