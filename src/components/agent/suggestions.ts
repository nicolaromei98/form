import { nextViews } from "@/lib/views";
import type { Doc, Representation } from "@/lib/schema";

/**
 * Each view as something to create: the command a suggestion node or chip runs.
 * Every command is one the demo parser routes to that view (verified), so a node
 * never lands on "unsupported".
 */
export const VIEW_OFFER: Record<Representation, string> = {
  cards: "Add the tracker",
  board: "Add a board",
  timeline: "Add a timeline",
  team: "Add the team view",
  focus: "Add focus",
  brief: "Add a brief",
};

/** Contextual, supported-only suggestions. Never offers something demo mode can't do. */
export function suggestionsFor(doc: Doc, selectedId: string | null): string[] {
  if (!doc.tool) return ["Create a timeline for my project", "Create a project tracker for my new website", "Create a board for my new website"];

  const sel = selectedId ? doc.tasks[selectedId] : null;
  if (doc.proposal) return ["Accept them", "Discard"];
  if (doc.plan) return ["Accept the plan", "Discard"];
  if (sel) {
    if (sel.parentId) return ["Mark it done", "Make it urgent"];
    // From the brief, only offer changes the brief shows
    if (doc.view.representation === "brief") {
      return [sel.status === "done" ? "Mark it in progress" : "Mark it done", sel.status === "review" ? "Mark it in progress" : "Mark it in review", `Focus on ${sel.title}`];
    }
    const out = ["Break this task into smaller steps", "Make this more prominent"];
    out.push(sel.status === "done" ? "Mark it in progress" : "Mark it done");
    return out;
  }

  const v = doc.view;
  // Views the project doesn't have yet, most related to the last one created: the same offers the agent's nodes make
  const offers = nextViews(doc.tool.views).map((r) => VIEW_OFFER[r]);
  if (v.representation === "focus") return ["Show me everything again", ...offers.slice(0, 1), "Highlight the urgent ones"];
  if (v.representation === "brief") {
    return [(v.briefAudience ?? "client") === "client" ? "Now make it for the team" : "Now make it for the client", v.briefShort ? "Make it longer" : "Make it shorter", ...offers.slice(0, 1)];
  }
  if (v.representation === "team") {
    if (!doc.people.length) return ["Add a sample team", "Add Giulia and Paolo to the team", ...offers.slice(0, 1)];
    return ["Balance the workload", "Who's overloaded?", "Assign Development to Sara", ...offers.slice(0, 1)];
  }
  const out = offers.slice(0, 2);
  if (v.representation === "cards" && (v.density === "comfortable" || v.sort !== "priority")) out.push("Make the cards more compact and sort them by priority");
  const moodboard = doc.tool.blocks.includes("moodboard");
  if (!moodboard) out.push("Add a moodboard for the project");
  else if (doc.mood.length >= 3) out.push("Arrange the moodboard as a collage");
  if (!doc.tool.blocks.includes("progress")) out.push("Add a progress indicator");
  if (!v.highlightUrgent) out.push("Highlight the urgent ones");
  return out.slice(0, 4);
}

export type Requirement = "none" | "tool" | "selection";

/** The command palette: what demo mode understands, grouped, with what each group needs first. */
export const CAPABILITIES: { group: string; needs: Requirement; items: string[] }[] = [
  { group: "Create", needs: "none", items: ["Create a timeline for my project", "Create a project tracker for my new website", "Create a board for my new website"] },
  {
    group: "Decide",
    needs: "tool",
    items: ["What should I work on now?", "Focus on Development"],
  },
  {
    // Views are created when asked for; once created they stay as tabs
    group: "Add a view",
    needs: "tool",
    items: ["Add a timeline", "Add a board", "Add the tracker", "Add the team view", "Add focus", "Add a brief", "Show it as a list"],
  },
  {
    group: "Layout",
    needs: "tool",
    items: ["Make the cards more compact", "Show the tasks in two columns", "Sort them by priority", "Hide completed tasks", "Highlight the urgent ones", "Add a progress indicator"],
  },
  {
    group: "Brief",
    needs: "tool",
    items: ["Write a status update for the client", "Now make it for the team", "Make the brief shorter", "What do I tell the client?", "Add to the brief: homepage preview on Friday", "Reset the brief"],
  },
  {
    group: "Team",
    needs: "tool",
    items: [
      "Show the team workload",
      "Who's overloaded?",
      "Balance the workload",
      "Assign Development to Sara",
      "Add Giulia and Paolo to the team",
      "Set Marta's capacity to 10 days",
      "Add a sample team",
    ],
  },
  {
    group: "Moodboard",
    needs: "tool",
    items: [
      "Add a moodboard for the project",
      "Add the colours #0C0C0C, off-white and terracotta",
      "Add a note: warm, tactile, editorial",
      "Tidy up the moodboard",
      "Arrange the moodboard in a grid",
      "Arrange the moodboard as a collage",
      "Hide the moodboard",
    ],
  },
  {
    group: "Selected task",
    needs: "selection",
    items: ["Break this task into smaller steps", "Make this more prominent", "Mark it done", "Set the cost to €2,400"],
  },
];

export const REQUIREMENT_HINT: Record<Requirement, string> = {
  none: "",
  tool: "Create a project first",
  selection: "Select a task first",
};
