import { z } from "zod";
import { AssetId, ProjectId } from "@/lib/domain/schema/ids";
import { ViewKind } from "@/lib/domain/schema/primitives";
import { ProjectDocSchema } from "@/lib/domain/schema/project";
import { WorkspaceDocSchema } from "@/lib/domain/schema/workspace";

/** Where /demo keeps its state in localStorage. The v0 keys are never written (plan §7.3). */
export const DEMO_STORAGE_KEY = "form.demo.v2";
/** An unreadable save is copied here before anything replaces it */
export const DEMO_BACKUP_KEY = "form.demo.v2.backup";

/** The /demo save (plan §3.6, §7.3) */
export const DemoEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(2),
    workspace: WorkspaceDocSchema,
    /** Live projects only: deleted ones are compacted on save */
    projects: z.record(ProjectId, ProjectDocSchema),
    activeProjectId: ProjectId.nullable(),
    /** Used when the URL has no ?view= */
    lastView: ViewKind.nullable(),
    /** "{n} changes · saved locally" */
    changes: z.int().min(0),
    notices: z.object({ weekendsPending: z.boolean() }).strict(),
    /** ast_… → the legacy IndexedDB key "img-…", so v0 blobs are never copied */
    assetAliases: z.record(AssetId, z.string().min(1).max(64)),
    migratedFrom: z.enum(["v0-main", "v0-backup"]).nullable(),
  })
  .strict();

export type DemoEnvelope = z.infer<typeof DemoEnvelopeSchema>;
