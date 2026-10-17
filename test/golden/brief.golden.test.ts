// Golden brief (plan §10.4, §6.9): the v2 composer against the frozen v0 composer, sentence by
// sentence, on the demo (client, team, short) and on four more demo states. The two sides read the
// same project: the v0 fixture through test/legacy/v0, and its v2 twin (build.ts, capacities
// 2/4/5) through the planning engine, both on 14 Oct 2026.
//
// Ids differ between the two (t-ui → tsk_…, p-marta → per_demomarta), so every id, key and
// mention is mapped by title and name before comparing. Every other difference must be listed in
// BRIEF_DIFFS below with its reason (ED-5, plan §8.5), or the test fails; a listed difference that
// no longer happens fails too.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { composeBrief, type Brief, type Run } from "@/lib/compose/brief";
import { seededMinter } from "@/lib/domain/ids";
import type { Audience, BriefLine as V2CustomLine, ProjectDoc } from "@/lib/domain/schema";
import { laneLoads, planProject, weeklyLoad } from "@/lib/planning";
import { activeProject, demoState, FIXTURE_TODAY, type FixtureState } from "../fixtures/v2/build";
import { namedFixture } from "../fixtures/v2/named";
import { composeBrief as legacyComposeBrief, type Brief as LegacyBrief, type Run as LegacyRun } from "../legacy/v0/lib/brief";
import { DocSchema, type Doc } from "../legacy/v0/lib/schema";

/* ------------------------------------------------------------------
   The cases
   ------------------------------------------------------------------ */

/** 14 Oct 2026, the frozen clock of the e2e suite and the fixtures, for the v0 composer */
const LEGACY_TODAY = new Date(2026, 9, 14);

const fixtureDoc = (name: string): Doc =>
  DocSchema.parse(JSON.parse(readFileSync(new URL(`../fixtures/v0/${name}.json`, import.meta.url), "utf8")).state.doc);

/** Replaces the active project of a v2 state */
function editProject(state: FixtureState, edit: (p: ProjectDoc) => ProjectDoc): FixtureState {
  const project = activeProject(state);
  return { ...state, projects: { ...state.projects, [project.id]: edit(project) } };
}

/** The same edits on both sides: rewrites (current wording as basis), a hide, a stale rewrite, added lines */
const EDITS = [
  { key: "client:next:up", text: "Development follows once the screens are signed off.", basis: "current" },
  { key: "client:head:focus", text: "UI Design is where we are.", basis: "UI Design was where we were." },
  { key: "client:moving:{UI Design}", text: "", basis: "current" },
  { key: "team:moving:{UI Design}", text: "UI Design is 30% in: Marta is on the key screens.", basis: "current" },
  { key: "team:questions:costs", text: "", basis: "current" },
  // A hide whose basis no longer matches: the sentence shows again, unedited
  { key: "team:done:all", text: "", basis: "Nothing is finished yet." },
] as const;
const ADDED_LINES = [
  { audience: "client", section: "next", text: "Launch party on Friday." },
  { audience: "team", section: "risks", text: "Check the fonts licence." },
  { audience: "team", section: "note", text: "Marta is away on Monday." },
] as const;

interface Case {
  name: string;
  /** The v0 document */
  legacy: () => Doc;
  /** Its v2 twin */
  v2: () => FixtureState;
}

/** Fills the "{Title}" placeholders of an edit key with a side's ids */
const fill = (key: string, idOf: (title: string) => string) => key.replace(/\{([^}]+)\}/g, (_, title: string) => idOf(title));

function editedLegacy(): Doc {
  const doc = fixtureDoc("docDemo");
  const idOf = (title: string) => Object.values(doc.tasks).find((t) => t.title === title)!.id;
  const edits: Doc["brief"]["edits"] = {};
  for (const e of EDITS) {
    const key = fill(e.key, idOf);
    const [audience, ...rest] = key.split(":");
    const current = legacyComposeBrief(doc, audience as Audience, false, LEGACY_TODAY)!;
    const line = [...current.headline, ...current.sections.flatMap((s) => s.lines)].find((l) => l.id === rest.join(":"))!;
    edits[key] = { text: e.text, basis: e.basis === "current" ? line.composed : e.basis };
  }
  const lines = ADDED_LINES.map((l, i) => ({ id: `b-line${i}`, ...l }));
  return { ...doc, brief: { edits, lines } };
}

