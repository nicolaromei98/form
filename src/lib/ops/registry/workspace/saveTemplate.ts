import { z } from "zod";
import { TEMPLATE_NAME, TEMPLATE_TASKS_MAX, TEMPLATES_MAX } from "@/lib/domain/limits";
import { TemplateId } from "@/lib/domain/schema/ids";
import { Line, ProjectKind } from "@/lib/domain/schema/primitives";
import { type Template, type TemplateTask, TemplateTaskSchema } from "@/lib/domain/schema/template";
import { defineOp, reject } from "@/lib/ops/registry/_contract";
import { ensureFreshId, part, title, unique } from "@/lib/ops/registry/_helpers";
import { fitsDoc, recordBytes } from "@/lib/ops/registry/_workspace";

/**
 * Saves a user template (plan §4.4 row 13; FORM-v1 §5.6 "Save as template"): structure only, the
 * producer decides whether estimates come along. Template tasks follow the same rules as the
 * tasks they create (W4): dependencies name earlier tasks, once each; a milestone is normalised
 * to estimate 0 with no steps; a task's estimate is unknown or at least half a day.
 */

/** The template tasks as stored, or why they can't be */
function normalise(tasks: readonly TemplateTask[]): TemplateTask[] | string {
  const out: TemplateTask[] = [];
  for (const [i, t] of tasks.entries()) {
    const dependsOn = unique(t.dependsOn);
    if (dependsOn.some((j) => j >= i)) return "A template task can only follow the tasks before it.";
    if (t.kind === "task" && t.estimateDays === 0) return "An estimate is at least half a day.";
    out.push(t.kind === "milestone" ? { ...t, dependsOn, estimateDays: 0, steps: [] } : { ...t, dependsOn });
  }
  return out;
}

export default defineOp({
  name: "saveTemplate",
  scope: "workspace",
  schema: z
    .object({
      op: z.literal("saveTemplate"),
      template: z
        .object({
          templateId: TemplateId,
          name: Line(TEMPLATE_NAME),
          kind: ProjectKind,
          tasks: z.array(TemplateTaskSchema).min(1).max(TEMPLATE_TASKS_MAX),
        })
        .strict(),
    })
    .strict(),

  reduce(d, op, ctx) {
    const { templateId, name, kind } = op.template;
    const fresh = ensureFreshId(d, templateId);
    if (fresh) return fresh;
    const tasks = normalise(op.template.tasks);
    if (typeof tasks === "string") return reject("invalid_payload", tasks);
    if (Object.keys(d.templates).length >= TEMPLATES_MAX) return reject("limit", `A workspace holds at most ${TEMPLATES_MAX} templates.`);
    const template: Template = { id: templateId, name, kind, tasks, createdAt: ctx.now };
    const tooLarge = fitsDoc(d, recordBytes(templateId, template));
    if (tooLarge) return tooLarge;
    d.templates[templateId] = template;
  },

  caption: ({ op }) => part(`Saved as template · ${title(op.template.name)}`),
  // A fresh id is either saved or refused
  noopCaption: () => null,
  undoable: true,
  activity: "show",
  idempotent: false,
  deprecates: [],
  parser: { exempt: "An index action (\"Save as template\" on a project row, Phase 3 UI), never a command." },
  palette: { exempt: "An index action (\"Save as template\" on a project row, Phase 3 UI), never a palette command." },
  transport: { exempt: "Templates are saved from the project index, never by the agent." },
  sample: (_fx, mint) => ({
    op: "saveTemplate",
    template: {
      templateId: mint("template"),
      name: "Website, four phases",
      kind: "website",
      tasks: [
        { title: "Research", kind: "task", estimateDays: 3, dependsOn: [], steps: [], roleHint: "Designer" },
        { title: "Visual Direction", kind: "task", estimateDays: 4, dependsOn: [0], steps: [], roleHint: "Art director" },
        { title: "UI Design", kind: "task", estimateDays: 6, dependsOn: [1], steps: ["Wireframes", "Key screens"], roleHint: "Art director" },
        { title: "Development", kind: "task", estimateDays: 8, dependsOn: [2], steps: [], roleHint: "Developer" },
        { title: "Launch", kind: "milestone", estimateDays: 0, dependsOn: [3], steps: [], roleHint: null },
      ],
    },
  }),
});
