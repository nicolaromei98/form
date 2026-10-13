import { focusPick, reasonsFor } from "./focus";
import { addDays, dayDiff, metrics, parseISODate, schedule, topLevel } from "./selectors";
import { fmtLoad, loadsOf } from "./team";
import type { BriefSectionKey, Doc, Person, Task } from "./schema";

/**
 * Status brief — the project as a short written update, composed only from the
 * document. Nothing is invented: what FORM doesn't know (a sample start date,
 * missing durations, owners or costs) is listed as an open question instead.
 *
 * Every composed sentence has a stable id ("risks:t-ui", "next:end"), so the
 * user can rewrite, hide or add lines on top of it. An edit keeps the composed
 * wording it replaced (its basis): when the data moves on, the line is flagged
 * as stale instead of silently keeping an outdated claim.
 */

export type Audience = "client" | "team";
export type Run = string | { task: string } | { person: string };
export type Sentence = Run[];

export interface BriefLine {
  /** Composed sentence id ("risks:t-ui"), or the id of a line the user added */
  id: string;
  /** Where an edit to this line is stored: "<audience>:<id>" (composed) or the line id (custom) */
  key: string;
  kind: "composed" | "custom";
  /** The composed runs, with entity mentions (custom lines: their text) */
  runs: Sentence;
  /** The composed wording as plain text ("" for custom lines) */
  composed: string;
  /** The user's wording, when they rewrote a composed line */
  edited: string | null;
  /** FORM's composed wording changed since the user rewrote it */
  stale: boolean;
}

export interface BriefSection {
  key: BriefSectionKey;
  label: string;
  lines: BriefLine[];
}

export interface Brief {
  /** Eyebrow segments ("Status", date, audience, sample) — rendered so they can wrap between segments */
  eyebrow: string[];
  headline: BriefLine[];
  progress: number;
  sections: BriefSection[];
  /** Moodboard colours, shown as a palette strip at the foot */
  palette: string[];
  /** The user's changes for this audience: rewritten, hidden and added lines */
  changes: number;
  /** Composed lines the user hid in this audience */
  hidden: number;
}

