import { z } from "zod";
import { compareKeys } from "@/lib/domain/order";
import { TemplateId } from "@/lib/domain/schema/ids";
import { defineOp, reject } from "@/lib/ops/registry/_contract";
import { part } from "@/lib/ops/registry/_helpers";

/**
 * Deletes a user template (plan §4.4 row 15). Projects made from it keep their tasks: a template
 * is only structure, copied at creation. The built-in starters are code and can't be deleted.
 */
export default defineOp({
  name: "deleteTemplate",
  scope: "workspace",
  schema: z.object({ op: z.literal("deleteTemplate"), templateId: TemplateId }).strict(),

  reduce(d, op) {
    if (!Object.hasOwn(d.templates, op.templateId)) return reject("not_found", "That template isn't in the workspace anymore.");
    delete d.templates[op.templateId];
  },

  caption: () => part("Template deleted"),
  // A template is either there to delete or not_found
  noopCaption: () => null,
  undoable: true,
  activity: "show",
  idempotent: false,
  deprecates: [],
  parser: { exempt: "Templates are deleted in Settings, never by a command." },
  palette: { exempt: "Templates are deleted in Settings, never from the palette." },
  transport: { exempt: "Templates are deleted in Settings, never by the agent." },
  // The first user template; a fresh id when the fixture has none (it then refuses)
  sample: (fx, mint) => ({
    op: "deleteTemplate",
    templateId: Object.keys(fx.workspace.templates).sort(compareKeys)[0] ?? mint("template"),
  }),
  sampleOn: "demoExtras",
});
