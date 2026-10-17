import { NAMED_COLOURS } from "@/lib/domain/colours";
import { compareKeys, sortedByOrder } from "@/lib/domain/order";
import type { PersonId } from "@/lib/domain/schema/ids";
import type { ProjectDoc, Step, Task } from "@/lib/domain/schema/project";
import type { WorkspaceDoc } from "@/lib/domain/schema/workspace";
import type { NamedPerson } from "@/lib/interpret/fast/context";

/**
 * Matching helpers of the fast parser, ported from v0 `lib/interpret/demo.ts` with the same
 * regexes: the normalised command, named tasks, steps and people, amounts, colours, and the rule
 * that tells a new project from a new view.
 */

/** A command in the three forms the rules read */
export interface Command {
  /** As typed */
  raw: string;
  /** Quotes, spaces and the closing punctuation normalised; case kept for titles */
  clean: string;
  /** `clean` in lower case: what the rules match. Same length, so indices are shared */
  s: string;
}

/**
 * v0's normalisation: curly quotes, runs of whitespace, the closing ".!?" and "mood board" →
 * "moodboard " (the length is kept, so `clean` and `s` still share indices).
 */
export function normalise(raw: string): Command {
  const clean = raw
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "")
    .replace(/\b(mood)[ -](boards?)\b/gi, "$1$2 ")
    .trimEnd();
  return { raw, clean, s: clean.toLowerCase() };
}

export const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function capitalise(t: string): string {
  const v = t.trim();
  return v.charAt(0).toUpperCase() + v.slice(1);
}

/** A one-line title within `max` characters (the schemas refuse a trailing space); `fallback` when nothing is left */
export function lineOf(t: string, max: number, fallback = ""): string {
  return capitalise(t).slice(0, max).trimEnd() || fallback;
}

/** Whether the whole command matched a regex (an anchored template, Q17) */
export function covers(re: RegExp, s: string): boolean {
  const m = re.exec(s);
  return m !== null && m.index === 0 && m[0].length === s.length;
}

/* ------------------------------------------------------------------
   Tasks and steps named in a command
   ------------------------------------------------------------------ */

/** A sentence about several tasks: "this" then means none of them in particular (v0) */
export const PLURAL = /\b(ones|tasks|cards|items|all|everything|them|these|those|rows|bars)\b/;

/** What a command can point at: a task, or one of its steps (v0 kept steps as tasks with a parent) */
export type Target = { kind: "task"; task: Task } | { kind: "step"; task: Task; step: Step };

export function targetTitle(t: Target): string {
  return t.kind === "task" ? t.task.title : t.step.title;
}

const titleRe = (title: string) => new RegExp(`\\b${escapeRe(title)}\\b`);

interface Named {
  re: RegExp;
  target: Target;
}

/** The titles a command can name, longest first, built once per tasks record (documents are immutable) */
const NAMED = new WeakMap<object, readonly Named[]>();

function namedIndex(project: ProjectDoc): readonly Named[] {
  let index = NAMED.get(project.tasks);
  if (!index) {
    const list: (Named & { length: number })[] = [];
    const add = (title: string, target: Target) => {
      const t = title.toLowerCase().trim();
      if (t.length >= 3) list.push({ re: titleRe(t), target, length: t.length });
    };
    const tasks = sortedByOrder(project.tasks);
    for (const task of tasks) add(task.title, { kind: "task", task });
    for (const task of tasks) for (const step of task.steps) add(step.title, { kind: "step", task, step });
    // Stable: equally long titles keep the reading order
    index = list.sort((a, b) => b.length - a.length);
    NAMED.set(project.tasks, index);
  }
  return index;
}

/**
 * The longest task or step title named in the command (case-insensitive, at least 3 characters),
 * as v0's `findNamedTask`. Tasks are read in workflow order, then steps in task and step order
 * (v0 read its records in creation order, where the template's tasks come first); the first of
 * equally long titles wins.
 */
export function findNamed(s: string, project: ProjectDoc): Target | null {
  for (const named of namedIndex(project)) if (named.re.test(s)) return named.target;
  return null;
}

/** The longest top-level task title named in the command */
export function findNamedTask(s: string, project: ProjectDoc): Task | null {
  const named = findNamed(s, project);
  return named?.kind === "task" ? named.task : null;
}

/* ------------------------------------------------------------------
   People
   ------------------------------------------------------------------ */

/** The workspace's active people, in Team row order */
export function activePeople(ws: Pick<WorkspaceDoc, "people">): NamedPerson[] {
  return sortedByOrder(ws.people).filter((p) => !p.archived);
}

