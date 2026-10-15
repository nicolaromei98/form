// The golden parser corpus (plan §10.4, "about 130 commands"; 212 here), each command on a legacy
// fixture state (parser-harness.ts). The 42 palette phrases, the v0 §9 examples, the registry's
// parser examples, the audit's false-positive table (AUDIT §11, kept in /demo until Phase 5) and
// edge cases: the v0 clarify and unsupported answers, steps, no-ops, plural sentences, clamps, the
// "N weeks" rule and capacities.
import type { LegacyFixture } from "./parser-harness";

export interface CorpusCase {
  say: string;
  fixture: LegacyFixture;
}

const on = (fixture: LegacyFixture, ...says: string[]): CorpusCase[] => says.map((say) => ({ say, fixture }));

/** The 42 palette phrases, on the fixture each one is meant for */
export const PALETTE_CASES: readonly CorpusCase[] = [
  ...on("empty", "Create a timeline for my project", "Create a project tracker for my new website", "Create a board for my new website"),
  ...on("demo", "What should I work on now?", "Focus on Development"),
  ...on("demo", "Add a timeline", "Add a board", "Add the tracker", "Add the team view", "Add focus", "Add a brief", "Show it as a list"),
  ...on("demo", "Make the cards more compact", "Show the tasks in two columns", "Sort them by priority", "Hide completed tasks", "Highlight the urgent ones", "Add a progress indicator"),
  ...on(
    "demo",
    "Write a status update for the client",
    "Now make it for the team",
    "Make the brief shorter",
    "What do I tell the client?",
    "Add to the brief: homepage preview on Friday",
    "Reset the brief",
  ),
  ...on("demo", "Show the team workload", "Who's overloaded?", "Balance the workload", "Assign Development to Sara", "Add Giulia and Paolo to the team", "Set Marta's capacity to 4 days a week"),
  ...on("demoNoTeam", "Add a sample team"),
  ...on("demo", "Add a moodboard for the project", "Add the colours #0C0C0C, off-white and terracotta", "Add a note: warm, tactile, editorial"),
  ...on("demoMood3", "Tidy up the moodboard", "Arrange the moodboard in a grid", "Arrange the moodboard as a collage"),
  ...on("demoMoodShown", "Hide the moodboard"),
  ...on("demoSelected", "Break this task into smaller steps", "Make this more prominent", "Mark it done", "Set the cost to €2,400"),
];

