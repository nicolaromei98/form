// The reviewed differences between v0 and the v2 parser on the golden corpus (plan §10.4, §8.5
// ED-6). Each entry is one corpus command: the caption v0 showed and the one v2 composes, and the
// canonical state paths that differ (legacy → v2). parser.golden.test.ts fails on any difference
// not listed here and on any listed one that no longer happens.
//
// The document state is the same as v0's (lowered) everywhere but in three commands: "N weeks"
// (plan §1.3), the 250-day estimate limit, and a weekly capacity past 7 (plan §8.4). Everything
// else is wording: captions now come only from the ops that applied, the local intents, typed
// query notes and fixed notices (plan §1.3, §5.9), never from the parser, and they follow the
// caption policy (DECISIONS, "Wave 5 outcomes and the caption policy"): one short line of at most
// four parts, with no part a view says of itself when it only opens as a side effect.
import type { LegacyFixture } from "./parser-harness";

export interface ObservedDiff {
  caption?: { v0: string; v2: string };
  state?: readonly string[];
}

export interface ExpectedDiff extends ObservedDiff {
  fixture: LegacyFixture;
  say: string;
  why: string;
}

/** The reasons, each a decided source of change (plan §8.5) */
export const R = {
  // ED-6: honest no-ops (AUDIT #6). v0 claimed a change, added an Undo and a history entry for a
  // document deep-equal to the one before; v2's op is a no-op and says what is already true.
  honestNoop: "Honest no-op (AUDIT #6, ED-6): nothing changes, so the op's no-op caption says what is already true, with no Undo.",
  // Caption policy rule 5: the no-op speaks first, then what applied around it
  noopFirst:
    "Honest no-op first (AUDIT #6; caption policy rule 5): the board is already empty, and the moodboard the command brought on screen says it was added; v0 showed it without saying so.",
  // ED-3: the Phase 1 Team lane, weekly capacities 2/4/5 (plan §6.5, DECISIONS §13 item 18)
  weeklyLoad: "Weekly load (ED-3, plan §6.5): over and free are summed week by week against 2/4/5 days a week, so the figures and the roomiest person change.",
  // ED-6, Q3: capacity is days per week, null when a command names none
  capacity: "Capacity is days a week (Q3, ED-6): the wording says so, a command that names none leaves it unset, and a figure past 7 asks back (plan §8.4).",
  // Caption policy rules 1 and 2, with the capacity wording
  peopleAdded:
    "Capacity is days a week and a command that names none leaves it unset (Q3, ED-6). People added alike are said once, and their joining the project goes without saying (caption policy rules 1 and 2).",
  // Caption policy rule 3: the demo's sample-team expansion (plan §4.5) speaks as one
  sampleTeam:
    "The sample team speaks as one (caption policy rule 3, the review's wording): its people, then the team's status after the change on the weekly figures (ED-3), which says what the Team view it opens shows.",
  // The registry's own caption for the op (plan §4.4)
  opCaption: "The op's registry caption (plan §4.4) replaces v0's parser prose for the same change.",
  // removeTask bridges dependencies (plan §4.4 row 28)
  bridge: "removeTask bridges dependencies (plan §1.3, §4.4 row 28), and its caption names the new link.",
  // Status wins (plan §4.5, DECISIONS §13 item 13)
  statusWins: "One op per field, status last (plan §4.5): Done sets 100%, so the progress part is replaced by the status part (same caption key).",
  // "N weeks" = N × 5 working days (plan §1.3, Q17 decision, ED-6)
  weeks: "\"N weeks\" means N × 5 working days (plan §1.3, ED-6): 2 weeks are 10 days, not 14.",
  // v2 estimates go to 250 days (plan §3.4); v0 clamped at its 90-day schema limit
  estimateLimit: "Estimates go up to 250 days in v2 (plan §3.4, ESTIMATE_MAX_DAYS); v0 clamped them at 90.",
  // Honest breakdown (plan §8.4, Q20)
  breakdown: "Honest breakdown caption (plan §8.4, ED-6): without an estimate the steps carry none, and the caption says so instead of saying nothing.",
  // Steps are a level of their own (plan §3.4): no priority
  stepFields:
    "Steps have a title, done and an estimate only (plan §3.4, §4.5): v0 stored a priority on a step and nothing showed it; v2 has no field for it, so the command isn't understood.",
  // addBlock's caption for the moodboard (plan §4.4 row 51)
  moodboardCaption: "addBlock's moodboard caption (plan §4.4 row 51), as v0 said it when the board was asked for alone.",
  // The local show caption has no "everything back" (plan §4.4 local intents)
  showHome: "Showing the home view says its name (plan §4.4 local show); \"everything back\" was v0 parser prose.",
  // Op parts come before the local intents' parts (plan §5.9 item 1)
  partOrder: "Caption parts in plan §5.9 order: the ops' parts, then the local intents': the option first, then the view.",
  // Caption policy rule 4: a view that opens as a side effect adds no part
  sideEffectView:
    "A view that opens as a side effect says nothing of itself (caption policy rule 4): the tasks come back so the new indicator shows, and the indicator speaks.",
} as const;

