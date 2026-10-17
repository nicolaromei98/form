import { REPRESENTATION_LABEL, type Doc, type Representation } from "./schema";

/** Views that show the tasks themselves: where proposals, sorting and "everything" live */
export const TASK_VIEWS: Representation[] = ["cards", "board", "timeline"];

/**
 * The project's home view: the first task view the user created (usually the one
 * the project was born as). "Show me everything again" returns here instead of
 * assuming a tracker exists.
 */
export function homeView(doc: Doc): Representation {
  return doc.tool?.views.find((v) => TASK_VIEWS.includes(v)) ?? "cards";
}

/**
 * What to suggest after each view, most related first. Keyed on the view created
 * last, so the suggestions follow what the user just made.
 */
const RELATED: Record<Representation, Representation[]> = {
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
const FALLBACK: Representation[] = ["cards", "board", "timeline", "team", "focus", "brief"];

/** Views not created yet, most related to the last one created first. Takes the list itself so store selectors stay stable. */
export function nextViews(views: readonly Representation[] | undefined, max = 3): Representation[] {
  const last = views?.[views.length - 1];
  if (!views || !last) return [];
  return [...new Set([...RELATED[last], ...FALLBACK])].filter((v) => !views.includes(v)).slice(0, max);
}

/** Views a change just created, in creation order (a new project's first view doesn't count: it mounts with the header). */
export function addedViews(prev: Doc, next: Doc): Representation[] {
  if (!prev.tool || !next.tool || prev.tool.id !== next.tool.id) return [];
  return next.tool.views.filter((v) => !prev.tool!.views.includes(v));
}

/** The created view the ink should travel to: the one now on screen, else the first */
export function addedView(prev: Doc, next: Doc): Representation | null {
  const added = addedViews(prev, next);
  return added.find((v) => v === next.view.representation) ?? added[0] ?? null;
}

// A name or a note that happens to contain the words is never a request
const NAMING = /\b(called|named|titled|rename[ds]?)\b|\bnote\b/;
const NEW_PROJECT =
  /\b(create|start|build|set ?up|make|spin up|open|begin|give me|i need)\b.*\b(new|another|second|fresh|separate|different) (project|tracker|planner|workspace)\b|^(an? )?(new|another) (project|tracker)\b/;
const EXPLICIT_PROJECT = /\b(create|build|generate|set ?up|spin up)\b.*\b(project|planner|workspace)\b/;
const VIEW_WORD = /\b(tracker|board|kanban|timeline|gantt|schedule|team|workload|focus|brief|cards?|list|moodboards?)\b/;

/**
 * Does this command replace the open project? Only an explicit request for a new or
 * another one ("create a new project", "set up a project for the launch"). Naming a
 * view ("create a timeline for my project") adds that view instead. Shared by both
 * engines so they never disagree.
 */
export function replacesProject(command: string): boolean {
  const s = command.toLowerCase().replace(/\s+/g, " ").trim();
  if (NAMING.test(s)) return false;
  return NEW_PROJECT.test(s) || (EXPLICIT_PROJECT.test(s) && !VIEW_WORD.test(s));
}

/** "Team · Marta over capacity" → "Team view added · Marta over capacity", for any engine */
export function announceView(message: string, added: Representation[]): string {
  let out = message;
  for (const view of added) {
    const label = REPRESENTATION_LABEL[view];
    // Already said (e.g. by Claude): don't say it twice
    if (new RegExp(`(^|· )${label} (view )?added\\b`, "i").test(out)) continue;
    const parts = out ? out.split(" · ") : [];
    // The view's own name anywhere in the message becomes the announcement; otherwise it is appended
    const at = parts.findIndex((p) => p === label || (view === "brief" && p === "Status brief"));
    if (at >= 0) parts[at] = `${label} view added`;
    else parts.push(`${label} view added`);
    out = parts.join(" · ");
  }
  return out.slice(0, 280);
}

/** Docs saved before views were created one by one keep the view that was on screen; the agent offers the rest */
export function migrateViews(raw: unknown, doc: Doc): Doc {
  const t = (raw as { tool?: { views?: unknown } } | null)?.tool;
  if (!doc.tool || !t || Array.isArray(t.views)) return doc;
  return { ...doc, tool: { ...doc.tool, views: [doc.view.representation] } };
}
