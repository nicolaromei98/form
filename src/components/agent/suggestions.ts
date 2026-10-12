import type { Doc } from "@/lib/schema";

/** Contextual, supported-only suggestions. Never offers something demo mode can't do. */
export function suggestionsFor(doc: Doc, selectedId: string | null): string[] {
  if (!doc.tool) return ["Create a project tracker for my new website", "Help me organise my website launch"];

  const sel = selectedId ? doc.tasks[selectedId] : null;
  if (doc.proposal) return ["Accept them", "Discard"];
  if (doc.plan) return ["Accept the plan", "Discard"];
  if (sel) {
    if (sel.parentId) return ["Mark it done", "Make it urgent"];
    const out = ["Break this task into smaller steps", "Make this more prominent"];
    out.push(sel.status === "done" ? "Mark it in progress" : "Mark it done");
    return out;
  }

  const v = doc.view;
  const out: string[] = [];
  if (v.representation === "focus") return ["Show me everything again", "Show this project as a timeline", "Highlight the urgent ones"];
  if (v.representation === "team") {
    if (!doc.people.length) return ["Add a sample team", "Add Giulia and Paolo to the team", "Change back to the original project tracker"];
    return ["Balance the workload", "Who's overloaded?", "Assign Development to Sara", "Change back to the original project tracker"];
  }
  out.push("What should I work on now?");
  if (v.representation === "cards") {
    if (v.density === "comfortable" || v.sort !== "priority") out.push("Make the cards more compact and sort them by priority");
    out.push("Show the team workload");
    out.push("Show this project as a timeline");
  } else if (v.representation === "timeline") {
    out.push("Change back to the original project tracker");
    out.push("Show it as a board");
  } else {
    out.push("Show this project as a timeline");
    out.push("Change back to the original project tracker");
  }
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
  { group: "Create", needs: "none", items: ["Create a project tracker for my new website"] },
  {
    group: "Decide",
    needs: "tool",
    items: ["What should I work on now?", "Focus on Development"],
  },
  {
    group: "Change the view",
    needs: "tool",
    items: ["Show this project as a timeline", "Show it as a board", "Change back to the original project tracker", "Show it as a list"],
  },
  {
    group: "Layout",
    needs: "tool",
    items: ["Make the cards more compact", "Show the tasks in two columns", "Sort them by priority", "Hide completed tasks", "Highlight the urgent ones", "Add a progress indicator"],
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
  tool: "Create a tracker first",
  selection: "Select a task first",
};
