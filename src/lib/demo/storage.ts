import type { Minter } from "@/lib/domain/ids";
import { compareKeys } from "@/lib/domain/order";
import { DEMO_BACKUP_KEY, DEMO_STORAGE_KEY, type DemoEnvelope, DemoEnvelopeSchema } from "@/lib/domain/schema/demo";
import type { ProjectId } from "@/lib/domain/schema/ids";
import type { Timestamp, ViewKind } from "@/lib/domain/schema/primitives";
import type { ProjectDoc } from "@/lib/domain/schema/project";
import type { WorkspaceDoc } from "@/lib/domain/schema/workspace";
import { sampleForMigration } from "@/lib/demo/sample";
import { demoWorkspace } from "@/lib/demo/seed";
import { assetAliases, type MigrationReport, migrateV0, readV0, upgradeProjectDoc, upgradeWorkspaceDoc } from "@/lib/migrate";

/**
 * The /demo save (plan §3.6, §7.3): the `form.demo.v2` envelope in localStorage.
 *
 * - First load, no saved demo: the v0 document (`readV0`, main key then backup) is migrated in
 *   demo mode into the demo workspace and written as the envelope. The v0 keys are only ever
 *   read: the Phase 2 importer reads them again. IndexedDB blobs are never copied: the envelope
 *   maps each migrated image to its legacy key (`assetAliases`).
 * - No v0 document either: an empty demo workspace (the sample people are in it already).
 * - A saved demo that can't be read (JSON, schema or invariants): its raw text is copied to
 *   `form.demo.v2.backup` and the demo starts empty, with a caption. It is never wiped: if no
 *   copy can be made, nothing is written over it either.
 * - Saving compacts deleted projects and their index entries out of the envelope: history is
 *   session-only, so nothing can reference them after a reload.
 *
 * This module is the only one that touches the demo's storage; the store calls it.
 */

export type DemoStorage = Pick<Storage, "getItem" | "setItem">;

export interface DemoLoadOptions {
  /** createdAt of everything a first load creates */
  now: Timestamp;
  /** The browser's IANA zone: the demo workspace's time zone */
  timezone: string;
  mint: Minter;
}

export type DemoLoadKind =
  /** The saved envelope */
  | "saved"
  /** A first load from the v0 document */
  | "migrated"
  /** A first load with nothing to migrate (or a migration that failed: the v0 keys stay as they are) */
  | "fresh"
  /** The saved envelope couldn't be read: copied aside (or left in place), the demo starts empty */
  | "recovered";

export interface DemoLoad {
  kind: DemoLoadKind;
  envelope: DemoEnvelope;
  /** Whether the envelope may be written: false when an unreadable save could not be copied aside */
  writable: boolean;
  /** Where the unreadable save was copied ("recovered" only; null when it couldn't be) */
  backupKey: string | null;
  /** The migration's report ("migrated" only) */
  report: MigrationReport | null;
  /** Why a saved envelope was unreadable ("recovered" only), for diagnostics */
  problem: string | null;
}

/** A stored envelope that can't be used */
export class DemoReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoReadError";
  }
}

/* ------------------------------------------------------------------
   Reading
   ------------------------------------------------------------------ */

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Parses a stored envelope: JSON, every document brought to the current schema and checked
 * (`upgrade*Doc`: strict schemas and invariants), then the envelope's own strict schema and the
 * links between its parts. Throws `DemoReadError` on anything it can't trust. An active project
 * that is gone is not an error: the latest live project opens instead.
 */
