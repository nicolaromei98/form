// Built-in starters (FORM-v1 §5.6): one per project kind, structure only, and each one a valid
// template by the same rules as a user's.
import { describe, expect, it } from "vitest";
import { checkTemplateTasks } from "@/lib/domain/invariants/check";
import { topoOrder } from "@/lib/domain/invariants/graph";
import { PROJECT_KIND_LABEL, PROJECT_KIND_ORDER } from "@/lib/domain/labels";
import { nKeys } from "@/lib/domain/order";
import { ProjectKind, TaskId, TemplateSchema, TemplateTaskSchema } from "@/lib/domain/schema";
import { STARTER_ORDER, STARTERS, starterFor } from "@/lib/domain/starters";
import { FIXTURE_NOW } from "../../../../test/fixtures/v2/build";

describe("starters", () => {
  it("exist for every project kind, in the form's order", () => {
    expect(Object.keys(STARTERS).sort()).toEqual([...ProjectKind.options].sort());
    expect(STARTER_ORDER.map((s) => s.kind)).toEqual(PROJECT_KIND_ORDER);
    for (const kind of ProjectKind.options) {
      expect(starterFor(kind).kind).toBe(kind);
      expect(starterFor(kind).name).toBe(PROJECT_KIND_LABEL[kind]);
    }
  });

  it.each(ProjectKind.options)("%s is a valid template", (kind) => {
    const starter = STARTERS[kind];
    for (const task of starter.tasks) expect(TemplateTaskSchema.safeParse(task).success).toBe(true);
    const template = { id: "tpl_starter0000001", name: starter.name, kind, tasks: starter.tasks, createdAt: FIXTURE_NOW };
    expect(TemplateSchema.safeParse(template).success).toBe(true);
    expect(checkTemplateTasks(starter)).toEqual([]);
  });

  it.each(ProjectKind.options)("%s is structure only: no estimates, steps or roles", (kind) => {
    for (const task of STARTERS[kind].tasks) {
      expect(task.estimateDays).toBe(task.kind === "milestone" ? 0 : null);
      expect(task.steps).toEqual([]);
      expect(task.roleHint).toBeNull();
    }
  });

  it.each(ProjectKind.options)("%s flows from its first task to its last", (kind) => {
    const tasks = STARTERS[kind].tasks;
    // As a graph: one start, every task reachable from it, and titles unique
    const ids = tasks.map((_, i) => TaskId.parse(`tsk_starter${String(i).padStart(6, "0")}`));
    const keys = nKeys(tasks.length);
    const graph = { tasks: Object.fromEntries(tasks.map((t, i) => [ids[i], { id: ids[i], order: keys[i], dependsOn: t.dependsOn.map((d) => ids[d]) }])) };
    expect(topoOrder(graph)).toEqual({ order: ids, cyclic: [] });
    expect(tasks.filter((t) => t.dependsOn.length === 0)).toHaveLength(1);
    expect(new Set(tasks.map((t) => t.title)).size).toBe(tasks.length);
    // Nothing is left dangling: every task but the last has a successor
    const waitedOn = new Set(tasks.flatMap((t) => t.dependsOn));
    tasks.slice(0, -1).forEach((_, i) => expect(waitedOn.has(i), tasks[i].title).toBe(true));
  });
});
