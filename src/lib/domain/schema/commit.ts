import { z } from "zod";
import { COMMAND_TEXT, COMMIT_OPS_MAX, USER_ID } from "@/lib/domain/limits";
import { ProjectId, WorkspaceId } from "@/lib/domain/schema/ids";
import { Timestamp } from "@/lib/domain/schema/primitives";

/**
 * A commit: the §10.2 wire shape (plan §3.6). The store builds one per changed document now; the
 * Phase 2 server stores them. Commit and group ids are UUIDs minted by the store, never inside
 * `lib/ops`. Each op is parsed by its own registry schema, so here it is only `unknown`: registry
 * ops only, never local intents.
 */
export const CommitSchema = z
  .object({
    id: z.uuid(),
    /** Shared by the commits of one command, across documents */
    groupId: z.uuid(),
    docId: z.union([WorkspaceId, ProjectId]),
    baseVersion: z.int().min(0),
    /** At most 12 non-system ops, plus the runner's rebalanceOrder */
    ops: z.array(z.unknown()).min(1).max(COMMIT_OPS_MAX),
    source: z.enum(["direct", "agent", "system"]),
    /** The command text, when the commit came from one */
    command: z.string().max(COMMAND_TEXT).nullable(),
    createdAt: Timestamp,
    actorId: z.string().max(USER_ID).nullable(),
  })
  .strict();

export type Commit = z.infer<typeof CommitSchema>;
export type CommitSource = Commit["source"];