export function readDemoEnvelope(text: string): DemoEnvelope {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new DemoReadError("The saved demo isn't JSON.");
  }
  if (!isRecord(raw) || !isRecord(raw.projects)) throw new DemoReadError("The saved demo isn't an envelope.");
  let workspace: WorkspaceDoc;
  const projects: Record<string, ProjectDoc> = {};
  try {
    workspace = upgradeWorkspaceDoc(raw.workspace);
    for (const [key, doc] of Object.entries(raw.projects)) projects[key] = upgradeProjectDoc(doc);
  } catch (e) {
    throw new DemoReadError(e instanceof Error ? e.message : "A saved document can't be read.");
  }
  const parsed = DemoEnvelopeSchema.safeParse({ ...raw, workspace, projects });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new DemoReadError(`The saved demo doesn't match its schema (${issue?.path.join(".") ?? ""}: ${issue?.message ?? "invalid"}).`);
  }
  const envelope = parsed.data;
  for (const [key, project] of Object.entries(envelope.projects)) {
    if (project.id !== key) throw new DemoReadError(`The project saved under ${key} is ${project.id}.`);
    if (project.workspaceId !== envelope.workspace.id) throw new DemoReadError(`${project.id} belongs to another workspace.`);
  }
  const active = envelope.activeProjectId;
  if (active !== null && !Object.hasOwn(envelope.projects, active)) return { ...envelope, activeProjectId: latestLive(envelope) };
  return envelope;
}

function latestLive(e: Pick<DemoEnvelope, "workspace" | "projects">): ProjectId | null {
  const live = Object.values(e.projects).filter((p) => {
    const entry = Object.hasOwn(e.workspace.projects, p.id) ? e.workspace.projects[p.id] : null;
    return entry === null || (entry.archivedAt === null && entry.deletedAt === null);
  });
  live.sort((a, b) => compareKeys(b.createdAt, a.createdAt) || compareKeys(a.id, b.id));
  return live[0]?.id ?? null;
}

/* ------------------------------------------------------------------
   Building
   ------------------------------------------------------------------ */

/** The demo before any project: the demo workspace (sample team included), nothing else */
export function freshEnvelope(now: Timestamp, timezone: string): DemoEnvelope {
  return {
    schemaVersion: 2,
    workspace: demoWorkspace(now, timezone),
    projects: {},
    activeProjectId: null,
    lastView: null,
    changes: 0,
    notices: { weekendsPending: false },
    assetAliases: {},
    migratedFrom: null,
  };
}

/**
 * The first-load migration (plan §7.3): the v0 document in demo mode, merged into the demo
 * workspace (its people, and the project in the index). Null when there is no v0 document.
 * Throws the migration's own error when it fails, which never happens on the fixtures.
 */
export function migratedEnvelope(storage: Pick<Storage, "getItem">, o: DemoLoadOptions): { envelope: DemoEnvelope; report: MigrationReport } | null {
  const found = readV0(storage);
  if (found === null) return null;
  const base = demoWorkspace(o.now, o.timezone);
  const m = migrateV0(found.raw, {
    now: o.now,
    mint: o.mint,
    mode: "demo",
    workspace: base,
    sample: sampleForMigration(),
    includeSampleTeam: false,
    source: found.source,
  });
  const people = { ...base.people };
  for (const p of m.people) people[p.id] = p;
  const project = m.project;
  const workspace: WorkspaceDoc = {
    ...base,
    people,
    projects: project ? { [project.id]: { id: project.id, createdAt: o.now, archivedAt: null, deletedAt: null } } : {},
  };
  const envelope: DemoEnvelope = {
    schemaVersion: 2,
    workspace,
    projects: project ? { [project.id]: project } : {},
    activeProjectId: project?.id ?? null,
    lastView: m.local.activeView,
    changes: m.report.changes,
    notices: { weekendsPending: m.report.notices.includes("weekendsNow") },
    assetAliases: assetAliases(m.idMap),
    migratedFrom: found.source === "main" ? "v0-main" : "v0-backup",
  };
  return { envelope, report: m.report };
}

/** The state the store saves: documents, the open project and view, the counter and the notices */
export interface DemoSnapshot {
  workspace: WorkspaceDoc;
  projects: Readonly<Record<ProjectId, ProjectDoc>>;
  activeProjectId: ProjectId | null;
  lastView: ViewKind | null;
  changes: number;
  notices: DemoEnvelope["notices"];
  assetAliases: DemoEnvelope["assetAliases"];
  migratedFrom: DemoEnvelope["migratedFrom"];
}

/**
 * The envelope of a snapshot, compacted: deleted projects and their index entries are left out
 * (plan §7.3), and so is the open project when it is one of them.
 */