/** The longest active person's name in the command (v0 `personIn`) */
export function personIn(s: string, ws: Pick<WorkspaceDoc, "people">): NamedPerson | null {
  let best: NamedPerson | null = null;
  for (const p of activePeople(ws)) {
    if (titleRe(p.name.toLowerCase()).test(s) && (!best || p.name.length > best.name.length)) best = p;
  }
  return best;
}

/** The active person with this name (trimmed, case-insensitive), lowest id first */
export function activeNamed(ws: Pick<WorkspaceDoc, "people">, name: string): PersonId | null {
  const key = name.trim().toLowerCase();
  for (const id of (Object.keys(ws.people) as PersonId[]).sort(compareKeys)) {
    const p = ws.people[id];
    if (!p.archived && p.name.trim().toLowerCase() === key) return id;
  }
  return null;
}

/* ------------------------------------------------------------------
   Numbers
   ------------------------------------------------------------------ */

/** An amount in the major unit: "€2,400", "2.400", "2.5k", "12k" (v0 `parseAmount`) */
export function parseAmount(s: string): number | null {
  const m = s.match(/(?:€|eur|\$|usd|£)?\s?(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s?(k)?\b/);
  if (!m) return null;
  let raw = m[1];
  // "2,400" / "2.400" → thousands separators; "2.5" → decimal
  if (/^\d{1,3}([.,]\d{3})+$/.test(raw)) raw = raw.replace(/[.,]/g, "");
  else raw = raw.replace(",", ".");
  const n = parseFloat(raw) * (m[2] ? 1000 : 1);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Working days in a week: "N weeks" means N × 5 working days (plan §1.3) */
export const WORKING_DAYS_PER_WEEK = 5;

/** "3 days", "2 weeks", "1.5d", "2w": a duration in working days, or null (v0's regex) */
export function parseDays(s: string): number | null {
  const m = s.match(/\b(\d+(?:\.\d+)?)\s*(d|days?|w|weeks?)\b/);
  if (!m) return null;
  return parseFloat(m[1]) * (m[2].startsWith("w") ? WORKING_DAYS_PER_WEEK : 1);
}

/** The nearest half day */
export const toHalfDays = (n: number) => Math.round(n * 2) / 2;

/* ------------------------------------------------------------------
   Colours
   ------------------------------------------------------------------ */

export interface NamedColour {
  hex: string;
  /** "Off white", "Terracotta"; null for a hex code */
  name: string | null;
}

/** Colours named in a sentence, in reading order: hex codes and a small set of plain names (v0, at most 12) */
export function coloursIn(s: string): NamedColour[] {
  const found: { at: number; hex: string; name: string | null }[] = [];
  for (const m of s.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) found.push({ at: m.index ?? 0, hex: `#${m[1]}`, name: null });
  let rest = s;
  for (const [name, hex] of NAMED_COLOURS) {
    const m = new RegExp(`\\b${name}\\b`).exec(rest);
    if (!m) continue;
    found.push({ at: m.index, hex, name: capitalise(name.replace("-", " ")) });
    // Blank it out so "off white" isn't counted again as "white"
    rest = rest.slice(0, m.index) + " ".repeat(name.length) + rest.slice(m.index + name.length);
  }
  return found
    .sort((a, b) => a.at - b.at)
    .slice(0, 12)
    .map((c) => ({ hex: c.hex, name: c.name }));
}

/* ------------------------------------------------------------------
   New project or new view
   ------------------------------------------------------------------ */

// A name or a note that happens to contain the words is never a request
const NAMING = /\b(called|named|titled|rename[ds]?)\b|\bnote\b/;
const NEW_PROJECT =
  /\b(create|start|build|set ?up|make|spin up|open|begin|give me|i need)\b.*\b(new|another|second|fresh|separate|different) (project|tracker|planner|workspace)\b|^(an? )?(new|another) (project|tracker)\b/;
const EXPLICIT_PROJECT = /\b(create|build|generate|set ?up|spin up)\b.*\b(project|planner|workspace)\b/;
const VIEW_WORD = /\b(tracker|board|kanban|timeline|gantt|schedule|team|workload|focus|brief|cards?|list|moodboards?)\b/;

/**
 * Does this command replace the open project (v0 `replacesProject`)? Only an explicit request for
 * a new or another one ("create a new project", "set up a project for the launch"). Naming a view
 * ("create a timeline for my project") adds that view instead.
 */
export function replacesProject(command: string): boolean {
  const s = command.toLowerCase().replace(/\s+/g, " ").trim();
  if (NAMING.test(s)) return false;
  return NEW_PROJECT.test(s) || (EXPLICIT_PROJECT.test(s) && !VIEW_WORD.test(s));
}
