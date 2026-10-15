import { z } from "zod";
import { LINKS_MAX } from "@/lib/domain/limits";
import { LinkSchema } from "@/lib/domain/schema/primitives";
import { defineOp, isRejection, reject } from "@/lib/ops/registry/_contract";
import { ensureFreshId, part, title } from "@/lib/ops/registry/_helpers";
import { LinkTarget, linkHolder, targetName } from "@/lib/ops/registry/_tasks";

/**
 * Adds a link to the project or to one of its tasks (plan §4.4 row 24): a label and an http(s)
 * URL. The producer mints the link id (`duplicate_id` when taken); each holds at most 20 links.
 */
export default defineOp({
  name: "addLink",
  scope: "project",
  schema: z.object({ op: z.literal("addLink"), target: LinkTarget, link: LinkSchema }).strict(),

  reduce(d, op) {
    const holder = linkHolder(d, op.target);
    if (isRejection(holder)) return holder;
    if (holder.links.length >= LINKS_MAX) {
      const who = op.target.kind === "project" ? "The project" : targetName(d, op.target);
      return reject("limit", `${who} already has ${LINKS_MAX} links.`);
    }
    const fresh = ensureFreshId(d, op.link.id);
    if (fresh) return fresh;
    holder.links.push({ id: op.link.id, label: op.link.label, url: op.link.url });
  },

  caption: ({ op, after }) =>
    part(op.target.kind === "project" ? `Link added · ${title(op.link.label)}` : `Link added to ${targetName(after, op.target)} · ${title(op.link.label)}`),
  // A fresh id is never there already: adding adds or refuses
  noopCaption: () => null,
  undoable: true,
  activity: "show",
  idempotent: false,
  deprecates: [],
  parser: { exempt: "Links are added directly until the Phase 5 parser reads URLs.", until: 5 },
  palette: { exempt: "No palette phrase for links until the Phase 5 parser.", until: 5 },
  transport: { tool: "project_edit", field: "link" },
  sample: (_fx, mint) => ({
    op: "addLink",
    target: { kind: "project" },
    link: { id: mint("link"), label: "Figma", url: "https://www.figma.com/file/form" },
  }),
});
