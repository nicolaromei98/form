import { z } from "zod";
import { ProjectId } from "@/lib/domain/schema/ids";
import { defineOp, isRejection } from "@/lib/ops/registry/_contract";
import { baseOf, part, setIfChanged, title } from "@/lib/ops/registry/_helpers";
import { mustIndexed, projectTitle } from "@/lib/ops/registry/_workspace";

/**
 * Archives a project (plan §4.4 row 18, Q9): its index entry gets `archivedAt`, and the project
 * document is untouched (ProjectStatus has no "archived"). An archived project leaves the index's
 * main list and the cross-project load, and can still be opened and restored.
 */
export default defineOp({
  name: "archiveProject",
  scope: "workspace",
  schema: z.object({ op: z.literal("archiveProject"), projectId: ProjectId }).strict(),

  reduce(d, op, ctx) {
    const entry = mustIndexed(baseOf(d), op.projectId);
    if (isRejection(entry)) return entry;
    if (entry.archivedAt !== null) return;
    setIfChanged(d.projects[op.projectId], "archivedAt", ctx.now);
  },

  caption({ op, env }) {
    const name = projectTitle(env, op.projectId);
    return part(name === null ? "Project archived" : `${title(name)} archived`);
  },
  noopCaption({ op, env }) {
    const name = projectTitle(env, op.projectId);
    return name === null ? "That project is already archived" : `${title(name)} is already archived`;
  },
  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: [],
  parser: { exempt: "An index action; \"Archive this project\" arrives with the Phase 5 parser.", until: 5 },
  palette: { exempt: "An index action; a palette phrase arrives with the Phase 5 parser.", until: 5 },
  transport: { exempt: "Not exposed to the agent until the Phase 5 transport.", until: 5 },
  sample: (fx, mint) => ({ op: "archiveProject", projectId: fx.project?.id ?? mint("project") }),
});