export const SECTION_LABEL: Record<BriefSectionKey, string> = {
  note: "Note",
  done: "Done",
  moving: "In progress",
  next: "Next",
  risks: "Risks",
  questions: "Open questions",
};
const ORDER: BriefSectionKey[] = ["note", "done", "moving", "next", "risks", "questions"];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const date = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
const days = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} ${n === 1 ? "day" : "days"}`;
const mention = (t: Task): Run => ({ task: t.id });

/** "A", "A and B", "A, B and C" */
function list(tasks: Task[]): Run[] {
  return tasks.flatMap((t, i) => (i === 0 ? [mention(t)] : [i === tasks.length - 1 ? " and " : ", ", mention(t)]));
}
const verb = (tasks: Task[], one: string, many: string) => (tasks.length > 1 ? many : one);

type Draft = { id: string; runs: Sentence };

/** The brief as FORM composes it from the data, before the user's edits */
function draft(doc: Doc, audience: Audience, today: Date) {
  const tool = doc.tool!;
  const team = audience === "team";
  const all = topLevel(doc);
  const open = all.filter((t) => t.status !== "done");
  const m = metrics(doc);
  const sch = schedule(doc);
  const sample = tool.startDateIsSample;
  const pick = focusPick(doc, today);
  const people = new Map<string, Person>(doc.people.map((p) => [p.id, p]));
  const ownerOf = (t: Task) => (t.owner ? (people.get(t.owner) ?? null) : null);
  // The team version says who; the client version keeps names inside the studio
  const withOwner = (t: Task): Run[] => {
    const p = ownerOf(t);
    return team && p ? [", with ", { person: p.id }] : [];
  };

  const done = all.filter((t) => t.status === "done");
  const review = all.filter((t) => t.status === "review");
  const active = all.filter((t) => t.status === "active");
  const todo = all.filter((t) => t.status === "todo");

  /* Headline: where the whole project stands, then the one thing to look at.
     The wording follows the statuses; the number never claims 100% while work is open */
  const untouched = all.every((t) => t.status === "todo" && t.progress === 0);
  const pct = open.length ? Math.min(m.progress, 99) : 100;
  // When nothing left open has a duration, the weighted percentage can't see it: count tasks instead
  const unweighable = open.length > 0 && open.every((t) => t.estimate == null);
  const first: Sentence = !all.length
    ? [`${tool.title} has no tasks yet.`]
    : !open.length
      ? [`${tool.title} is complete.`]
      : untouched
        ? [`${tool.title} hasn't started yet.`]
        : unweighable
          ? [`${done.length} of ${all.length} tasks are done.`]
          : pct === 0
            ? [`${tool.title} is under way.`]
            : [`${tool.title} is ${pct}% done.`];
  const firstTodo = all.find((t) => t.status === "todo");
  const second: Sentence = !pick
    ? [all.length ? "Everything has been delivered." : "Add tasks to start the brief."]
    : reasonsFor(doc, pick.task, today).some((r) => r.risk)
      ? [mention(pick.task), " is the one to watch."]
      : pick.task.status === "active"
        ? [mention(pick.task), " is where the work is."]
        : pick.task.status === "review"
          ? [mention(pick.task), " is waiting on review."]
          : pick.task.id === firstTodo?.id
            ? [mention(pick.task), " is up next."]
            : [mention(pick.task), " is the priority."];

  const sections: Partial<Record<BriefSectionKey, Draft[]>> = {};

  sections.done = [done.length ? { id: "done:all", runs: [...list(done), verb(done, " is done.", " are done.")] } : { id: "done:none", runs: ["Nothing is finished yet."] }];

  const moving: Draft[] = [
    ...review.map((t): Draft => ({ id: `moving:${t.id}`, runs: [mention(t), " is in review", ...withOwner(t), "."] })),
    ...active.map((t): Draft => ({ id: `moving:${t.id}`, runs: [mention(t), t.progress > 0 ? ` is ${t.progress}% in` : " has started", ...withOwner(t), "."] })),
  ];
  sections.moving = moving.length ? moving : [{ id: "moving:none", runs: ["Nothing is in progress right now."] }];

  const next: Draft[] = [];
  if (todo.length) {
    const up = todo[0];
    const before = all
      .slice(0, all.indexOf(up))
      .reverse()
      .find((t) => t.status === "active" || t.status === "review");
    next.push({
      id: "next:up",
      runs: [
        mention(up),
        ...(before ? [" starts after ", mention(before)] : [" is next"]),
        ...(up.estimate != null ? [`, about ${days(up.estimate)} of work`] : []),
        ...withOwner(up),
        ".",
      ],
    });
    if (todo.length > 1) next.push({ id: "next:then", runs: ["Then ", ...list(todo.slice(1)), "."] });
  }
  if (pick?.next) next.push({ id: "next:step", runs: ["Next step on ", mention(pick.task), `: ${pick.next.title}.`] });
  const scheduledOpen = open.filter((t) => sch.slots[t.id]);
  if (sch.totalDays > 0 && scheduledOpen.length) {
    const end = addDays(parseISODate(tool.startDate), sch.totalDays - 1);
    const past = dayDiff(today, end) < 0;
    const where = sample ? "On the sample schedule, " : "";
    const what = scheduledOpen.length < open.length ? "scheduled work" : "the last task";
    const line = `${where}${what} ${past ? "was planned to end" : "ends"} ${date(end)}${scheduledOpen.length < open.length ? ", leaving out tasks with no duration" : ""}.`;
    next.push({ id: "next:end", runs: [line.charAt(0).toUpperCase() + line.slice(1)] });
  }
  if (next.length) sections.next = next;

  const risks: Draft[] = [];
  for (const t of open) {
    const phrases = reasonsFor(doc, t, today)
      .filter((r) => r.risk && r.phrase)
      .map((r) => r.phrase!)
      .slice(0, 2);
    if (phrases.length) risks.push({ id: `risks:${t.id}`, runs: [mention(t), ` is ${phrases.join(" and ")}.`] });
  }
  if (team) {
    for (const l of loadsOf(doc)) {
      if (l.person && l.over > 0) {
        risks.push({ id: `risks:load:${l.person.id}`, runs: [{ person: l.person.id }, ` is ${fmtLoad(l.over)} ${l.over === 1 ? "day" : "days"} over capacity.`] });
      }
    }
  }
  sections.risks = risks.length ? risks : [{ id: "risks:none", runs: ["No risks flagged."] }];

  // Gaps are stated, never filled in
  const questions: Draft[] = [];
  if (sample) {
    questions.push({
      id: "questions:start",
      runs: [team ? "The start date is still the sample date: confirm it to make the dates real." : "Dates are indicative until the start date is confirmed."],
    });
  }
  const unsized = open.filter((t) => t.estimate == null);
  if (unsized.length) {
    questions.push({
      id: "questions:unsized",
      runs: [...list(unsized), verb(unsized, " has no duration yet, so it isn't in the dates or the percentage.", " have no duration yet, so they aren't in the dates or the percentage.")],
    });
  }
  if (team) {
    const unowned = doc.people.length ? open.filter((t) => !ownerOf(t)) : [];
    if (unowned.length) questions.push({ id: "questions:owners", runs: [...list(unowned), verb(unowned, " has no owner.", " have no owner.")] });
    const costed = all.filter((t) => t.cost != null).length;
    if (all.length && costed < all.length) {
      questions.push({
        id: "questions:costs",
        runs: [costed ? `Costs are known for ${costed} of ${all.length} ${all.length === 1 ? "task" : "tasks"}.` : "No costs have been estimated yet."],
      });
    }
  }
  if (questions.length) sections.questions = questions;

  const bar = !all.length || untouched ? 0 : !open.length ? 100 : unweighable ? Math.round((done.length / all.length) * 100) : pct;
  return { headline: [{ id: "head:status", runs: first }, { id: "head:focus", runs: second }] as Draft[], sections, bar, sample };
}