function editedV2(): FixtureState {
  const state = demoState();
  const mint = seededMinter(77);
  return editProject(state, (p) => {
    const idOf = (title: string) => Object.values(p.tasks).find((t) => t.title === title)!.id;
    const edits: ProjectDoc["brief"]["edits"] = {};
    for (const e of EDITS) {
      const key = fill(e.key, idOf);
      const [audience, ...rest] = key.split(":");
      const current = v2Brief({ ...state, projects: { [p.id]: p } }, audience as Audience, false);
      const line = [...current.headline, ...current.sections.flatMap((s) => s.lines)].find((l) => l.id === rest.join(":"))!;
      edits[key] = { text: e.text, basis: e.basis === "current" ? line.composed : e.basis };
    }
    const lines: V2CustomLine[] = ADDED_LINES.map((l) => ({ id: mint("briefLine"), ...l }));
    return { ...p, brief: { ...p.brief, edits, lines } };
  });
}

/** Every task Done at 100% */
function completeLegacy(): Doc {
  const doc = fixtureDoc("docDemo");
  return { ...doc, tasks: Object.fromEntries(Object.entries(doc.tasks).map(([id, t]) => [id, { ...t, status: "done" as const, progress: 100 }])) };
}
function completeV2(): FixtureState {
  return editProject(demoState(), (p) => ({
    ...p,
    tasks: Object.fromEntries(Object.entries(p.tasks).map(([id, t]) => [id, { ...t, status: "done" as const, progress: 100 }])) as ProjectDoc["tasks"],
  }));
}

/** No team: no people, and no owners */
function noTeamLegacy(): Doc {
  const doc = fixtureDoc("docDemo");
  return { ...doc, people: [], tasks: Object.fromEntries(Object.entries(doc.tasks).map(([id, t]) => [id, { ...t, owner: null }])) };
}

/** Visual Direction's estimate cleared (the e2e fixture) */
function clearedV2(): FixtureState {
  return editProject(demoState(), (p) => ({
    ...p,
    tasks: Object.fromEntries(Object.entries(p.tasks).map(([id, t]) => [id, t.title === "Visual Direction" ? { ...t, estimateDays: null } : t])) as ProjectDoc["tasks"],
  }));
}

const CASES: Case[] = [
  { name: "demo", legacy: () => fixtureDoc("docDemo"), v2: () => demoState() },
  { name: "edited", legacy: editedLegacy, v2: editedV2 },
  { name: "complete", legacy: completeLegacy, v2: completeV2 },
  { name: "noTeam", legacy: noTeamLegacy, v2: () => namedFixture("demoNoTeam") },
  { name: "clearedEstimate", legacy: () => fixtureDoc("clearedEstimate"), v2: clearedV2 },
];

type Variant = "client" | "team" | "client short" | "team short";
const VARIANTS: readonly Variant[] = ["client", "team", "client short", "team short"];
const ALL = VARIANTS;
const FULL: readonly Variant[] = ["client", "team"];

/* ------------------------------------------------------------------
   The listed differences (ED-5)
   ------------------------------------------------------------------ */

interface BriefDiff {
  cases: readonly string[];
  variants: readonly Variant[];
  /** The sentence id, with "{Title}" or "{Name}" for an entity */
  id: string;
  /** v0's wording; null when v0 doesn't show the sentence */
  legacy: string | null;
  /** v2's wording; null when v2 doesn't show it */
  v2: string | null;
  /** A sentence only v2 shows: the sentence it follows (default: the last composed line of its section) */
  after?: string;
  reason: string;
}

