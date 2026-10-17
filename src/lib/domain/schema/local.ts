import { z } from "zod";
import { TaskId } from "@/lib/domain/schema/ids";
import { ViewKind } from "@/lib/domain/schema/primitives";
import type { ProjectDoc } from "@/lib/domain/schema/project";
import { homeView } from "@/lib/domain/views";

/**
 * Local view state (plan §1.2, §3.6, Q6): the active view, the selection and the timeline zoom.
 * Never in a document, a commit or the undo stack. It lives in the URL in /app (Phase 3), and in
 * the URL plus the demo envelope in /demo.
 */

export const TimelineZoom = z.enum(["day", "week", "month"]);
/** The v0 timeline is a day grid */
export const DEFAULT_ZOOM: TimelineZoom = "day";

export const LocalViewStateSchema = z
  .object({
    activeView: ViewKind,
    selectedTaskId: TaskId.nullable(),
    timelineZoom: TimelineZoom,
  })
  .strict();

export type TimelineZoom = z.infer<typeof TimelineZoom>;
export type LocalViewState = z.infer<typeof LocalViewStateSchema>;

/** The URL query keys, in the order `serializeViewQuery` writes them (FORM-v1 §4: `?view=timeline&task=tsk_x`) */
export const VIEW_QUERY_KEYS = { view: "view", task: "task", zoom: "zoom" } as const;

/** Where a project opens: its home view, nothing selected, the day grid */
export function defaultLocalViewState(project: Pick<ProjectDoc, "views"> | null): LocalViewState {
  return { activeView: homeView(project?.views), selectedTaskId: null, timelineZoom: DEFAULT_ZOOM };
}

/**
 * Reads `?view=…&task=…&zoom=…`. Anything unknown is dropped: a view the project doesn't have, a
 * task that isn't in it, an unknown zoom. Without a project, only the zoom can be known. The
 * leading "?" is optional; the first value of a repeated key wins.
 */
export function parseViewQuery(
  search: string,
  project: Pick<ProjectDoc, "views" | "tasks"> | null,
): Partial<LocalViewState> {
  const params = new URLSearchParams(search);
  const out: Partial<LocalViewState> = {};

  const view = ViewKind.safeParse(params.get(VIEW_QUERY_KEYS.view));
  if (project && view.success && project.views.includes(view.data)) out.activeView = view.data;

  const task = TaskId.safeParse(params.get(VIEW_QUERY_KEYS.task));
  if (project && task.success && Object.hasOwn(project.tasks, task.data)) out.selectedTaskId = task.data;

  const zoom = TimelineZoom.safeParse(params.get(VIEW_QUERY_KEYS.zoom));
  if (zoom.success) out.timelineZoom = zoom.data;

  return out;
}

/**
 * The query for a local state, defaults omitted: "" when everything is default, otherwise "?…"
 * with the keys in a fixed order. Ids and enum values need no escaping.
 */
export function serializeViewQuery(v: LocalViewState, project: Pick<ProjectDoc, "views">): string {
  const parts: string[] = [];
  if (v.activeView !== homeView(project.views)) parts.push(`${VIEW_QUERY_KEYS.view}=${v.activeView}`);
  if (v.selectedTaskId !== null) parts.push(`${VIEW_QUERY_KEYS.task}=${v.selectedTaskId}`);
  if (v.timelineZoom !== DEFAULT_ZOOM) parts.push(`${VIEW_QUERY_KEYS.zoom}=${v.timelineZoom}`);
  return parts.length ? `?${parts.join("&")}` : "";
}
