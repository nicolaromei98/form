// The reviewed differences between v0 and the v2 parser on the golden corpus (plan §10.4, §8.5
// ED-6). Each entry is one corpus command: the caption v0 showed and the one v2 composes, and the
// canonical state paths that differ (legacy → v2). parser.golden.test.ts fails on any difference
// not listed here and on any listed one that no longer happens.
//
// The document state is the same as v0's (lowered) everywhere but in three commands: "N weeks"
// (plan §1.3), the 250-day estimate limit, and a weekly capacity past 7 (plan §8.4). Everything
// else is wording: captions now come only from the ops that applied, the local intents, typed
// query notes and fixed notices (plan §1.3, §5.9), never from the parser.
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
  // A no-op's caption shows only when nothing applied (plan §5.9 item 4); the view the command adds applies
  noopBehindView:
    "Honest no-op behind an added view (plan §5.9 item 4): the op changes nothing, and the view the command adds is what applied, so its caption speaks instead of the no-op's.",
  // The local show of the view the command opens composes its own part (plan §4.4 local intents)
  viewSpeaks:
    "The view the command opens says its own caption (plan §4.4, local show): after the change, from the after-state, as every show does in v2.",
  // ED-3: the Phase 1 Team lane, weekly capacities 2/4/5 (plan §6.5, DECISIONS §13 item 18)
  weeklyLoad: "Weekly load (ED-3, plan §6.5): over and free are summed week by week against 2/4/5 days a week, so the figures and the roomiest person change.",
  // ED-6, Q3: capacity is days per week, null when a command names none
  capacity: "Capacity is days a week (Q3, ED-6): the wording says so, a command that names none leaves it unset, and a figure past 7 asks back (plan §8.4).",
  // People are workspace records; the project's members are its Team rows (plan §6.5)
  peopleJoin:
    "People join the workspace and the project (plan §6.5: Team rows are members): addPerson and addMember each say their part. ED-6 capacity wording applies.",
  // The demo's sample-team expansion (plan §4.5) is ops, each with its caption
  sampleTeam:
    "The sample team is the demo expansion (plan §4.5): addMember for each sample person, then their template tasks; every op says its part, with the weekly figures (ED-3).",
  // The registry's own caption for the op (plan §4.4)
  opCaption: "The op's registry caption (plan §4.4) replaces v0's parser prose for the same change.",
  // removeTask bridges dependencies and says so (plan §4.4 row 28)
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
  // createProject's caption, and no show for a new project (seed.ts createDemoProject)
  createCaption:
    "createProject's caption (plan §4.4 row 16). The new project opens on the view it was born as without a show (the runner opens a spawned project at home, plan §5.7); the Timeline footer labels the sample schedule (ED-2).",
  // addBlock's caption for the moodboard (plan §4.4 row 51)
  moodboardCaption: "addBlock's moodboard caption (plan §4.4 row 51), as v0 said it when the board was asked for alone.",
  // The local show caption has no "everything back" (plan §4.4 local intents)
  showHome: "Showing the home view says its name (plan §4.4 local show); \"everything back\" was v0 parser prose.",
  // Op parts come before the local intents' parts (plan §5.9 item 1)
  partOrder: "Caption parts in plan §5.9 order: the ops' parts, then the local intents': the option first, then the view.",
} as const;

