import { parseViewQuery, VIEW_QUERY_KEYS } from "@/lib/domain/schema/local";
import type { ViewKind } from "@/lib/domain/schema/primitives";
import type { ProjectDoc } from "@/lib/domain/schema/project";
import { homeView } from "@/lib/domain/views";

/**
 * The active view in the URL (plan §3.6, §8.1): `/demo?view=timeline`. It is read once, when the
 * store hydrates; otherwise the envelope's `lastView` is used, otherwise the project's home view.
 * Every tab change rewrites it with `history.replaceState` (no history entry, so Back still leaves
 * the demo). The selection and the zoom stay session-only in /demo.
 */

/** The view a `?view=` asks for, when the project has it */
export function viewFromSearch(search: string, project: Pick<ProjectDoc, "views" | "tasks"> | null): ViewKind | null {
  return parseViewQuery(search, project).activeView ?? null;
}

/** The view to open: the URL's, else the saved one, else home */
export function initialView(search: string, project: Pick<ProjectDoc, "views" | "tasks"> | null, lastView: ViewKind | null): ViewKind {
  const fromUrl = viewFromSearch(search, project);
  if (fromUrl !== null) return fromUrl;
  if (project && lastView !== null && project.views.includes(lastView)) return lastView;
  return homeView(project?.views);
}

/**
 * The URL with `?view=` set to the active view, or without it when that is the home view (or
 * there is no project). Other query keys and the hash are kept. Returns a path-relative URL.
 */
export function urlWithView(href: string, view: ViewKind | null, project: Pick<ProjectDoc, "views"> | null): string {
  const url = new URL(href);
  if (project && view !== null && view !== homeView(project.views)) url.searchParams.set(VIEW_QUERY_KEYS.view, view);
  else url.searchParams.delete(VIEW_QUERY_KEYS.view);
  const search = url.searchParams.toString();
  return `${url.pathname}${search ? `?${search}` : ""}${url.hash}`;
}

export interface UrlTarget {
  location: { href: string };
  history: { replaceState(data: unknown, unused: string, url?: string | URL | null): void };
}

/** Rewrites the URL for the view on screen; nothing when it already says so */
export function writeViewToUrl(win: UrlTarget, view: ViewKind | null, project: Pick<ProjectDoc, "views"> | null): void {
  const current = new URL(win.location.href);
  const next = urlWithView(win.location.href, view, project);
  if (next === `${current.pathname}${current.search}${current.hash}`) return;
  // The native call integrates with Next's router (node_modules/next/dist/docs, "Native History API")
  win.history.replaceState(null, "", next);
}
