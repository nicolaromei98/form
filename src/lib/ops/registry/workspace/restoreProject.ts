import { z } from "zod";
import { compareKeys } from "@/lib/domain/order";
import { ProjectId } from "@/lib/domain/schema/ids";
import { defineOp, isRejection } from "@/lib/ops/registry/_contract";
import { baseOf, part, setIfChanged, title } from "@/lib/ops/registry/_helpers";
import { mustIndexed, projectTitle } from "@/lib/ops/registry/_workspace";

/**
 * Brings an archived project back to the index (plan §4.4 row 19, Q9): `archivedAt` is cleared.
 * A deleted project is gone for the index (`not_found`); deleting is undone by undo, not restored.
 */
export default defineOp({
  name: "restoreProject",
  scope: "workspace",
  schema: z.object({ op: z.literal("restoreProject"), projectId: ProjectId }).strict(),

  reduce(d, op) {
    const entry = mustIndexed(baseOf(d), op.projectId);
    if (isRejection(entry)) return entry;
    setIfChanged(d.projects[op.projectId], "archivedAt", null);
  },

  caption({ op, env }) {
    const name = projectTitle(env, op.projectId);
    return part(name === null ? "Project restored" : `${title(name)} restored`);
  },
  noopCaption({ op, env }) {
    const name = projectTitle(env, op.projectId);
    return name === null ? "That project isn't archived" : `${title(name)} isn't archived`;
  },
  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: [],
  parser: { exempt: "An index action; a command for it arrives with the Phase 5 parser.", until: 5 },
  palette: { exempt: "An index action; a palette phrase arrives with the Phase 5 parser.", until: 5 },
  transport: { exempt: "Not exposed to the agent until the Phase 5 transport.", until: 5 },
  // The first archived project of the index; a fresh id when the fixture has none (it then refuses)
  sample: (fx, mint) => ({
    op: "restoreProject",
    projectId:
      Object.values(fx.workspace.projects)
        .filter((e) => e.archivedAt !== null && e.deletedAt === null)
        .map((e) => e.id)
        .sort(compareKeys)[0] ?? mint("project"),
  }),
  // Complete, but no named fixture holds an archived project yet, so the completeness test can't
  // apply the sample. The mark keeps the op out of the full-op checks until
  // test/fixtures/v2/named.ts gains one (reported by step 10d); then delete this line.
  stub: { family: "10d", until: 1 },
});