export function composeBrief(doc: Doc, audience: Audience, short: boolean, today = new Date()): Brief | null {
  if (!doc.tool) return null;
  const d = draft(doc, audience, today);
  const edits = doc.brief.edits;
  let hidden = 0;

  // The composed sentence with the user's edit on top; null when they hid it
  const compose = (x: Draft): BriefLine | null => {
    const key = `${audience}:${x.id}`;
    const composed = plainText(x.runs, doc);
    const e = edits[key];
    if (e && !e.text) {
      hidden++;
      return null;
    }
    return { id: x.id, key, kind: "composed", runs: x.runs, composed, edited: e ? e.text : null, stale: !!e && e.basis !== composed };
  };

  const custom = doc.brief.lines.filter((l) => l.audience === audience);
  const sections: BriefSection[] = [];
  for (const key of ORDER) {
    // The short version keeps what's moving, what's next, what could go wrong and what isn't known —
    // never figures without the gaps behind them — plus everything the user wrote themselves
    if (short && key === "done") continue;
    const composedLines = (d.sections[key] ?? []).map(compose).filter((l): l is BriefLine => l !== null);
    const lines = [
      ...(short ? composedLines.slice(0, 2) : composedLines),
      ...custom
        .filter((l) => l.section === key)
        .map((l): BriefLine => ({ id: l.id, key: l.id, kind: "custom", runs: [l.text], composed: "", edited: null, stale: false })),
    ];
    if (lines.length || (key !== "note" && d.sections[key]?.length)) sections.push({ key, label: SECTION_LABEL[key], lines });
  }

  const headline = d.headline.map(compose).filter((l): l is BriefLine => l !== null);
  const team = audience === "team";
  const eyebrow = ["Status", date(today), team ? "For the team" : "For the client", ...(d.sample ? ["Sample schedule"] : [])];
  const palette = doc.mood.filter((i) => i.kind === "color" && i.hex).map((i) => i.hex!).slice(0, 8);
  const changes = Object.keys(edits).filter((k) => k.startsWith(`${audience}:`)).length + custom.length;

  return { eyebrow, headline, progress: d.bar, sections, palette, changes, hidden };
}

/** A sentence as plain text */
export function plainText(sentence: Sentence, doc: Doc): string {
  return sentence
    .map((r) => (typeof r === "string" ? r : "task" in r ? (doc.tasks[r.task]?.title ?? "") : (doc.people.find((p) => p.id === r.person)?.name ?? "")))
    .join("");
}

/** What a line says now: the user's wording, or FORM's */
export const lineText = (line: BriefLine, doc: Doc) => line.edited ?? (line.kind === "custom" ? String(line.runs[0] ?? "") : plainText(line.runs, doc));

/** Plain text for anywhere: labels as capitals, no markup to leak into Mail */
export function briefPlainText(brief: Brief, doc: Doc): string {
  const title = doc.tool?.title ?? "Project";
  const lines = [`${title} · ${brief.eyebrow.join(" · ")}`, "", brief.headline.map((l) => lineText(l, doc)).join(" ")];
  for (const s of brief.sections) if (s.lines.length) lines.push("", s.label.toUpperCase(), ...s.lines.map((l) => `– ${lineText(l, doc)}`));
  lines.push("", "Composed by FORM from the project data.");
  return lines.join("\n");
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Rich text for Mail, Gmail, Notion and Slack, which paste HTML as formatting */
export function briefHtml(brief: Brief, doc: Doc): string {
  const title = esc(doc.tool?.title ?? "Project");
  const parts = [`<p><strong>${title}</strong> · ${esc(brief.eyebrow.join(" · "))}</p>`, `<p><strong>${esc(brief.headline.map((l) => lineText(l, doc)).join(" "))}</strong></p>`];
  for (const s of brief.sections) {
    if (s.lines.length) parts.push(`<p><strong>${esc(s.label)}</strong></p><ul>${s.lines.map((l) => `<li>${esc(lineText(l, doc))}</li>`).join("")}</ul>`);
  }
  parts.push(`<p><em>Composed by FORM from the project data.</em></p>`);
  return parts.join("");
}