export function envelopeOf(s: DemoSnapshot): DemoEnvelope {
  const deleted = new Set((Object.keys(s.workspace.projects) as ProjectId[]).filter((id) => s.workspace.projects[id].deletedAt !== null));
  let workspace = s.workspace;
  const projects: Record<ProjectId, ProjectDoc> = {};
  for (const id of Object.keys(s.projects) as ProjectId[]) if (!deleted.has(id)) projects[id] = s.projects[id];
  if (deleted.size > 0) {
    const index = { ...workspace.projects };
    for (const id of deleted) delete index[id];
    workspace = { ...workspace, projects: index };
  }
  const activeProjectId = s.activeProjectId !== null && Object.hasOwn(projects, s.activeProjectId) ? s.activeProjectId : null;
  return {
    schemaVersion: 2,
    workspace,
    projects,
    activeProjectId,
    lastView: activeProjectId === null ? null : s.lastView,
    changes: s.changes,
    notices: s.notices,
    assetAliases: s.assetAliases,
    migratedFrom: s.migratedFrom,
  };
}

/* ------------------------------------------------------------------
   Writing
   ------------------------------------------------------------------ */

/** Writes the envelope under `form.demo.v2`; false when storage refuses (full or blocked) */
export function saveDemo(storage: Pick<Storage, "setItem">, envelope: DemoEnvelope): boolean {
  try {
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

/** Numbered backup keys after the first, so an older copy is never overwritten by a newer one */
const BACKUP_SLOTS = 9;

/**
 * Copies an unreadable save aside: to `form.demo.v2.backup`, or, when that already holds another
 * copy, to the first free `form.demo.v2.backup.2` … `.9`. Returns the key, or null when nothing
 * could be written (then the caller must not write over the original either).
 */
export function backUp(storage: DemoStorage, text: string): string | null {
  const keys = [DEMO_BACKUP_KEY, ...Array.from({ length: BACKUP_SLOTS - 1 }, (_, i) => `${DEMO_BACKUP_KEY}.${i + 2}`)];
  for (const key of keys) {
    let held: string | null;
    try {
      held = storage.getItem(key);
    } catch {
      return null;
    }
    if (held === text) return key;
    if (held !== null) continue;
    try {
      storage.setItem(key, text);
      return key;
    } catch {
      return null;
    }
  }
  return null;
}

/* ------------------------------------------------------------------
   Loading
   ------------------------------------------------------------------ */

function read(storage: DemoStorage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * The demo to open (plan §7.3). A first-load migration is written at once, so its minted ids stay
 * the same on the next load; a fresh demo is written with the first change. Without storage
 * (server render, blocked storage) the demo is fresh and nothing is written.
 */
export function loadDemo(storage: DemoStorage | null, o: DemoLoadOptions): DemoLoad {
  const base = { writable: true, backupKey: null, report: null, problem: null };
  if (storage === null) return { ...base, kind: "fresh", envelope: freshEnvelope(o.now, o.timezone), writable: false };

  const saved = read(storage, DEMO_STORAGE_KEY);
  if (saved !== null) {
    try {
      return { ...base, kind: "saved", envelope: readDemoEnvelope(saved) };
    } catch (e) {
      const backupKey = backUp(storage, saved);
      return {
        ...base,
        kind: "recovered",
        envelope: freshEnvelope(o.now, o.timezone),
        writable: backupKey !== null,
        backupKey,
        problem: e instanceof Error ? e.message : String(e),
      };
    }
  }

  let migrated: ReturnType<typeof migratedEnvelope>;
  try {
    migrated = migratedEnvelope(storage, o);
  } catch (e) {
    // A migration bug: start empty and leave the v0 keys for a later build (they are never written)
    return { ...base, kind: "fresh", envelope: freshEnvelope(o.now, o.timezone), problem: e instanceof Error ? e.message : String(e) };
  }
  if (migrated === null) return { ...base, kind: "fresh", envelope: freshEnvelope(o.now, o.timezone) };
  saveDemo(storage, migrated.envelope);
  return { ...base, kind: "migrated", envelope: migrated.envelope, report: migrated.report };
}