const WORKING_DAYS = "ED-5: the schedule runs on working days (Q5), so the demo ends 26 Oct, not 18 Oct.";
const NEVER_LATE = "ED-5: a sample (unconfirmed) schedule is never late (Q13, audit B.8): no 'overdue' or 'behind' phrases.";
const WEEKLY_LOAD = "ED-5: load is weekly against 2/4/5 days a week (Q17, ED-3): Marta's lane is 10/6d, 4 days over.";
const SHORT_MOVES_UP = "ED-5: with the lateness lines gone, the load line is among the first two risks the short version keeps.";
const UNKNOWN = "Q13: tasks waiting on a task without a duration have no dates, so no open work is dated and nothing is stated.";
const NEW_ID = "New id questions:unknown (plan §6.9): the waiting tasks are named, with the task they need a duration from.";

const DEMO_CASES = ["demo", "edited", "noTeam"];
const BRIEF_DIFFS: readonly BriefDiff[] = [
  // The demo and its variants (ED-5)
  {
    cases: DEMO_CASES,
    variants: ALL,
    id: "next:end",
    legacy: "On the sample schedule, the last task ends 18 Oct.",
    v2: "On the sample schedule, the last task ends 26 Oct.",
    reason: WORKING_DAYS,
  },
  {
    cases: DEMO_CASES,
    variants: ALL,
    id: "risks:{Visual Direction}",
    legacy: "Visual Direction is overdue on the sample schedule since 4 Oct.",
    v2: null,
    reason: NEVER_LATE,
  },
  {
    cases: DEMO_CASES,
    variants: ALL,
    id: "risks:{UI Design}",
    legacy: "UI Design is urgent and overdue on the sample schedule since 10 Oct.",
    v2: "UI Design is urgent.",
    reason: NEVER_LATE,
  },
  { cases: DEMO_CASES, variants: FULL, id: "risks:{Development}", legacy: "Development is 4 days behind the sample schedule.", v2: null, reason: NEVER_LATE },
  { cases: ["demo", "edited"], variants: ["team"], id: "risks:load:{Marta}", legacy: "Marta is 3 days over capacity.", v2: "Marta is 4 days over capacity.", reason: WEEKLY_LOAD },
  { cases: ["demo", "edited"], variants: ["team short"], id: "risks:load:{Marta}", legacy: null, v2: "Marta is 4 days over capacity.", reason: SHORT_MOVES_UP },

  // Visual Direction's estimate cleared
  {
    cases: ["clearedEstimate"],
    variants: ALL,
    id: "next:end",
    legacy: "On the sample schedule, scheduled work ends 14 Oct, leaving out tasks with no duration.",
    v2: null,
    reason: UNKNOWN,
  },
  {
    cases: ["clearedEstimate"],
    variants: ALL,
    id: "risks:{UI Design}",
    legacy: "UI Design is urgent and overdue on the sample schedule since 6 Oct.",
    v2: "UI Design is urgent.",
    reason: NEVER_LATE,
  },
  { cases: ["clearedEstimate"], variants: ALL, id: "risks:{Development}", legacy: "Development is 8 days behind the sample schedule.", v2: null, reason: NEVER_LATE },
  {
    cases: ["clearedEstimate"],
    variants: FULL,
    id: "questions:unknown",
    legacy: null,
    v2: "UI Design and Development have no dates until Visual Direction has a duration.",
    after: "questions:unsized",
    reason: NEW_ID,
  },
];

/* ------------------------------------------------------------------
   Normal form: ids mapped to v2, text resolved
   ------------------------------------------------------------------ */

interface Line {
  id: string;
  key: string;
  kind: "composed" | "custom";
  text: string;
  edited: string | null;
  stale: boolean;
  /** Mentions in order, as v2 ids */
  mentions: unknown;
}
interface Normal {
  eyebrow: string[];
  progress: number;
  changes: number;
  hidden: string[];
  palette: string[];
  headline: Line[];
  sections: { key: string; label: string; lines: Line[] }[];
}

