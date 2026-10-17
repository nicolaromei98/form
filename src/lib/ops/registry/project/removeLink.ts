import { z } from "zod";
import { sortedByOrder } from "@/lib/domain/order";
import { LinkId } from "@/lib/domain/schema/ids";
import { defineOp, isRejection, reject } from "@/lib/ops/registry/_contract";
import { part } from "@/lib/ops/registry/_helpers";
import { LinkTarget, linkHolder } from "@/lib/ops/registry/_tasks";

/**
 * Removes a link from the project or one of its tasks (plan §4.4 row 25). A missing target or
 * link is `not_found`, as removing a missing task is.
 */
export default defineOp({
  name: "removeLink",
  scope: "project",
  schema: z.object({ op: z.literal("removeLink"), target: LinkTarget, linkId: LinkId }).strict(),

  reduce(d, op) {
    const holder = linkHolder(d, op.target);
    if (isRejection(holder)) return holder;
    const i = holder.links.findIndex((l) => l.id === op.linkId);
    if (i < 0) return reject("not_found", "That link isn't there anymore.");
    holder.links.splice(i, 1);
  },

  caption: () => part("Link removed"),
  // A link is either there to remove or not_found
  noopCaption: () => null,
  undoable: true,
  activity: "show",
  idempotent: false,
  deprecates: [],
  parser: { exempt: "Links are removed directly until the Phase 5 parser reads URLs.", until: 5 },
  palette: { exempt: "No palette phrase for links until the Phase 5 parser.", until: 5 },
  transport: { tool: "project_edit", field: "link" },
  // generated60 links one task to Figma
  sampleOn: "generated60",
  sample(fx) {
    const task = sortedByOrder(fx.project!.tasks).find((t) => t.links.length > 0)!;
    return { op: "removeLink", target: { kind: "task", taskId: task.id }, linkId: task.links[0].id };
  },
});
