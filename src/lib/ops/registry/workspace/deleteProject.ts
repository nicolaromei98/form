import { z } from "zod";
import { ProjectId } from "@/lib/domain/schema/ids";
import { defineOp, reject } from "@/lib/ops/registry/_contract";
import { baseOf, part, setIfChanged, title } from "@/lib/ops/registry/_helpers";
import { PROJECT_GONE, projectTitle } from "@/lib/ops/registry/_workspace";

/**
 * Deletes a project, softly (plan §4.4 row 20, Q9): its index entry gets `deletedAt` and the
 * document stays until it is compacted, so undo brings it back whole. It is also the demo's
 * "Reset" (v0 reset): when nothing is left in the index after the command, the caption reads
 * "Workspace reset". When the command goes on to create the project that replaces it (the demo's
 * create over an open project), the createProject part speaks for both.
 */
export default defineOp({
  name: "deleteProject",
  scope: "workspace",
  schema: z.object({ op: z.literal("deleteProject"), projectId: ProjectId }).strict(),

  reduce(d, op, ctx) {
    const base = baseOf(d);
    if (!Object.hasOwn(base.projects, op.projectId)) return reject("not_found", PROJECT_GONE);
    if (base.projects[op.projectId].deletedAt !== null) return;
    setIfChanged(d.projects[op.projectId], "deletedAt", ctx.now);
  },

  caption({ op, after, env }) {
    const index = env.workspace().projects;
    const entries = Object.values(index);
    if (entries.every((e) => e.deletedAt !== null)) return part("Workspace reset");
    // A replacement: the open project was created later in this command
    const open = env.project();
    if (open !== null && Object.hasOwn(index, open.id) && !Object.hasOwn(after.projects, open.id)) return null;
    const name = projectTitle(env, op.projectId);
    return part(name === null ? "Project deleted" : `${title(name)} deleted`);
  },
  noopCaption: () => "That project is already deleted",
  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: [],
  parser: { family: "control", examples: [{ say: "Reset the demo", fixture: "demo" }] },
  palette: { exempt: "The v0 palette has no reset phrase; the demo's Reset control and the parser cover it." },
  transport: { exempt: "Deleting a project is an index action and the demo reset, never an agent call." },
  sample: (fx, mint) => ({ op: "deleteProject", projectId: fx.project?.id ?? mint("project") }),
});
