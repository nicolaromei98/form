import { checkProject, checkWorkspace } from "@/lib/domain/invariants/check";
import { type ProjectDoc, ProjectDocSchema } from "@/lib/domain/schema/project";
import { type WorkspaceDoc, WorkspaceDocSchema } from "@/lib/domain/schema/workspace";
import { isRecord } from "@/lib/migrate/v0/schema";

/**
 * Document versions (plan §7). v2 documents carry `schemaVersion`; a later schema adds one step
 * to `MIGRATIONS` (2 → 3 at key 2, and so on), and stored documents climb the chain when they are
 * read. The v0 document has no version: `detectV0` recognises it and `migrateV0` turns it into v2.
 */

export const CURRENT_SCHEMA = 2;

/** One schema step: from version `n` (its key) to `n + 1`, per document type */
export interface DocMigration {
  project?: (doc: unknown) => unknown;
  workspace?: (doc: unknown) => unknown;
}

/** 2 → 3 and later; empty while v2 is current */
export const MIGRATIONS: Readonly<Record<number, DocMigration>> = Object.freeze({});

/** A stored document that can't be brought to the current schema */
export class UpgradeError extends Error {
  readonly problems: readonly string[];

  constructor(docType: string, problems: readonly string[]) {
    super(`The ${docType} document can't be read: ${problems.slice(0, 3).join("; ")}${problems.length > 3 ? "; …" : ""}`);
    this.name = "UpgradeError";
    this.problems = problems;
  }
}

function versionOf(doc: unknown): number | null {
  const v = isRecord(doc) ? doc.schemaVersion : undefined;
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}

/** Climbs `MIGRATIONS` until the document is at `CURRENT_SCHEMA` */
function climb(doc: unknown, docType: "project" | "workspace"): unknown {
  let current = doc;
  let version = versionOf(current);
  if (version === null) throw new UpgradeError(docType, ["it has no schemaVersion (a v0 document goes through migrateV0)"]);
  while (version < CURRENT_SCHEMA) {
    const step = MIGRATIONS[version]?.[docType];
    if (!step) throw new UpgradeError(docType, [`no migration from schema ${version}`]);
    current = step(current);
    const next = versionOf(current);
    if (next === null || next <= version) throw new UpgradeError(docType, [`the migration from schema ${version} didn't advance it`]);
    version = next;
  }
  if (version > CURRENT_SCHEMA) throw new UpgradeError(docType, [`schema ${version} is newer than this code (${CURRENT_SCHEMA})`]);
  return current;
}

/** A stored project document at the current schema: upgraded, strictly parsed and checked */
export function upgradeProjectDoc(d: unknown): ProjectDoc {
  const parsed = ProjectDocSchema.safeParse(climb(d, "project"));
  if (!parsed.success) throw new UpgradeError("project", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  const violations = checkProject(parsed.data);
  if (violations.length > 0) throw new UpgradeError("project", violations.map((v) => `${v.code}: ${v.message}`));
  return parsed.data;
}

/** A stored workspace document at the current schema: upgraded, strictly parsed and checked */
export function upgradeWorkspaceDoc(d: unknown): WorkspaceDoc {
  const parsed = WorkspaceDocSchema.safeParse(climb(d, "workspace"));
  if (!parsed.success) throw new UpgradeError("workspace", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  const violations = checkWorkspace(parsed.data);
  if (violations.length > 0) throw new UpgradeError("workspace", violations.map((v) => `${v.code}: ${v.message}`));
  return parsed.data;
}

export { assetAliases, emptyIdMap, rewriteBriefKey, type IdMap } from "@/lib/migrate/v0/idmap";
export { readV0, V0_BACKUP_KEY, V0_KEY, type V0Read, type V0Source } from "@/lib/migrate/v0/read";
export { detectV0, unwrapV0 } from "@/lib/migrate/v0/schema";
export { MigrationError, migrateV0, type MigrateV0Options, type MigrateV0Result, type MigrationReport } from "@/lib/migrate/v0/to-v2";