/** v0 id → v2 id, for tasks (by title), people (by name) and added lines (by text) */
type IdMap = ReadonlyMap<string, string>;

function idMapOf(doc: Doc, state: FixtureState): IdMap {
  const project = activeProject(state);
  const map = new Map<string, string>();
  for (const t of Object.values(doc.tasks)) {
    const twin = Object.values(project.tasks).find((x) => x.title === t.title);
    if (!twin) throw new Error(`No v2 task "${t.title}"`);
    map.set(t.id, twin.id);
  }
  for (const p of doc.people) {
    const twin = Object.values(state.workspace.people).find((x) => x.name === p.name);
    if (twin) map.set(p.id, twin.id);
  }
  for (const l of doc.brief.lines) {
    const twin = project.brief.lines.find((x) => x.text === l.text && x.audience === l.audience);
    if (!twin) throw new Error(`No v2 line "${l.text}"`);
    map.set(l.id, twin.id);
  }
  return map;
}

/** "client:risks:t-ui" → "client:risks:tsk_…" */
const mapKey = (key: string, ids: IdMap) =>
  key
    .split(":")
    .map((part) => ids.get(part) ?? part)
    .join(":");

const mentionsOf = (runs: readonly (Run | LegacyRun)[], ids: IdMap) =>
  runs.filter((r) => typeof r !== "string").map((r) => ("task" in r ? { task: ids.get(r.task) ?? r.task } : { person: ids.get(r.person) ?? r.person }));

function normal(brief: Brief | LegacyBrief, ids: IdMap): Normal {
  const line = (l: Brief["headline"][number] | LegacyBrief["headline"][number]): Line => ({
    id: mapKey(l.id, ids),
    key: mapKey(l.key, ids),
    kind: l.kind,
    text: l.kind === "custom" ? String(l.runs[0]) : l.composed,
    edited: l.edited,
    stale: l.stale,
    mentions: mentionsOf(l.runs, ids),
  });
  return {
    eyebrow: brief.eyebrow,
    progress: brief.progress,
    changes: brief.changes,
    hidden: brief.hidden.map((k) => mapKey(k, ids)),
    palette: brief.palette,
    headline: brief.headline.map(line),
    sections: brief.sections.map((s) => ({ key: s.key, label: s.label, lines: s.lines.map(line) })),
  };
}

/* ------------------------------------------------------------------
   Expected v2 = v0 with the listed differences
   ------------------------------------------------------------------ */

interface Applied {
  expected: Normal;
  /** Diffs that matched nothing in v0 or v2: stale entries */
  unused: BriefDiff[];
}

function applyDiffs(legacy: Normal, diffs: readonly BriefDiff[], audience: Audience, v2IdOf: (title: string) => string): Applied {
  const byId = new Map(diffs.map((d) => [fill(d.id, v2IdOf), d]));
  const used = new Set<BriefDiff>();
  const replace = (l: Line): Line | null => {
    const diff = byId.get(l.id);
    if (diff === undefined || l.kind !== "composed") return l;
    used.add(diff);
    expect(l.text, `v0 wording of ${diff.id}`).toBe(diff.legacy);
    if (diff.v2 === null) return null;
    return { ...l, text: diff.v2, mentions: expect.anything() };
  };
  const sections = legacy.sections.map((s) => {
    const lines = s.lines.map(replace).filter((l): l is Line => l !== null);
    // A sentence v0 doesn't show goes after the one it names, else after the composed lines of its section
    for (const [id, d] of byId) {
      if (d.legacy !== null || id.split(":")[0] !== s.key) continue;
      used.add(d);
      const firstCustom = lines.findIndex((l) => l.kind === "custom");
      const after = d.after === undefined ? -1 : lines.findIndex((l) => l.id === d.after);
      const at = after >= 0 ? after + 1 : firstCustom < 0 ? lines.length : firstCustom;
      lines.splice(at, 0, { id, key: `${audience}:${id}`, kind: "composed", text: d.v2!, edited: null, stale: false, mentions: expect.anything() });
    }
    return { ...s, lines };
  });
  return {
    expected: { ...legacy, headline: legacy.headline.map(replace).filter((l): l is Line => l !== null), sections },
    unused: diffs.filter((d) => !used.has(d)),
  };
}

