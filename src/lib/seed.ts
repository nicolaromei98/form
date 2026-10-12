import type { Doc, Task, Tool, View } from "./schema";

export const DEFAULT_VIEW: View = {
  representation: "cards",
  density: "comfortable",
  layout: "grid",
  columns: null,
  sort: "manual",
  hideDone: false,
  highlightUrgent: false,
  fields: { priority: true, estimate: true, progress: true },
};

export function emptyDoc(): Doc {
  return {
    tool: null,
    tasks: {},
    order: [],
    view: { ...DEFAULT_VIEW, fields: { ...DEFAULT_VIEW.fields } },
    proposal: null,
  };
}

/** Clearly labelled sample start date for the demo schedule. */
export const SAMPLE_START_DATE = "2026-09-28";

export function uid(prefix = "t") {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function task(partial: Partial<Task> & Pick<Task, "id" | "title">): Task {
  return {
    status: "todo",
    priority: "medium",
    progress: 0,
    estimate: null,
    cost: null,
    parentId: null,
    emphasis: false,
    origin: "template",
    ...partial,
  };
}

/** The flagship fictional project: a studio building its new website. */
export function websiteTemplate(title: string): { tool: Tool; tasks: Record<string, Task>; order: string[] } {
  const list: Task[] = [
    task({ id: "t-research", title: "Research", status: "done", priority: "low", progress: 100, estimate: 3 }),
    task({ id: "t-visual", title: "Visual Direction", status: "review", priority: "high", progress: 85, estimate: 4 }),
    task({ id: "t-ui", title: "UI Design", status: "active", priority: "urgent", progress: 30, estimate: 6 }),
    task({ id: "t-dev", title: "Development", status: "todo", priority: "medium", progress: 0, estimate: 8 }),
  ];
  return {
    tool: {
      id: uid("tool"),
      kind: "project",
      template: "website",
      title,
      startDate: SAMPLE_START_DATE,
      startDateIsSample: true,
      blocks: ["header", "metrics", "collection"],
    },
    tasks: Object.fromEntries(list.map((t) => [t.id, t])),
    order: list.map((t) => t.id),
  };
}
