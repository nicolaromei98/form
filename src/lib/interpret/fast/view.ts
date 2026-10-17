import { VIEW_LABEL } from "@/lib/domain/labels";
import type { ViewKind } from "@/lib/domain/schema/primitives";
import type { ProjectDoc, Task } from "@/lib/domain/schema/project";
import { homeView } from "@/lib/domain/views";
import { clarify, collect, type Collector, type FamilyResult } from "@/lib/interpret/fast/context";
import { makeOp } from "@/lib/ops/build";

/**
 * Views (plan §8.4): closing a view's tab (step 2), the view a sentence names, Focus and "show me
 * everything again". v0's `setRepresentation` becomes addView when the project doesn't have the
 * view, plus a local show (Q6); v0's `setView.focusId` becomes setFocus.
 */

const VIEW_NOUN: readonly (readonly [RegExp, ViewKind])[] = [
  // Plural only: "delete this card" is about a task
  [/^(project tracker|tracker|cards)$/, "cards"],
  [/^(kanban board|kanban|board)$/, "board"],
  [/^(timeline|gantt(?: chart)?)$/, "timeline"],
  [/^(team workload|team|workload)$/, "team"],
  [/^focus$/, "focus"],
  [/^(status brief|brief)$/, "brief"],
];

const REMOVE_VIEW = /^(?:please )?(?:remove|delete|hide|drop|get rid of)(?: the| this| my)? ([a-z ]+?)(?: view| tab)?$/;

/** "Remove the board": closes a view's tab. Never the data, never the last view (v0 wording). */
export function removeView(s: string, project: ProjectDoc | null): FamilyResult | null {
  const m = REMOVE_VIEW.exec(s);
  const view = m ? VIEW_NOUN.find(([re]) => re.test(m[1]))?.[1] : undefined;
  if (!view || !project) return null;
  const label = VIEW_LABEL[view];
  if (!project.views.includes(view)) return clarify(`There's no ${label} view in this project.`, "anchored");
  if (project.views.length === 1) return clarify(`The ${label} is this project's only view · add another before removing it.`, "anchored");
  return collect(project, (c) => c.op(makeOp({ op: "removeView", view })), "anchored");
}

/** The view a sentence names, the last one mentioned winning; `list` for "as a list" (v0 `representationIn`) */
export function viewIn(s: string, creating: boolean): { view: ViewKind; list: boolean } | null {
  const hits: { view: ViewKind; at: number; list: boolean }[] = [];
  const push = (re: RegExp, view: ViewKind, list = false) => {
    const m = re.exec(s);
    if (m) hits.push({ view, at: m.index, list });
  };
  push(/\b(timeline|gantt|schedule|roadmap|calendar|over time|chronolog\w*|deadlines?|due dates?)\b/, "timeline");
  // "sort by status" is a sort, not a board
  const sortByStatus = /\b(sort|order|rank|arrange)\b.*\bby status\b/.test(s);
  push(sortByStatus ? /\b(board|kanban|status columns|swim ?lanes)\b/ : /\b(board|kanban|by status|status columns|swim ?lanes)\b/, "board");
  if (!creating) {
    push(/\b(?:as|into|to|show|switch to|return to|back to)\b(?: the| a| an| my)?(?: original| default| first)?(?: project)? (?:tracker|cards?|card view)\b/, "cards");
    push(/\b(back|return|revert)\b.*\b(tracker|cards?|original)\b/, "cards");
    push(/\b(?:create|add|make|build|open|set ?up|give me)\b(?: me)?(?: the| a| an| my)?(?: original| default)?(?: project)? (?:tracker|cards? view)\b/, "cards");
    push(/\b(?:as|into|in) (?:a )?list\b|\blist (?:view|layout)\b/, "cards", true);
  }
  if (!hits.length) return null;
  const last = hits.sort((a, b) => a.at - b.at)[hits.length - 1];
  return { view: last.view, list: last.list };
}

const FOCUS_ASK =
  /\b(focus( mode)?|what should i (do|work on|tackle)( now| next| first| today)?|what'?s next|what is next|where (do|should) i start|what matters (most|now)|help me (focus|prioriti[sz]e))\b/;
const EXIT_FOCUS = /\b(exit|leave|stop) focus\b|\bshow (me )?(everything|all( tasks)?)( again)?\b/;

/**
 * Focus (v0, early return at the workspace level): "Focus on Development" pins it, "What should I
 * work on now?" hands the pick back to FORM. With nothing open there is nothing to pin, and only
 * the view opens (v0: "Focus · everything is done").
 */
export function focus(s: string, project: ProjectDoc, named: Task | null): FamilyResult | null {
  const focusNamed = /\bfocus (on|mode for)\b/.test(s) && named ? named : null;
  if (!focusNamed && !(FOCUS_ASK.test(s) && !/\b(exit|leave|stop)\b/.test(s))) return null;
  const open = Object.values(project.tasks).some((t) => t.status !== "done");
  return collect(project, (c) => {
    if (open) c.op(makeOp({ op: "setFocus", taskId: focusNamed ? focusNamed.id : null }));
    c.show("focus");
  });
}

/** "Show me everything again", "exit focus": back to the project's home view */
export function exitFocus(s: string, project: ProjectDoc): FamilyResult | null {
  if (!EXIT_FOCUS.test(s)) return null;
  return collect(project, (c) => c.show(homeView(project.views)));
}

/**
 * Brings the home view on screen as a side effect, where proposals and added blocks can be seen.
 * The change speaks, not the view (caption policy rule 4).
 */
export function revealHome(c: Collector, project: ProjectDoc, active: ViewKind): void {
  c.reveal(homeView(project.views), active);
}
