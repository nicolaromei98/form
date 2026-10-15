import { resolvePerson } from "@/lib/domain/invariants/check";
import type { LocalViewState } from "@/lib/domain/schema/local";
import type { ViewKind } from "@/lib/domain/schema/primitives";
import type { ProjectDoc } from "@/lib/domain/schema/project";
import type { WorkspaceDoc } from "@/lib/domain/schema/workspace";
import { nextViews } from "@/lib/domain/views";

/**
 * The agent's suggestion chips and nodes (plan §8.2, ported from v0 `suggestionsFor`): contextual
 * and supported only, so a chip never lands on "unsupported". Every phrase is one the fast parser
 * routes (a unit test runs each one through it).
 */

/** Each view as something to create: the command a suggestion node or chip runs */
export const VIEW_OFFER: Readonly<Record<ViewKind, string>> = {
  cards: "Add the tracker",
  board: "Add a board",
  timeline: "Add a timeline",
  team: "Add the team view",
  focus: "Add focus",
  brief: "Add a brief",
};

/** What to make first, before any project */
export const CREATE_SUGGESTIONS: readonly string[] = Object.freeze([
  "Create a timeline for my project",
  "Create a project tracker for my new website",
  "Create a board for my new website",
]);

export interface SuggestionInput {
  project: ProjectDoc | null;
  ws: Pick<WorkspaceDoc, "people">;
  local: Pick<LocalViewState, "activeView" | "selectedTaskId">;
}

/** Contextual, supported-only suggestions: never something demo mode can't do */
export function suggestionsFor({ project, ws, local }: SuggestionInput): string[] {
  if (!project) return [...CREATE_SUGGESTIONS];

  const sel = local.selectedTaskId !== null && Object.hasOwn(project.tasks, local.selectedTaskId) ? project.tasks[local.selectedTaskId] : null;
  if (project.proposal?.kind === "subtasks") return ["Accept them", "Discard"];
  if (project.proposal) return ["Accept the plan", "Discard"];
  if (sel) {
    // From the brief, only offer changes the brief shows
    if (local.activeView === "brief") {
      return [sel.status === "done" ? "Mark it in progress" : "Mark it done", sel.status === "review" ? "Mark it in progress" : "Mark it in review", `Focus on ${sel.title}`];
    }
    return ["Break this task into smaller steps", "Make this more prominent", sel.status === "done" ? "Mark it in progress" : "Mark it done"];
  }

  const v = project.viewConfig;
  // Views the project doesn't have yet, most related to the last one created: the same offers the agent's nodes make
  const offers = nextViews(project.views).map((view) => VIEW_OFFER[view]);
  if (local.activeView === "focus") return ["Show me everything again", ...offers.slice(0, 1), "Highlight the urgent ones"];
  if (local.activeView === "brief") {
    return [v.brief.audience === "client" ? "Now make it for the team" : "Now make it for the client", v.brief.short ? "Make it longer" : "Make it shorter", ...offers.slice(0, 1)];
  }
  if (local.activeView === "team") {
    const team = project.memberIds.map((id) => resolvePerson(id, ws)).filter((p) => typeof p === "object");
    if (team.length === 0) return ["Add a sample team", "Add Giulia and Paolo to the team", ...offers.slice(0, 1)];
    // Q3: a capacity FORM doesn't know is asked for, never invented
    const unknown = team.find((p) => p.capacityDaysPerWeek === null);
    if (unknown) return [`Set ${unknown.name}'s capacity to 4 days a week`, "Balance the workload", "Who's overloaded?"];
    return ["Balance the workload", "Who's overloaded?", "Assign Development to Sara", ...offers.slice(0, 1)];
  }
  const out = offers.slice(0, 2);
  if (local.activeView === "cards" && (v.density === "comfortable" || v.sort !== "priority")) out.push("Make the cards more compact and sort them by priority");
  if (!project.blocks.includes("moodboard")) out.push("Add a moodboard for the project");
  else if (Object.keys(project.moodboard.items).length >= 3) out.push("Arrange the moodboard as a collage");
  if (!project.blocks.includes("progress")) out.push("Add a progress indicator");
  if (!v.highlightUrgent) out.push("Highlight the urgent ones");
  return out.slice(0, 4);
}