export const EXPECTED_DIFFS: readonly ExpectedDiff[] = [
  /* ---------- Create ---------- */
  {
    fixture: "empty",
    say: "Create a timeline for my project",
    caption: {
      v0: "Timeline created · 4 tasks · sample dates, sequenced from estimates · Demo mode ships one template (website) — rename anything",
      v2: "Timeline created · 4 tasks · Demo mode ships one template (website) — rename anything",
    },
    why: R.createCaption,
  },
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
  { fixture: "demo", say: "Make it bigger", caption: { v0: "Comfortable density", v2: "The cards are already comfortable" }, why: R.honestNoop },
  { fixture: "demo", say: "Back to workflow order", caption: { v0: "Workflow order", v2: "Already in workflow order" }, why: R.honestNoop },
  { fixture: "demo", say: "Remove the highlight", caption: { v0: "Highlight off", v2: "Nothing is highlighted" }, why: R.honestNoop },
  { fixture: "demo", say: "Show priorities", caption: { v0: "Priority visible", v2: "The view already looks like that" }, why: R.honestNoop },
  { fixture: "demo", say: "Show the metrics", caption: { v0: "Metrics added", v2: "The metrics are already shown" }, why: R.honestNoop },

  /* ---------- Task edits ---------- */
  { fixture: "demo", say: "Delete UI Design", caption: { v0: "UI Design removed", v2: "UI Design removed · Development now follows Visual Direction" }, why: R.bridge },
  { fixture: "demoSelected", say: "Delete this task", caption: { v0: "UI Design removed", v2: "UI Design removed · Development now follows Visual Direction" }, why: R.bridge },
  { fixture: "demo", say: "Mark Research done", caption: { v0: "Research → Done", v2: "Research is already done" }, why: R.honestNoop },
  { fixture: "demoSelected", say: "Start QA on the 10th", caption: { v0: "UI Design → In progress", v2: "UI Design is already in progress" }, why: R.honestNoop },
  { fixture: "demoSelected", say: "Make this less prominent", caption: { v0: "Emphasis removed", v2: "UI Design isn't emphasised" }, why: R.honestNoop },
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
  {
    fixture: "demoTeamView",
    say: "Break UI Design into smaller steps",
    caption: {
      v0: "4 steps proposed for UI Design · fits its 6d estimate. Review them on the task.",
      v2: "4 steps proposed for UI Design · fits its 6d estimate. Review them on the task. · Tracker",
    },
    why: R.viewSpeaks,
  },
  { fixture: "demoProposal", say: "Accept them", caption: { v0: "4 steps added", v2: "4 steps added to UI Design" }, why: R.opCaption },
  { fixture: "demoProposal", say: "yes", caption: { v0: "4 steps added", v2: "4 steps added to UI Design" }, why: R.opCaption },
  { fixture: "demoProposal", say: "Keep them", caption: { v0: "4 steps added", v2: "4 steps added to UI Design" }, why: R.opCaption },

  /* ---------- Team ---------- */
  {
    fixture: "demo",
    say: "Who's overloaded?",
    caption: { v0: "Marta is 3d over · most room: Sara (8d free) · Team view added", v2: "Team view added · Marta over capacity · Marta is 4d over · most room: Luca (7d free)" },
    why: R.weeklyLoad,
  },
  {
    fixture: "demo",
    say: "Balance the workload",
    caption: {
      v0: "Marta is 3d over · 1 handover proposed. Review it on the team. · Team view added",
      v2: "Marta is 4d over capacity · 1 handover proposed. Review it on the team. · Team view added · Marta over capacity",
    },
    why: R.weeklyLoad,
  },
  {
    fixture: "demo",
    say: "Even out the workload",
    caption: {
      v0: "Marta is 3d over · 1 handover proposed. Review it on the team. · Team view added",
      v2: "Marta is 4d over capacity · 1 handover proposed. Review it on the team. · Team view added · Marta over capacity",
    },
    why: R.weeklyLoad,
  },
  {
    fixture: "demo",
    say: "Assign Development to Sara",
    caption: { v0: "Development → Sara · Sara 8/8d · Team view added", v2: "Development → Sara · Sara is now 1d over · Team view added · Marta and Sara over capacity" },
    why: R.weeklyLoad,
  },
  {
    fixture: "demoSelected",
    say: "Give it to Luca",
    caption: { v0: "UI Design → Luca · Luca is now 4d over · Team view added", v2: "UI Design → Luca · Luca 14/20d · Team view added · everyone within capacity" },
    why: R.weeklyLoad,
  },
  {
    fixture: "demo",
    say: "Give UI Design to Sara",
    caption: { v0: "UI Design → Sara · Sara 6/8d · Team view added", v2: "UI Design → Sara · Sara 6/8d · Team view added · everyone within capacity" },
    why: R.viewSpeaks,
  },
  {
    fixture: "demoSelected",
    say: "Give it to Sara",
    caption: { v0: "UI Design → Sara · Sara 6/8d · Team view added", v2: "UI Design → Sara · Sara 6/8d · Team view added · everyone within capacity" },
    why: R.viewSpeaks,
  },
  {
    fixture: "demo",
    say: "Unassign Visual Direction",
    caption: { v0: "Visual Direction unassigned · Team view added", v2: "Visual Direction unassigned · Team view added · Marta over capacity" },
    why: R.viewSpeaks,
  },
  {
    fixture: "demo",
    say: "Assign Development to Luca",
    caption: { v0: "Development is already with Luca · Team view added", v2: "Team view added · Marta over capacity" },
    why: R.noopBehindView,
  },
  {
    fixture: "demo",
    say: "Remove Luca from the team",
    caption: { v0: "Luca removed · 1 task now unassigned · Team view added", v2: "Luca removed · 1 task unassigned · Team view added · Marta over capacity" },
    why: `${R.opCaption} ED-6 lists "Luca removed · 1 task unassigned". ${R.viewSpeaks}`,
  },
  {
    fixture: "demo",
    say: "Set Marta's capacity to 4 days a week",
    caption: { v0: "Marta · 4d of capacity · Team view added", v2: "Marta · 4 days a week · Team view added · Marta over capacity" },
    why: R.capacity,
  },
  {
    fixture: "demo",
    say: "Sara has 3 days a week",
    caption: { v0: "Sara · 3d of capacity · Team view added", v2: "Sara · 3 days a week · Team view added · Marta over capacity" },
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
    caption: {
      v0: "Giulia and Paolo added to the team · 10d each by default · Team view added",
      v2: "Giulia added to the team · capacity not set · Paolo added to the team · capacity not set · Giulia joins the project · Paolo joins the project · Team view added · Marta over capacity",
    },
    why: R.peopleJoin,
  },
  {
    fixture: "demo",
    say: "Add Giulia and Paolo to the team as designers with 4 days",
    caption: {
      v0: "Giulia and Paolo added to the team · 4d each · Team view added",
      v2: "Giulia added to the team · 4 days a week · Paolo added to the team · 4 days a week · Giulia joins the project · Paolo joins the project · Team view added · Marta over capacity",
    },
    why: R.peopleJoin,
  },
  {
    fixture: "demo",
    say: "Add Giulia to the team as a designer",
    caption: { v0: "Giulia added to the team · 10d by default · Team view added", v2: "Giulia added to the team · capacity not set · Giulia joins the project · Team view added · Marta over capacity" },
    why: R.peopleJoin,
  },
  {
    fixture: "demoNoTeam",
    say: "Add a sample team",
    caption: {
      v0: "Sample team added · Marta, Sara and Luca · Team view added",
      v2: "Marta joins the project · Sara joins the project · Luca joins the project · Research → Sara · Sara 0/4d · Visual Direction → Marta · Marta is now 4d over · UI Design → Marta · Marta is now 4d over · Development → Luca · Luca 8/15d · Team view added · Marta over capacity",
    },
    why: R.sampleTeam,
  },

  /* ---------- Brief ---------- */
  {
    fixture: "demo",
    say: "Add to the brief: homepage preview on Friday",
    caption: { v0: "Added to the client brief · Note · Brief view added", v2: "Added to the client brief · Note · Brief view added · for the client · composed from the project, nothing invented" },
    why: R.viewSpeaks,
  },
  {
    fixture: "demo",
    say: "Add to the brief under risks: fonts still unlicensed",
    caption: { v0: "Added to the client brief · Risks · Brief view added", v2: "Added to the client brief · Risks · Brief view added · for the client · composed from the project, nothing invented" },
    why: R.viewSpeaks,
  },
  {
    fixture: "demo",
    say: "Add to the team brief: standup moved to 10",
    caption: { v0: "Added to the team brief · Note · Brief view added", v2: "Added to the team brief · Note · Brief view added · for the team · composed from the project, nothing invented" },
    why: R.viewSpeaks,
  },
  {
    fixture: "demo",
    say: "Add to the team brief under risks: copy is late",
    caption: { v0: "Added to the team brief · Risks · Brief view added", v2: "Added to the team brief · Risks · Brief view added · for the team · composed from the project, nothing invented" },
    why: R.viewSpeaks,
  },
  {
    fixture: "demo",
    say: "Reset the brief",
    caption: { v0: "The client brief is already FORM's version · Brief view added", v2: "Brief view added · for the client · composed from the project, nothing invented" },
    why: R.noopBehindView,
  },
  {
    fixture: "demo",
    say: "Reset the team brief",
    caption: { v0: "The team brief is already FORM's version · Brief view added", v2: "Brief view added · for the team · composed from the project, nothing invented" },
    why: R.noopBehindView,
  },

  /* ---------- Moodboard ---------- */
  { fixture: "demo", say: "Clear the moodboard", caption: { v0: "The moodboard is already empty", v2: "Moodboard added · drop, paste or browse images" }, why: R.noopBehindView },
];
