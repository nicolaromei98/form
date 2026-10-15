// Shared helpers of the migration tests (plan §10.6) and the totality property (§10.3): the v0
// fixtures, a storage spy, the options each mode runs with, and the checks every result must pass.
import { readFileSync } from "node:fs";
import { seededMinter } from "@/lib/domain/ids";
import { checkProject, checkWorkspace } from "@/lib/domain/invariants/check";
import { PersonSchema, ProjectDocSchema, type ProjectDoc, type WorkspaceDoc, WorkspaceDocSchema } from "@/lib/domain/schema";
import { sampleForMigration } from "@/lib/demo/sample";
import { type MigrateV0Options, type MigrateV0Result, readV0, V0_BACKUP_KEY, V0_KEY } from "@/lib/migrate";
import { emptyWorkspace, FIXTURE_NOW, indexEntry } from "../../../../test/fixtures/v2/build";

export const V0_DIR = new URL("../../../../test/fixtures/v0/", import.meta.url);
/** Where the snapshots live, relative to a test file in this folder */
export const EXPECTED_DIR = "../../../../test/fixtures/v2/expected";

export interface ManifestEntry {
  name: string;
  file: string;
  kind: "envelope" | "storage";
  covers: string;
  purpose: string;
}

export const MANIFEST: readonly ManifestEntry[] = JSON.parse(readFileSync(new URL("manifest.json", V0_DIR), "utf8"));

/** A fixture file, parsed */
export function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`${name}.json`, V0_DIR), "utf8"));
}

/** The raw localStorage strings a fixture stands for: envelopes sit under the main key */
export function storageOf(entry: ManifestEntry): Record<string, string> {
  const text = readFileSync(new URL(entry.file, V0_DIR), "utf8");
  return entry.kind === "storage" ? (JSON.parse(text) as Record<string, string>) : { [V0_KEY]: JSON.stringify(JSON.parse(text)) };
}

/** A Storage over a fixed map that records every call */
export interface SpyStorage extends Storage {
  readonly calls: { method: string; args: unknown[] }[];
  readonly values: Map<string, string>;
}

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

/** What `readV0` makes of a fixture: the value it would migrate, and from which key */
export function readFixtureInput(entry: ManifestEntry): ReturnType<typeof readV0> {
  return readV0(spyStorage(storageOf(entry)));
}

/** The /demo workspace the demo-mode migration joins: "Demo studio", Europe/Rome, EUR, Monday to Friday */
export function demoWorkspace(): WorkspaceDoc {
  return emptyWorkspace();
}

export function demoOptions(o: Partial<MigrateV0Options> = {}): MigrateV0Options {
  return {
    now: FIXTURE_NOW,
    mint: seededMinter(14),
    mode: "demo",
    workspace: demoWorkspace(),
    sample: sampleForMigration(),
    includeSampleTeam: false,
    ...o,
  };
}

export function importOptions(o: Partial<MigrateV0Options> = {}): MigrateV0Options {
  return demoOptions({ mode: "import", ...o });
}

/** The workspace after the migration: its people added, and the project in the index */
export function mergedWorkspace(result: MigrateV0Result, workspace: WorkspaceDoc): WorkspaceDoc {
  const people = { ...workspace.people, ...Object.fromEntries(result.people.map((p) => [p.id, p])) };
  const projects = result.project ? { ...workspace.projects, [result.project.id]: indexEntry(result.project.id, result.project.createdAt) } : workspace.projects;
  return { ...workspace, people, projects };
}

/**
 * Every problem with a result (plan §10.6): the strict schemas, the invariants of both documents,
 * and no dangling reference anywhere. Empty for a good result.
 */
export function problemsOf(result: MigrateV0Result, workspace: WorkspaceDoc): string[] {
  const problems: string[] = [];
  const ws = mergedWorkspace(result, workspace);
  const wsParse = WorkspaceDocSchema.safeParse(ws);
  if (!wsParse.success) problems.push(`workspace: ${wsParse.error.message}`);
  else problems.push(...checkWorkspace(ws).map((v) => `workspace ${v.code}: ${v.message}`));
  for (const p of result.people) if (!PersonSchema.safeParse(p).success) problems.push(`person ${p.id} doesn't parse`);

  const project = result.project;
  if (project === null) {
    if (result.people.length > 0) problems.push("people without a project");
    if (result.local.activeView !== null) problems.push("an active view without a project");
    return problems;
  }
  const parsed = ProjectDocSchema.safeParse(project);
  if (!parsed.success) return [...problems, `project: ${parsed.error.message}`];
  problems.push(...checkProject(project).map((v) => `project ${v.code} at ${v.path.join(".")}: ${v.message}`));
  if (project.workspaceId !== workspace.id) problems.push("the project names another workspace");
  if (result.local.activeView === null || !project.views.includes(result.local.activeView)) problems.push("the active view isn't one of the project's views");
  problems.push(...danglingIn(project, ws));
  // Every image keeps an alias to its legacy key, so its blob is found without a copy
  const aliased = new Set(Object.values(result.idMap.assets));
  for (const m of Object.values(project.moodboard.items)) {
    if (m.assetId !== null && !aliased.has(m.assetId)) problems.push(`mood item ${m.id} has an asset without an alias`);
  }
  return problems;
}

/** References from the project to people, tasks and steps that don't exist */
export function danglingIn(project: ProjectDoc, ws: WorkspaceDoc): string[] {
  const out: string[] = [];
  const person = (id: string | null, where: string) => {
    if (id !== null && !Object.hasOwn(ws.people, id)) out.push(`${where} names the missing person ${id}`);
  };
  const task = (id: string, where: string) => {
    if (!Object.hasOwn(project.tasks, id)) out.push(`${where} names the missing task ${id}`);
  };
  project.memberIds.forEach((id, i) => person(id, `memberIds[${i}]`));
  person(project.leadId, "leadId");
  for (const t of Object.values(project.tasks)) {
    person(t.ownerId, `task ${t.id}`);
    t.dependsOn.forEach((d) => task(d, `task ${t.id} dependsOn`));
    for (const s of t.steps) person(s.ownerId, `step ${s.id}`);
    if (t.ownerId !== null && !project.memberIds.includes(t.ownerId)) out.push(`the owner of ${t.id} isn't a member`);
  }
  if (project.viewConfig.focusPin !== null) task(project.viewConfig.focusPin, "focusPin");
  const p = project.proposal;
  if (p?.kind === "subtasks") task(p.taskId, "proposal");
  if (p?.kind === "reassign") {
    for (const m of p.moves) {
      task(m.taskId, "proposal move");
      if (m.type === "owner") {
        person(m.from, "proposal move from");
        person(m.to, "proposal move to");
      }
    }
  }
  const taskIds = new Set(Object.keys(project.tasks));
  const personIds = new Set(Object.keys(ws.people));
  for (const key of Object.keys(project.brief.edits)) {
    const segments = key.split(":");
    const entity = segments[segments.length - 1];
    if (entity.startsWith("tsk_") && !taskIds.has(entity)) out.push(`brief edit ${key} names a missing task`);
    if (entity.startsWith("per_") && !personIds.has(entity)) out.push(`brief edit ${key} names a missing person`);
  }
  return out;
}

/** v0 ids ("t-ui", "p-marta", "img-…") left anywhere in a project: none may survive the id map (Q10) */
export function v0IdsIn(project: ProjectDoc): string[] {
  return JSON.stringify(project).match(/"(?:t|s|p|m|b|tool|img)-[0-9a-z]+"|:(?:t|p)-[0-9a-z]+"/g) ?? [];
}

export { V0_BACKUP_KEY, V0_KEY };
