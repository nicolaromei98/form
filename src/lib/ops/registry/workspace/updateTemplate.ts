import { z } from "zod";
import { PROJECT_KIND_LABEL } from "@/lib/domain/labels";
import { TEMPLATE_NAME } from "@/lib/domain/limits";
import { compareKeys } from "@/lib/domain/order";
import { TemplateId } from "@/lib/domain/schema/ids";
import { Line, ProjectKind } from "@/lib/domain/schema/primitives";
import { defineOp, reject } from "@/lib/ops/registry/_contract";
import { part, setIfChanged, title } from "@/lib/ops/registry/_helpers";
import { fitsDoc, jsonBytes, wsKey } from "@/lib/ops/registry/_workspace";

/** Renames a user template or changes its project kind (plan §4.4 row 14, Q12). Settings only. */

const field = <F extends string, V extends z.ZodType>(f: F, value: V) =>
  z.object({ op: z.literal("updateTemplate"), templateId: TemplateId, field: z.literal(f), value }).strict();

export default defineOp({
  name: "updateTemplate",
  scope: "workspace",
  schema: z.discriminatedUnion("field", [field("name", Line(TEMPLATE_NAME)), field("kind", ProjectKind)]),

  reduce(d, op) {
    if (!Object.hasOwn(d.templates, op.templateId)) return reject("not_found", "That template isn't in the workspace anymore.");
    const t = d.templates[op.templateId];
    switch (op.field) {
      case "name": {
        const tooLarge = fitsDoc(d, jsonBytes(op.value), jsonBytes(t.name));
        if (tooLarge) return tooLarge;
        setIfChanged(t, "name", op.value);
        return;
      }
      case "kind":
        setIfChanged(t, "kind", op.value);
        return;
    }
  },

  caption({ op, after }) {
    const t = after.templates[op.templateId];
    const key = wsKey.template(op.templateId, op.field);
    return op.field === "name"
      ? part(`Template renamed to ${title(t.name)}`, key)
      : part(`${title(t.name)} · ${PROJECT_KIND_LABEL[t.kind]}`, key);
  },
  noopCaption({ op, before }) {
    const t = before.templates[op.templateId];
    return op.field === "name" ? `Template already called ${title(t.name)}` : `${title(t.name)} is already set to ${PROJECT_KIND_LABEL[t.kind]}`;
  },
  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: [],
  parser: { exempt: "Templates are edited in Settings, never by a command." },
  palette: { exempt: "Templates are edited in Settings, never from the palette." },
  transport: { exempt: "Templates are edited in Settings, never by the agent." },
  // The first user template; a fresh id when the fixture has none (it then refuses)
  sample: (fx, mint) => ({
    op: "updateTemplate",
    templateId: Object.keys(fx.workspace.templates).sort(compareKeys)[0] ?? mint("template"),
    field: "name",
    value: "Website, renamed",
  }),
  sampleOn: "demoExtras",
});
