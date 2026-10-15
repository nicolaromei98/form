import type { Minter } from "@/lib/domain/ids";
import { BRIEF_TEXT_MAX } from "@/lib/domain/limits";
import type { LocalViewState } from "@/lib/domain/schema/local";
import type { Audience, BriefSection } from "@/lib/domain/schema/primitives";
import type { ProjectDoc } from "@/lib/domain/schema/project";
import { clarify, Collector, type FamilyResult } from "@/lib/interpret/fast/context";
import { type Command, findNamed } from "@/lib/interpret/fast/match";
import { makeOp } from "@/lib/ops/build";

/**
 * The status brief (plan §8.4 steps 3 and 6), ported from v0: the user's own lines and "reset the
 * brief" first, so a line's words ("DNS needs a reset") are content and not commands; then the
 * requests for a brief and its follow-ups (audience, length). Opening the brief is the local show;
 * its audience and length are setView options, whose caption the show caption takes over.
 */

const BRIEF_SECTION: Readonly<Record<string, BriefSection>> = {
  note: "note",
  notes: "note",
  done: "done",
  "in progress": "moving",
  progress: "moving",
  next: "next",
  risk: "risks",
  risks: "risks",
  questions: "questions",
  "open questions": "questions",
};

const SECTION = "(note|notes|done|in progress|progress|next|risks?|open questions|questions)";
const BRIEF = "(?:the\\s+)?(?:(?:client|team)'?s?\\s+)?brief(?:\\s+for\\s+(?:the\\s+)?(?:client|team))?";
const ADD_LINE = new RegExp(
  `^(?:add|write|put|include)\\s+(?:a\\s+)?(?:line|note|sentence)?\\s*(?:to|in|on|into)\\s+${BRIEF}(?:\\s+(?:under|in|to)\\s+(?:the\\s+)?${SECTION})?\\s*[:,\\-–]\\s*(.+)$`,
  "i",
);
const ADD_TO_SECTION = new RegExp(`^(?:add|write|put)\\s+(?:to|under|in)\\s+(?:the\\s+)?${SECTION}\\s*[:,\\-–]\\s*(.+)$`, "i");