export const CORPUS: readonly CorpusCase[] = [
  ...PALETTE_CASES,

  // Create (v0 §9)
  ...on("empty", "Help me organise my website launch", "new project", "Make a board for the bakery launch", "Create a moodboard for my brand", "Build a kanban for the spring campaign"),
  ...on("demo", "Create a new project for the launch", "Create a timeline for my project"),
  ...on("empty", "Create a team view", "Add a task called Copywriting", "Show the team"),

  // Views
  ...on("demo", "Show this project as a timeline", "Show it as a kanban", "Show the schedule", "Switch to a kanban", "Show it as a grid", "Show the cards in one column"),
  ...on("demoTimeline", "Change back to the original project tracker", "Show it as a list"),
  ...on("demoAllViews", "Remove the board", "Hide the timeline", "Get rid of the brief", "Remove the team view"),
  ...on("demo", "Remove the board", "Remove the tracker"),
  ...on("demoFocus", "Show me everything again", "exit focus"),

  // Layout
  ...on(
    "demo",
    "Make the cards more compact and sort them by priority",
    "Make it bigger",
    "Sort by name",
    "Sort them by name",
    "Sort by duration",
    "Sort by progress",
    "Sort by status",
    "Sort them",
    "Back to workflow order",
    "Remove the highlight",
    "Hide the estimates",
    "Show priorities",
    "Show the metrics",
    "Hide the metrics",
    "Show the overall progress",
    "Hide the progress",
  ),
  ...on("demoHideDone", "Show completed tasks"),
  ...on("demoProgress", "Show the progress"),
  ...on("demoBrief", "Add a progress indicator"),

  // Task edits
  ...on("demo", "Mark UI Design in review", "Start Development", "Make Development urgent", "Delete UI Design", "Add a task called Copywriting", "Mark Research done", "Add a task called Status report"),
  ...on(
    "demoSelected",
    "Reopen it",
    "Set it to 40%",
    "halfway",
    "It takes 2 weeks",
    "Set the estimate to 5 days",
    "It takes 100 days",
    "Set priority to low",
    "Rename it to Discovery",
    "Call it Interface",
    "Make this less prominent",
    "Add a step called QA pass",
    "Mark it done at 40%",
    "Set the cost",
    "Make it fly",
    "Delete this task",
  ),
  ...on("demoSteps", "Mark QA pass done", "Delete the QA pass step", "Rename QA pass to Final QA", "Make QA pass urgent", "Break QA pass into smaller steps"),

  // Steps
  ...on("demo", "Break UI Design into smaller steps", "Break this task into smaller steps", "Split Research into steps"),
  ...on("demoUnestimated", "Break UI Design into smaller steps"),
  ...on("demoProposal", "Accept them", "Discard", "yes", "Keep them"),

  // Decide
  ...on("demo", "Help me prioritize", "Focus mode for UI Design", "What's next"),

  // Team
  ...on("demo", "Give UI Design to Sara", "Unassign Visual Direction", "Assign Development to Luca", "Assign it to Marta", "Who's doing what"),
  ...on("demoSelected", "Give it to Sara", "Give it to Luca"),
  ...on("demo", "Add Giulia and Paolo to the team as designers with 4 days", "Add Giulia to the team as a designer", "Add Marta to the team"),
  ...on("demo", "Set Marta's capacity to 10 days", "Sara has 3 days a week", "Remove Luca from the team", "Even out the workload"),
  ...on("demoPlan", "Accept the plan", "Never mind", "yes", "no"),
  ...on("demoNoTeam", "Show the team", "Balance the workload", "Who's overloaded?"),
  ...on("demoTeamView", "Show the team workload", "Break UI Design into smaller steps"),

  // Brief
  ...on("demo", "Add to the brief under risks: fonts still unlicensed", "Add to the team brief: standup moved to 10", "Add to the team brief under risks: copy is late", "Reset the team brief"),
  ...on("demoBrief", "Make the brief longer", "Make it shorter", "Now make it for the client", "Write a status update for the client", "Copy the brief", "Add to the next: launch party?"),
  ...on("demoBriefEdited", "Reset the brief"),

  // Moodboard
  ...on("demoMood3", "Clear the moodboard", "Rearrange the moodboard", "Show the moodboard"),
  ...on("demo", "Tidy up the moodboard", "Hide the moodboard", "Add a note", "Add colours to the moodboard", "Clear the moodboard"),
  ...on("demoMoodShown", "Add #E4572E and off-white to the moodboard", "Add some images to the moodboard", "Clear the moodboard"),

  // Control
  ...on("demo", "undo", "redo", "reset", "Reset the demo", "Start over"),

  // Unsupported and clarify (v0 wording)
  ...on("demo", "Compare the two options", "Show me the budget", "", "Fammi il brief per il cliente", "Make it purple"),
  ...on("empty", "Who's overloaded?"),

  // More edges: plural sentences, clamps, no-ops, steps and people that aren't there
  ...on("demoSelected", "Make it urgent", "Add a step", "Highlight this", "Unpin it", "Set it to 150%", "Remove it", "Make it high priority", "Hide the done ones"),
  ...on("demo", "Sort by importance", "Make Development high priority", "Give Research to Giulia", "Add Sara to the team", "Add terracotta and sage to the moodboard", "Make it shorter"),
  ...on("demo", "Start a new board for the summer campaign", "Show all tasks"),
  ...on("demoTimeline", "Create a new project"),
  ...on("demoSteps", "Focus on QA pass", "Assign QA pass to Sara", "Add a step called Handoff"),
  ...on("demoMood3", "Add a note saying call the printer"),
  ...on("demoBrief", "Make the brief shorter", "Now make it for the team", "Show the team workload"),

  // AUDIT §11 false positives, kept in /demo until Phase 5 (plan §8.4)
  ...on("demo", "Set the deadline to 30 November", "Level the schedule", "Zoom the timeline to weeks", "Add a board and then email the client", "Aggiungi una timeline"),
  ...on("demoSelected", "Budget is 12k", "Start QA on the 10th"),
];