export const EXPECTED_DIFFS: readonly ExpectedDiff[] = [
  /* ---------- Create ---------- */
  {
    fixture: "empty",
    say: "Create a moodboard for my brand",
    caption: { v0: "Tracker created · 4 tasks · moodboard below, drop images onto it", v2: "Tracker created · 4 tasks · Moodboard added · drop, paste or browse images" },
    why: R.moodboardCaption,
  },

  /* ---------- Views and layout ---------- */
  { fixture: "demo", say: "Show it as a grid", caption: { v0: "Grid", v2: "Already a grid" }, why: R.honestNoop },
  { fixture: "demo", say: "Show the cards in one column", caption: { v0: "Tracker · 1 column", v2: "1 column · Tracker" }, why: R.partOrder },
  { fixture: "demoFocus", say: "Show me everything again", caption: { v0: "Tracker · everything back", v2: "Tracker" }, why: R.showHome },
  { fixture: "demoFocus", say: "exit focus", caption: { v0: "Tracker · everything back", v2: "Tracker" }, why: R.showHome },
  { fixture: "demo", say: "Show all tasks", caption: { v0: "Tracker · everything back", v2: "Tracker" }, why: R.showHome },
  { fixture: "demo", say: "Make it bigger", caption: { v0: "Comfortable density", v2: "The cards are already comfortable" }, why: R.honestNoop },
  { fixture: "demo", say: "Back to workflow order", caption: { v0: "Workflow order", v2: "Already in workflow order" }, why: R.honestNoop },
  { fixture: "demo", say: "Remove the highlight", caption: { v0: "Highlight off", v2: "Nothing is highlighted" }, why: R.honestNoop },
  { fixture: "demo", say: "Show priorities", caption: { v0: "Priority visible", v2: "The view already looks like that" }, why: R.honestNoop },
  { fixture: "demo", say: "Show the metrics", caption: { v0: "Metrics added", v2: "The metrics are already shown" }, why: R.honestNoop },
  { fixture: "demoBrief", say: "Add a progress indicator", caption: { v0: "Project progress indicator added · Tracker", v2: "Project progress indicator added" }, why: R.sideEffectView },

  /* ---------- Task edits ---------- */
  { fixture: "demo", say: "Delete UI Design", caption: { v0: "UI Design removed", v2: "UI Design removed · Development now follows Visual Direction" }, why: R.bridge },
  { fixture: "demoSelected", say: "Delete this task", caption: { v0: "UI Design removed", v2: "UI Design removed · Development now follows Visual Direction" }, why: R.bridge },
  { fixture: "demo", say: "Mark Research done", caption: { v0: "Research → Done", v2: "Research is already done" }, why: R.honestNoop },
  { fixture: "demoSelected", say: "Start QA on the 10th", caption: { v0: "UI Design → In progress", v2: "UI Design is already in progress" }, why: R.honestNoop },
  { fixture: "demoSelected", say: "Make this less prominent", caption: { v0: "Emphasis removed", v2: "UI Design isn't emphasised" }, why: R.honestNoop },
  { fixture: "demoSelected", say: "Unpin it", caption: { v0: "Emphasis removed", v2: "UI Design isn't emphasised" }, why: R.honestNoop },
  { fixture: "demoSelected", say: "Make it urgent", caption: { v0: "Priority urgent", v2: "UI Design is already urgent priority" }, why: R.honestNoop },
  { fixture: "demoSelected", say: "Remove it", caption: { v0: "UI Design removed", v2: "UI Design removed · Development now follows Visual Direction" }, why: R.bridge },
  {
    fixture: "demoSelected",
    say: "Set it to 150%",
    caption: { v0: "Progress 100%", v2: "UI Design → Done" },
    why: `${R.opCaption} At 100% the status table makes the task Done (plan §5.5), and the caption says the status.`,
  },
  {
    fixture: "demoSelected",
    say: "It takes 2 weeks",
    caption: { v0: "Estimate 14d", v2: "Estimate 10d" },
    state: ["project.tasks[2].estimateDays: 14 → 10"],
    why: R.weeks,
  },
  {
    fixture: "demoSelected",
    say: "It takes 100 days",
    caption: { v0: "Estimate 90d", v2: "Estimate 100d" },
    state: ["project.tasks[2].estimateDays: 90 → 100"],
    why: R.estimateLimit,
  },
  { fixture: "demoSelected", say: "Mark it done at 40%", caption: { v0: "UI Design → Done · Progress 40%", v2: "UI Design → Done" }, why: R.statusWins },
  { fixture: "demoSteps", say: "Mark QA pass done", caption: { v0: "QA pass → Done", v2: "QA pass done" }, why: R.opCaption },
  { fixture: "demoSteps", say: "Rename QA pass to Final QA", caption: { v0: "Renamed to Final QA", v2: "Step renamed to Final QA" }, why: R.opCaption },
  {
    fixture: "demoSteps",
    say: "Make QA pass urgent",
    caption: { v0: "Priority urgent", v2: "Demo mode doesn't understand that yet. It handles views, layout, sorting, filtering and task edits." },
    why: R.stepFields,
  },

  /* ---------- Steps ---------- */
  {
    fixture: "demoUnestimated",
    say: "Break UI Design into smaller steps",
    caption: { v0: "4 steps proposed for UI Design. Review them on the task.", v2: "4 steps proposed for UI Design · no estimates. Review them on the task." },
    why: R.breakdown,
  },
  { fixture: "demoProposal", say: "Accept them", caption: { v0: "4 steps added", v2: "4 steps added to UI Design" }, why: R.opCaption },
  { fixture: "demoProposal", say: "yes", caption: { v0: "4 steps added", v2: "4 steps added to UI Design" }, why: R.opCaption },
  { fixture: "demoProposal", say: "Keep them", caption: { v0: "4 steps added", v2: "4 steps added to UI Design" }, why: R.opCaption },

  /* ---------- Team ---------- */
  {
    fixture: "demo",
    say: "Who's overloaded?",
    caption: { v0: "Marta is 3d over · most room: Sara (8d free) · Team view added", v2: "Marta is 4d over · most room: Luca (7d free) · Team view added" },
    why: R.weeklyLoad,
  },
  {
    fixture: "demo",
    say: "Balance the workload",
    caption: {
      v0: "Marta is 3d over · 1 handover proposed. Review it on the team. · Team view added",
      v2: "Marta is 4d over capacity · 1 handover proposed. Review it on the team. · Team view added",
    },
    why: R.weeklyLoad,
  },
  {
    fixture: "demo",
    say: "Even out the workload",
    caption: {
      v0: "Marta is 3d over · 1 handover proposed. Review it on the team. · Team view added",
      v2: "Marta is 4d over capacity · 1 handover proposed. Review it on the team. · Team view added",
    },
    why: R.weeklyLoad,
  },
  {
    fixture: "demo",
    say: "Assign Development to Sara",
    caption: { v0: "Development → Sara · Sara 8/8d · Team view added", v2: "Development → Sara · Sara is now 1d over · Team view added" },
    why: R.weeklyLoad,
  },
  {
    fixture: "demoSelected",
    say: "Give it to Luca",
    caption: { v0: "UI Design → Luca · Luca is now 4d over · Team view added", v2: "UI Design → Luca · Luca 14/20d · Team view added" },
    why: R.weeklyLoad,
  },
  {
    fixture: "demo",
    say: "Remove Luca from the team",
    caption: { v0: "Luca removed · 1 task now unassigned · Team view added", v2: "Luca removed · 1 task unassigned · Team view added" },
    why: `${R.opCaption} ED-6 lists "Luca removed · 1 task unassigned".`,
  },
  {
    fixture: "demo",
    say: "Set Marta's capacity to 4 days a week",
    caption: { v0: "Marta · 4d of capacity · Team view added", v2: "Marta · 4 days a week · Team view added" },
    why: R.capacity,
  },
  {
    fixture: "demo",
    say: "Sara has 3 days a week",
    caption: { v0: "Sara · 3d of capacity · Team view added", v2: "Sara · 3 days a week · Team view added" },
    why: R.capacity,
  },
  {
    fixture: "demo",
    say: "Set Marta's capacity to 10 days",
    caption: { v0: "Marta · 10d of capacity · Team view added", v2: "Capacity is days per week, up to 7." },
    state: ['local.view: "team" → "cards"', 'project.views: ["cards","team"] → ["cards"]'],
    why: `${R.capacity} The lowered v0 command opens the Team view and its capacity is refused; v2 asks back and changes nothing.`,
  },
  {
    fixture: "demo",
    say: "Add Giulia and Paolo to the team",
    caption: { v0: "Giulia and Paolo added to the team · 10d each by default · Team view added", v2: "Giulia and Paolo added to the team · capacity not set · Team view added" },
    why: R.peopleAdded,
  },
  {
    fixture: "demo",
    say: "Add Giulia and Paolo to the team as designers with 4 days",
    caption: { v0: "Giulia and Paolo added to the team · 4d each · Team view added", v2: "Giulia and Paolo added to the team · 4 days a week · Team view added" },
    why: R.peopleAdded,
  },
  {
    fixture: "demo",
    say: "Add Giulia to the team as a designer",
    caption: { v0: "Giulia added to the team · 10d by default · Team view added", v2: "Giulia added to the team · capacity not set · Team view added" },
    why: R.peopleAdded,
  },
  {
    fixture: "demoNoTeam",
    say: "Add a sample team",
    caption: { v0: "Sample team added · Marta, Sara and Luca · Team view added", v2: "Sample team added · Marta, Sara and Luca · Marta over capacity" },
    why: R.sampleTeam,
  },

  /* ---------- Moodboard ---------- */
  {
    fixture: "demo",
    say: "Clear the moodboard",
    caption: { v0: "The moodboard is already empty", v2: "The moodboard is already empty · Moodboard added · drop, paste or browse images" },
    why: R.noopFirst,
  },
];
