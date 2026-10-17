import type { ViewKind } from "@/lib/domain/schema/primitives";

/**
 * View relationships (moved from v0 `lib/views.ts`). They take a project's `views` list rather
 * than a document, so selectors stay stable and the module stays pure. `replacesProject` moved to
 * the parser and `announceView` to the caption composer.
 */

/** Views that show the tasks themselves: where proposals, sorting and "everything" live */
export const TASK_VIEWS: readonly ViewKind[] = ["cards", "board", "timeline"];

export function isTaskView(view: ViewKind): boolean {
  return TASK_VIEWS.includes(view);
}

/** Every view, in the tab order of v0 documents saved before progressive creation */
export const VIEW_ORDER: readonly ViewKind[] = ["cards", "board", "timeline", "team", "focus", "brief"];

/**
 * What to suggest after each view, most related first. Keyed on the view created last, so the
 * suggestions follow what the user just made.
 */
export const RELATED: Readonly<Record<ViewKind, readonly ViewKind[]>> = {
  // Same tasks over time, by status, then by person (the template ships owners)
  cards: ["timeline", "board", "team"],
  // Lanes show what is active; Focus picks the one that matters
  board: ["focus", "timeline", "team"],
  // A schedule raises who does it, then where things stand, then what to tell the client
  timeline: ["team", "board", "brief"],
  // Load per person → tell the team; then the schedule; then the one task
  team: ["brief", "timeline", "focus"],
  // The chosen task in sequence, who owns it, what to report
  focus: ["timeline", "team", "brief"],
  // From prose back to the work
  brief: ["timeline", "team", "cards"],
};

/** Views not created yet, most related to the last one created first. Empty without a project. */
export function nextViews(views: readonly ViewKind[] | null | undefined, max = 3): ViewKind[] {
  const last = views?.[views.length - 1];
  if (!views || !last) return [];
  return [...new Set([...RELATED[last], ...VIEW_ORDER])].filter((v) => !views.includes(v)).slice(0, max);
}

/**
 * The project's home view: the first task view the user created (usually the one the project was
 * born as). "Show me everything again" returns here instead of assuming a tracker exists. A
 * project with no task view left falls back to its first view, so home is always a view the
 * project has (v0 answered "cards" there); with no project it is "cards".
 */
export function homeView(views: readonly ViewKind[] | null | undefined): ViewKind {
  return views?.find(isTaskView) ?? views?.[0] ?? "cards";
}

/** Views in `after` that `before` lacks, in creation order */
export function addedViews(before: readonly ViewKind[], after: readonly ViewKind[]): ViewKind[] {
  return after.filter((v) => !before.includes(v));
}