/* ------------------------------------------------------------------
   Running both composers
   ------------------------------------------------------------------ */

function v2Brief(state: FixtureState, audience: Audience, short: boolean): Brief {
  const plans = Object.values(state.projects).map((p) => planProject(p, state.workspace, FIXTURE_TODAY));
  const plan = plans.find((p) => p.project.id === state.projectId)!;
  const lanes = laneLoads(plan, weeklyLoad(state.workspace, plans), state.workspace);
  const brief = composeBrief({ plan, ws: state.workspace, audience, short, today: FIXTURE_TODAY, lanes });
  if (brief === null) throw new Error("No brief");
  return brief;
}

function compare(c: Case, variant: Variant) {
  const [audience, length] = variant.split(" ") as [Audience, string | undefined];
  const short = length === "short";
  const doc = c.legacy();
  const state = c.v2();
  const ids = idMapOf(doc, state);
  const project = activeProject(state);
  const v2IdOf = (name: string) =>
    Object.values(project.tasks).find((t) => t.title === name)?.id ?? Object.values(state.workspace.people).find((p) => p.name === name)!.id;

  const legacy = normal(legacyComposeBrief(doc, audience, short, LEGACY_TODAY)!, ids);
  const actual = normal(v2Brief(state, audience, short), ids);
  const diffs = BRIEF_DIFFS.filter((d) => d.cases.includes(c.name) && d.variants.includes(variant));
  return { legacy, actual, ...applyDiffs(legacy, diffs, audience, v2IdOf) };
}

describe("the brief against the frozen v0 composer", () => {
  describe.each(CASES)("$name", (c) => {
    it.each(VARIANTS)("%s: every sentence equals v0's apart from the listed differences", (variant) => {
      const { actual, expected, unused } = compare(c, variant);
      expect(actual).toEqual(expected);
      expect(unused.map((d) => d.id)).toEqual([]);
    });
  });

  it("lists a reason for every difference", () => {
    for (const d of BRIEF_DIFFS) {
      expect(d.reason.length).toBeGreaterThan(20);
      expect(d.legacy !== null || d.v2 !== null).toBe(true);
      expect(d.legacy).not.toBe(d.v2);
    }
  });

  it("gives the demo exactly the ED-5 wording (plan §8.5)", () => {
    const state = demoState();
    const text = (audience: Audience, short: boolean) =>
      v2Brief(state, audience, short)
        .sections.flatMap((s) => s.lines)
        .map((l) => l.composed);
    expect(text("client", false)).toContain("On the sample schedule, the last task ends 26 Oct.");
    expect(text("client", false)).toContain("UI Design is urgent.");
    expect(text("team", false)).toContain("Marta is 4 days over capacity.");
  });

  it("keeps v0's sentence ids on the demo: only the lateness lines go, and the short team version shows the load line", () => {
    const marta = Object.values(demoState().workspace.people).find((p) => p.name === "Marta")!.id;
    for (const variant of VARIANTS) {
      const { legacy, actual } = compare(CASES[0], variant);
      const legacyIds = [...legacy.headline, ...legacy.sections.flatMap((s) => s.lines)].map((l) => l.id);
      const v2Ids = [...actual.headline, ...actual.sections.flatMap((s) => s.lines)].map((l) => l.id);
      const extra = v2Ids.filter((id) => !legacyIds.includes(id));
      const missing = legacyIds.filter((id) => !v2Ids.includes(id));
      expect(extra, variant).toEqual(variant === "team short" ? [`risks:load:${marta}`] : []);
      // Visual Direction's and Development's lateness lines (the short versions had already cut Development's)
      expect(missing.length, variant).toBe(variant.endsWith("short") ? 1 : 2);
      expect(missing.every((id) => id.startsWith("risks:tsk_")), variant).toBe(true);
    }
  });
});