/** The audience a command names ("the team brief", "the brief for the client"), else the one on screen */
function audienceOf(s: string, current: Audience): Audience {
  const named = s.match(/\b(client|team)'?s? (?:brief|update|version)\b|\b(?:brief|update|version) for the (client|team)\b/);
  return ((named?.[1] ?? named?.[2]) as Audience | undefined) ?? current;
}

/** "Add to the brief: homepage preview on Friday", "Reset the brief" */
export function briefEdit(cmd: Command, project: ProjectDoc | null, local: LocalViewState, mint: Minter): FamilyResult | null {
  if (!project) return null;
  const { raw, clean, s } = cmd;
  const inBrief = local.activeView === "brief";
  const current = project.viewConfig.brief.audience;
  const audience = audienceOf(s, current);
  // The brief comes on screen, in the audience the command names: a side effect of the edit, so
  // the line or the reset speaks, not the brief's own status (caption policy rule 4)
  const show = (c: Collector) => {
    c.reveal("brief", local.activeView);
    if (audience !== current) c.op(makeOp({ op: "setView", patch: { briefAudience: audience } }));
  };

  const add = clean.match(ADD_LINE) ?? (inBrief ? clean.match(ADD_TO_SECTION) : null);
  if (add) {
    // `clean` drops the closing punctuation; a question keeps its "?" and an exclamation its "!"
    const end = raw.trim().match(/[.!?]+$/)?.[0] ?? ".";
    const text = add[2].trim().replace(/^["“]|["”]$/g, "");
    if (!text) return clarify("What should the line say? e.g. 'add to the brief: homepage preview on Friday'.", "anchored");
    // Without a section, the user's line is a note: their own words, under the headline
    const section = BRIEF_SECTION[(add[1] ?? "note").toLowerCase()] ?? "note";
    const line = (text.charAt(0).toUpperCase() + text.slice(1) + end).slice(0, BRIEF_TEXT_MAX).trimEnd();
    // The line first, so its part leads the caption
    const c = new Collector(project);
    c.op(makeOp({ op: "addBriefLine", lineId: mint("briefLine"), audience, section, text: line }));
    show(c);
    return c.result("anchored");
  }

  // "my edits" alone only means the brief while it's on screen
  if (/^(reset|restore|clear|undo|drop|discard)\b/.test(s) && (/\bbrief\b|form'?s version/.test(s) || (inBrief && /\bmy (edits|changes|wording)\b/.test(s)))) {
    // A brief with nothing of the user's in it is an honest no-op: "The client brief is already FORM's version"
    const c = new Collector(project);
    show(c);
    c.op(makeOp({ op: "resetBrief", audience }));
    return c.result("keyword");
  }
  return null;
}

const NOUN = "(brief|update|report|recap)";
const ASK_STATUS = new RegExp(`\\b(status|client|team|weekly|project|progress) ${NOUN}\\b`);
const ASK_VERB = new RegExp(`\\b(write|draft|prepare|generate|create|compose|give me|send|make|add|open)\\b( me)?( an?| the| a quick| a short| a weekly)? ${NOUN}\\b`);
const FOR_TEAM = /^(now |and )?(make it |write it |make the brief |show it )?(for (the |my |our )?team|internal|the team version|team version)( version)?$/;
const FOR_CLIENT = /^(now |and )?(make it |write it |make the brief |show it )?(for (the |my |our )?client|external|the client version|client version)( version)?$/;
const SHORTER = /^(now )?(make (it|the brief) )?(shorter|short|briefer|the short version|short version|just the essentials|tl;?dr)$/;
const LONGER = /^(now )?(make (it|the brief) )?(longer|the full version|full version|full|more detail(ed)?)$/;
const COPY = /^copy( it| this| the brief)?$/;

/** "Write a status update for the client", "Now make it for the team", "Make the brief shorter" */
export function briefRequest(s: string, project: ProjectDoc | null, local: LocalViewState): FamilyResult | null {
  if (!project) return null;
  // Commands about something else that merely contain brief-like words ("add a task called Status report",
  // "add a note: client brief due Friday", "mark Website copy as done", "assign UI Design to the team")
  if (/\b(add|create|new|rename|called|named|note)\b.*\b(task|step|subtask|note|it)\b|\b(called|named|rename)\b|^add (a |an )?note\b/.test(s)) return null;
  if (/\b(assign\w*|overload\w*|workload|capacity|balance|rebalanc\w*)\b/.test(s)) return null;
  if (findNamed(s, project)) return null;

  const inBrief = local.activeView === "brief";
  // "summary" alone stays with the metrics block ("show the project summary"); only "summary for the client/team" is a brief
  const asks =
    (ASK_STATUS.test(s) && !/\bupdate (the|its|their|my|his|her) /.test(s)) ||
    ASK_VERB.test(s) ||
    /\b(update|report|recap|brief|summary) for (the |my |our )?(client|team)\b/.test(s) ||
    /\bsend (the |my |our )?(client|team) (an? )?(update|brief|recap|report)\b/.test(s) ||
    /\bwhat (do|should|can) (i|we) (tell|say to|send) (the |my |our )?(client|team)\b/.test(s) ||
    /\b(show|open|switch to|go to)( the)? brief\b|\bas a brief\b/.test(s);
  // Follow-ups only as whole commands, so they can't swallow task edits
  const forTeam = FOR_TEAM.test(s);
  const forClient = FOR_CLIENT.test(s);
  const shorter = SHORTER.test(s);
  const longer = LONGER.test(s);
  const copy = COPY.test(s);
  // From another view, "make it for the team" / "make the brief shorter" mean the brief too (they're in the palette)
  const followUp = forTeam || forClient || shorter || longer || copy;
  if (!asks && !followUp) return null;
  if (!inBrief && !asks && (copy || ((shorter || longer) && !/\bbrief\b/.test(s)))) return null;
  const tier = asks ? "keyword" : "anchored";

  const current = project.viewConfig.brief.audience;
  const audience: Audience =
    forTeam || (asks && /\bteam\b/.test(s) && !/\bclient\b/.test(s)) ? "team" : forClient || (asks && /\bclient\b/.test(s)) ? "client" : inBrief ? current : "client";
  const wasShort = project.viewConfig.brief.short;
  const patch: { briefAudience?: Audience; briefShort?: boolean } = {};
  if (audience !== current) patch.briefAudience = audience;
  if (shorter && !wasShort) patch.briefShort = true;
  else if (longer && wasShort) patch.briefShort = false;
  if (copy && inBrief) return clarify("Use Copy on the brief: the clipboard needs a click.", "anchored");

  const c = new Collector(project);
  if (inBrief && Object.keys(patch).length === 0) {
    // Nothing to change: the honest no-op says "Already the client brief[, short version]"
    c.op(makeOp({ op: "setView", patch: { briefAudience: audience } }));
    return c.result(tier);
  }
  if (Object.keys(patch).length > 0) c.op(makeOp({ op: "setView", patch }));
  // The show caption ("Status brief · for the team · …") takes over the options' own part
  c.show("brief");
  return c.result(tier);
}
