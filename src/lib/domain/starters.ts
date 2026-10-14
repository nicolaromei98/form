import { PROJECT_KIND_LABEL, PROJECT_KIND_ORDER } from "@/lib/domain/labels";
import type { ProjectKind } from "@/lib/domain/schema/primitives";
import type { TemplateTask } from "@/lib/domain/schema/template";

/**
 * Built-in starter templates, one per project kind (FORM-v1 §5.6). Structure only: titles and
 * dependencies, every estimate unknown (null) and no owners, so choosing one never invents a
 * number. They are code, never stored: the workspace holds only user templates. Each task has the
 * shape of a user template's task, so "From a template" treats both the same way.
 */

export interface Starter {
  readonly kind: ProjectKind;
  /** Shown in "From a template", next to the user's own templates */
  readonly name: string;
  readonly tasks: readonly TemplateTask[];
}

/** A task with unknown duration, waiting on earlier tasks by index */
const task = (title: string, ...dependsOn: number[]): TemplateTask => ({
  title,
  kind: "task",
  estimateDays: null,
  dependsOn,
  steps: [],
  roleHint: null,
});

/** A milestone takes no time: estimate 0 */
const milestone = (title: string, ...dependsOn: number[]): TemplateTask => ({
  title,
  kind: "milestone",
  estimateDays: 0,
  dependsOn,
  steps: [],
  roleHint: null,
});

const STARTER_TASKS: Readonly<Record<ProjectKind, readonly TemplateTask[]>> = {
  website: [
    task("Discovery"),
    task("Sitemap and content plan", 0),
    task("Visual direction", 0),
    task("UI design", 1, 2),
    task("Development", 3),
    task("Content entry", 1, 4),
    task("QA and fixes", 5),
    milestone("Launch", 6),
  ],
  "brand-identity": [
    task("Brand discovery"),
    task("Strategy and positioning", 0),
    task("Logo concepts", 1),
    task("Visual identity system", 2),
    task("Brand guidelines", 3),
    milestone("Asset delivery", 4),
  ],
  campaign: [
    task("Brief and objectives"),
    task("Creative concept", 0),
    task("Copywriting", 1),
    task("Design and production", 1),
    milestone("Client approval", 2, 3),
    task("Media setup", 4),
    milestone("Launch", 5),
    task("Results report", 6),
  ],
  product: [
    task("Research"),
    task("Requirements", 0),
    task("UX flows", 1),
    task("UI design", 2),
    task("Build", 3),
    task("Testing", 4),
    milestone("Release", 5),
  ],
  other: [task("Kick-off"), task("Plan", 0), task("Production", 1), task("Review", 2), milestone("Delivery", 3)],
};

/** Every starter, keyed by project kind */
export const STARTERS: Readonly<Record<ProjectKind, Starter>> = Object.fromEntries(
  PROJECT_KIND_ORDER.map((kind) => [kind, { kind, name: PROJECT_KIND_LABEL[kind], tasks: STARTER_TASKS[kind] }]),
) as Record<ProjectKind, Starter>;

/** The starters in the order of the project form's "Type" capsule */
export const STARTER_ORDER: readonly Starter[] = PROJECT_KIND_ORDER.map((kind) => STARTERS[kind]);

/** The starter for a project kind */
export function starterFor(kind: ProjectKind): Starter {
  return STARTERS[kind];
}
