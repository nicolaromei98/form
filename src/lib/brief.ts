import { focusPick, reasonsFor } from "./focus";
import { addDays, dayDiff, metrics, parseISODate, schedule, topLevel } from "./selectors";
import { fmtLoad, loadsOf } from "./team";
import type { Doc, Person, Task } from "./schema";

/**
 * Status brief — the project as a short written update, composed only from the
 * document. Nothing is invented: what FORM doesn't know (a sample start date,
 * missing durations, owners or costs) is listed as an open question instead.
 * Sentences are runs of text and entity mentions, so the view can make task
 * names selectable (Point & Ask) and the export can print them as plain text.
 */

export type Audience = "client" | "team";
export type Run = string | { task: string } | { person: string };
export type Sentence = Run[];

export interface BriefSection {
  key: "done" | "moving" | "next" | "risks" | "questions";
  label: string;
  sentences: Sentence[];
}

export interface Brief {
  /** Eyebrow segments ("Status", date, audience, sample) — rendered so they can wrap between segments */
  eyebrow: string[];
  headline: [Sentence, Sentence];
  progress: number;
  sections: BriefSection[];
  /** Moodboard colours, shown as a palette strip at the foot */
  palette: string[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const date = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
const days = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} ${n === 1 ? "day" : "days"}`;
const mention = (t: Task): Run => ({ task: t.id });

/** "A", "A and B", "A, B and C" */
function list(tasks: Task[]): Run[] {
  return tasks.flatMap((t, i) => (i === 0 ? [mention(t)] : [i === tasks.length - 1 ? " and " : ", ", mention(t)]));
}
const verb = (tasks: Task[], one: string, many: string) => (tasks.length > 1 ? many : one);

export function composeBrief(doc: Doc, audience: Audience, short: boolean, today = new Date()): Brief | null {
  const tool = doc.tool;
  if (!tool) return null;
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

  const sections: BriefSection[] = [];

  sections.push({
    key: "done",
    label: "Done",
    sentences: done.length ? [[...list(done), verb(done, " is done.", " are done.")]] : [["Nothing is finished yet."]],
  });

  const moving: Sentence[] = [
    ...review.map((t): Sentence => [mention(t), " is in review", ...withOwner(t), "."]),
    ...active.map((t): Sentence => [mention(t), t.progress > 0 ? ` is ${t.progress}% in` : " has started", ...withOwner(t), "."]),
  ];
  sections.push({ key: "moving", label: "In progress", sentences: moving.length ? moving : [["Nothing is in progress right now."]] });

  const next: Sentence[] = [];
  if (todo.length) {
    const up = todo[0];
    const before = all
      .slice(0, all.indexOf(up))
      .reverse()
      .find((t) => t.status === "active" || t.status === "review");
    next.push([
      mention(up),
      ...(before ? [" starts after ", mention(before)] : [" is next"]),
      ...(up.estimate != null ? [`, about ${days(up.estimate)} of work`] : []),
      ...withOwner(up),
      ".",
    ]);
    if (todo.length > 1) next.push(["Then ", ...list(todo.slice(1)), "."]);
  }
  if (pick?.next) next.push(["Next step on ", mention(pick.task), `: ${pick.next.title}.`]);
  const scheduledOpen = open.filter((t) => sch.slots[t.id]);
  if (sch.totalDays > 0 && scheduledOpen.length) {
    const end = addDays(parseISODate(tool.startDate), sch.totalDays - 1);
    const past = dayDiff(today, end) < 0;
    const where = sample ? "On the sample schedule, " : "";
    const what = scheduledOpen.length < open.length ? "scheduled work" : "the last task";
    const line = `${where}${what} ${past ? "was planned to end" : "ends"} ${date(end)}${scheduledOpen.length < open.length ? ", leaving out tasks with no duration" : ""}.`;
    next.push([line.charAt(0).toUpperCase() + line.slice(1)]);
  }
  if (next.length) sections.push({ key: "next", label: "Next", sentences: next });

  const risks: Sentence[] = [];
  for (const t of open) {
    const phrases = reasonsFor(doc, t, today)
      .filter((r) => r.risk && r.phrase)
      .map((r) => r.phrase!)
      .slice(0, 2);
    if (phrases.length) risks.push([mention(t), ` is ${phrases.join(" and ")}.`]);
  }
  if (team) {
    for (const l of loadsOf(doc)) {
      if (l.person && l.over > 0) risks.push([{ person: l.person.id }, ` is ${fmtLoad(l.over)} ${l.over === 1 ? "day" : "days"} over capacity.`]);
    }
  }
  sections.push({ key: "risks", label: "Risks", sentences: risks.length ? risks : [["No risks flagged."]] });

  // Gaps are stated, never filled in
  const questions: Sentence[] = [];
  if (sample) {
    questions.push([team ? "The start date is still the sample date: confirm it to make the dates real." : "Dates are indicative until the start date is confirmed."]);
  }
  const unsized = open.filter((t) => t.estimate == null);
  if (unsized.length) {
    questions.push([...list(unsized), verb(unsized, " has no duration yet, so it isn't in the dates or the percentage.", " have no duration yet, so they aren't in the dates or the percentage.")]);
  }
  if (team) {
    const unowned = doc.people.length ? open.filter((t) => !ownerOf(t)) : [];
    if (unowned.length) questions.push([...list(unowned), verb(unowned, " has no owner.", " have no owner.")]);
    const costed = all.filter((t) => t.cost != null).length;
    if (all.length && costed < all.length) {
      questions.push([costed ? `Costs are known for ${costed} of ${all.length} ${all.length === 1 ? "task" : "tasks"}.` : "No costs have been estimated yet."]);
    }
  }
  if (questions.length) sections.push({ key: "questions", label: "Open questions", sentences: questions });

  // The short version keeps what's moving, what's next, what could go wrong — and what isn't known,
  // so a shorter brief never states figures without the gaps behind them
  const kept = short ? sections.filter((s) => s.key !== "done").map((s) => ({ ...s, sentences: s.sentences.slice(0, 2) })) : sections;

  const eyebrow = ["Status", date(today), team ? "For the team" : "For the client", ...(sample ? ["Sample schedule"] : [])];
  const palette = doc.mood.filter((i) => i.kind === "color" && i.hex).map((i) => i.hex!).slice(0, 8);

  const bar = !all.length || untouched ? 0 : !open.length ? 100 : unweighable ? Math.round((done.length / all.length) * 100) : pct;
  return { eyebrow, headline: [first, second], progress: bar, sections: kept, palette };
}

/** A sentence as plain text — the key for in-place rewrites, and the copied version */
export function plainText(sentence: Sentence, doc: Doc): string {
  return sentence
    .map((r) => (typeof r === "string" ? r : "task" in r ? (doc.tasks[r.task]?.title ?? "") : (doc.people.find((p) => p.id === r.person)?.name ?? "")))
    .join("");
}

/** Plain text for anywhere: labels as capitals, no markup to leak into Mail */
export function briefPlainText(brief: Brief, doc: Doc): string {
  const title = doc.tool?.title ?? "Project";
  const lines = [`${title} · ${brief.eyebrow.join(" · ")}`, "", `${plainText(brief.headline[0], doc)} ${plainText(brief.headline[1], doc)}`];
  for (const s of brief.sections) lines.push("", s.label.toUpperCase(), ...s.sentences.map((x) => `– ${plainText(x, doc)}`));
  lines.push("", "Composed by FORM from the project data.");
  return lines.join("\n");
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Rich text for Mail, Gmail, Notion and Slack, which paste HTML as formatting */
export function briefHtml(brief: Brief, doc: Doc): string {
  const title = esc(doc.tool?.title ?? "Project");
  const parts = [
    `<p><strong>${title}</strong> · ${esc(brief.eyebrow.join(" · "))}</p>`,
    `<p><strong>${esc(plainText(brief.headline[0], doc))} ${esc(plainText(brief.headline[1], doc))}</strong></p>`,
  ];
  for (const s of brief.sections) parts.push(`<p><strong>${esc(s.label)}</strong></p><ul>${s.sentences.map((x) => `<li>${esc(plainText(x, doc))}</li>`).join("")}</ul>`);
  parts.push(`<p><em>Composed by FORM from the project data.</em></p>`);
  return parts.join("");
}
