import { breakdownFor } from "./library";
import { schedule } from "../selectors";
import { focusPick } from "../focus";
import { balancePlan, fmtLoad, loadsOf } from "../team";
import {
  REPRESENTATION_LABEL,
  SORT_LABEL,
  STATUS_LABEL,
  type Doc,
  type Interpretation,
  type MoodInput,
  type MoodLayout,
  type Operation,
  type Person,
  type Priority,
  type Representation,
  type Sort,
  type Status,
  type Task,
} from "../schema";

export interface InterpretContext {
  doc: Doc;
  selectedId: string | null;
}

/**
 * FORM demo-mode interpreter.
 *
 * A deterministic, rule-based parser for the flagship scenario and sensible
 * variations. It is NOT a language model: anything it does not recognise is
 * reported back as unsupported instead of guessed.
 */
export function interpretDemo(raw: string, ctx: InterpretContext): Interpretation {
  // `clean` keeps case for titles; `s` is the matching form. Same length → shared indices.
  // "mood board" → "moodboard " keeps the length, so `clean` and `s` still share indices
  const clean = raw
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "")
    .replace(/\b(mood)[ -](boards?)\b/gi, "$1$2 ")
    .trimEnd();
  const s = clean.toLowerCase();
  const { doc, selectedId } = ctx;

  if (!s) return clarify("Describe what you want to build or change.");

  /* ---------- control ---------- */
  if (/^(undo|undo (that|it)|go back|revert( that)?)$/.test(s)) return control("undo", "Undone");
  if (/^redo( that| it)?$/.test(s)) return control("redo", "Redone");
  if (/\b(reset|start over|clear (the )?(workspace|everything)|wipe (it|everything))\b/.test(s)) return control("reset", "Workspace reset");

  /* ---------- tool families not in this build ---------- */
  if (/\b(compar\w*|versus|vs|pros and cons|trade-?offs?)\b/.test(s)) {
    return unsupported("Comparison tools aren't in this build yet — the project tracker is the live tool family.");
  }
  if (/\b(budget|expenses?|spending)\b/.test(s) && !(selectedId && /\d/.test(s))) {
    return unsupported("Budget overviews aren't in this build yet. You can give a selected task a cost — e.g. 'set the cost to €2,400'.");
  }

  /* ---------- create ---------- */
  const createVerb = /\b(create|make|build|set ?up|start|generate|spin up|give me|i need|new)\b/.test(s);
  const createNoun = /\b(tracker|project|plan|planner|tasks?|to-?dos?|workspace|board|kanban|timeline)\b/.test(s);
  const explicitCreate =
    /\b(create|build|generate|set ?up|spin up)\b.*\b(project|tracker|planner|workspace)\b/.test(s) || /\bnew (project|tracker)\b/.test(s);
  const organise = /\b(help me )?(organi[sz]e|track|plan)\b.*\b(tasks?|work|project|website|site|launch)\b/.test(s);

  const wantsMood = /\bmoodboards?\b/.test(s);
  if ((!doc.tool && ((createVerb && (createNoun || wantsMood)) || organise)) || (doc.tool && explicitCreate)) {
    const isWeb = /\b(web ?site|site|landing page|web)\b/.test(s);
    const subject = clean.match(/\bfor (?:my|our|the|a|an)?\s*(?:new\s+)?(.+)$/i)?.[1];
    const title = isWeb || !subject ? "New website" : capitalise(subject).slice(0, 60);
    const ops: Operation[] = [{ op: "createProject", title, template: "website" }];
    const rep = representationIn(s, true)?.rep;
    if (rep && rep !== "cards") ops.push({ op: "setRepresentation", representation: rep });
    // A moodboard lives inside a project: asking for one creates the project around it
    if (wantsMood) ops.push({ op: "addBlock", block: "moodboard" });
    const note = isWeb || !subject || wantsMood ? "" : " · Demo mode ships one template (website) — rename anything";
    return { ops, tone: "done", message: `Project tracker created · 4 tasks${wantsMood ? " · moodboard below, drop images onto it" : ""}${note}`, target: null };
  }

  if (!doc.tool) {
    return clarify("Nothing to shape yet. Start with: 'Create a project tracker for my new website'.");
  }

  /* ---------- workload plan follow-ups ---------- */
  if (doc.plan) {
    const n = doc.plan.moves.length;
    if (/^(yes|ok|okay|sure|accept( (it|them|all|the plan))?|apply|do it|confirm|looks good|go ahead)\b/.test(s)) {
      return { ops: [{ op: "acceptReassign" }], tone: "done", message: `${n} task${n > 1 ? "s" : ""} reassigned`, target: null };
    }
    if (/^(no|discard|reject|cancel|dismiss|never ?mind|keep it as it is)\b/.test(s)) {
      return { ops: [{ op: "discardReassign" }], tone: "done", message: "Plan discarded · nothing moved", target: null };
    }
  }

  /* ---------- moodboard ---------- */
  const mood = moodboardIntent(clean, s, doc);
  if (mood) return mood;

  /* ---------- team ---------- */
  const team = teamIntent(clean, s, doc, selectedId);
  if (team) return team;

  /* ---------- proposal follow-ups ---------- */
  if (doc.proposal) {
    if (/^(yes|ok|okay|sure|accept( (them|all|these|it))?|apply|keep (them|it)|looks good|add (them|these)|do it|confirm)\b/.test(s)) {
      return { ops: [{ op: "acceptProposal" }], tone: "done", message: `${doc.proposal.items.length} steps added`, target: doc.proposal.parentId };
    }
    if (/^(no|discard|reject|cancel|dismiss|remove (them|these)|never ?mind)\b/.test(s)) {
      return { ops: [{ op: "discardProposal" }], tone: "done", message: "Proposal discarded", target: doc.proposal.parentId };
    }
  }

  const ops: Operation[] = [];
  const notes: string[] = [];

  /* ---------- entity-level (Point & Ask or named task) ---------- */
  const plural = /\b(ones|tasks|cards|items|all|everything|them|these|those|rows|bars)\b/.test(s);
  const named = findNamedTask(s, doc);
  const selected = selectedId ? doc.tasks[selectedId] ?? null : null;
  const target: Task | null = named ?? (selected && !plural ? selected : null);

  const wantsBreakdown =
    (/\b(break|split|divide|decompose|chunk)\b/.test(s) && /\b(down|up|into|smaller|steps?|subtasks?|parts|pieces|chunks)\b/.test(s)) ||
    /\b(sub-?tasks|smaller steps|steps for)\b/.test(s);

  if (wantsBreakdown) {
    if (!target) return clarify("Select a task first — click its number badge — then ask again.");
    if (target.parentId) return clarify("Steps can't be nested further in this build.");
    const items = breakdownFor(target);
    const total = items.every((i) => i.estimate != null) ? ` · fits its ${target.estimate}d estimate` : "";
    return {
      ops: [{ op: "proposeSubtasks", parentId: target.id, items }],
      tone: "proposal",
      message: `${items.length} steps proposed for ${target.title}${total}. Review them on the task.`,
      target: target.id,
    };
  }

  let entityHandled = false;
  if (target) {
    const patch: Extract<Operation, { op: "updateTask" }>["patch"] = {};

    // Rename
    const rename = clean.match(/\b(?:rename|retitle)\b.*?\bto\s+"?([^"]+?)"?$/i) ?? clean.match(/\bcall (?:it|this|that)\s+"?([^"]+?)"?$/i);
    if (rename) {
      patch.title = capitalise(rename[1]).slice(0, 140);
      notes.push(`Renamed to ${patch.title}`);
    }

    // Status
    const statusVerb = /\b(mark|set|move|change|make|put|flag|is|it's)\b/.test(s) || /^(complete|finish|start|reopen)\b/.test(s);
    if (!rename && statusVerb) {
      let st: Status | null = null;
      if (/\b(done|complete(d)?|finished|closed)\b/.test(s) || /^(complete|finish)\b/.test(s)) st = "done";
      else if (/\b(in review|review|for review)\b/.test(s)) st = "review";
      else if (/\b(in progress|started|active|working on|doing|ongoing)\b/.test(s) || /^start\b/.test(s)) st = "active";
      else if (/\b(to ?do|not started|backlog)\b/.test(s) || /^reopen\b/.test(s)) st = "todo";
      if (st) {
        patch.status = st;
        notes.push(`${target.title} → ${STATUS_LABEL[st]}`);
      }
    }

    // Priority
    let pr: Priority | null = null;
    if (/\b(make|mark|set|flag)\b/.test(s) && /\b(urgent|critical|asap)\b/.test(s) && !/\bhighlight\b/.test(s)) pr = "urgent";
    const prWord = s.match(/\b(high|low|medium|normal)\s+priority\b/) ?? s.match(/\bpriority\s+(?:to\s+)?(high|low|medium|normal|urgent)\b/);
    if (prWord) pr = (prWord[1] === "normal" ? "medium" : prWord[1]) as Priority;
    if (pr) {
      patch.priority = pr;
      notes.push(`Priority ${pr}`);
    }

    // Emphasis
    if (/\b(less prominent|de-?emphasi[sz]e|unpin|remove (the )?(emphasis|prominence))\b/.test(s)) {
      patch.emphasis = false;
      notes.push("Emphasis removed");
    } else if (/\b(prominent|stand out|emphasi[sz]e|bigger|larger|feature|spotlight|pin)\b/.test(s) || /\bhighlight (this|it|that)\b/.test(s)) {
      patch.emphasis = true;
      notes.push(`${target.title} emphasised`);
    }

    // Estimate
    const est = s.match(/\b(\d+(?:\.\d+)?)\s*(d|days?|w|weeks?)\b/);
    if (est && /\b(estimate|takes?|duration|will take|lasts?|long|set|make|change)\b/.test(s)) {
      const n = parseFloat(est[1]) * (est[2].startsWith("w") ? 7 : 1);
      patch.estimate = Math.min(90, Math.max(0.5, Math.round(n * 2) / 2));
      notes.push(`Estimate ${patch.estimate}d`);
    }

    // Progress
    const pct = s.match(/\b(\d{1,3})\s*%/);
    if (pct && !/\bcost\b/.test(s)) {
      patch.progress = Math.min(100, parseInt(pct[1], 10));
      notes.push(`Progress ${patch.progress}%`);
    } else if (/\bhalf ?way\b/.test(s)) {
      patch.progress = 50;
      notes.push("Progress 50%");
    }

    // Cost — never invented
    if (/\b(cost|price|spend|budget)\b/.test(s)) {
      const amount = parseAmount(s);
      if (amount == null) {
        return clarify(`FORM won't invent a cost for ${target.title}. Give an amount — e.g. 'set the cost to €2,400'.`, target.id);
      }
      patch.cost = amount;
      notes.push(`Cost €${amount.toLocaleString("en-US")}`);
    }

    if (Object.keys(patch).length) {
      ops.push({ op: "updateTask", id: target.id, patch });
      entityHandled = true;
    }

    // Subtask
    const sub = clean.match(/\badd (?:a |an |another )?(?:sub-?task|step)\b(?:\s+(?:called|named|for))?\s*:?\s*"?([^"]*)"?$/i);
    if (sub && !target.parentId) {
      const title = capitalise(sub[1] || "New step");
      ops.push({ op: "addTask", title, parentId: target.id, estimate: null });
      notes.push(`Step added to ${target.title}`);
      entityHandled = true;
    }

    // Remove
    if (/\b(delete|remove)\b/.test(s) && (/\b(this|it|task)\b/.test(s) || named) && !/\b(completed|done|highlight|emphasis|metrics|progress)\b/.test(s)) {
      ops.push({ op: "removeTask", id: target.id });
      notes.push(`${target.title} removed`);
      entityHandled = true;
    }
  }

  /* ---------- workspace-level ---------- */

  // Focus: reorganise the workspace around the one task that matters now
  const focusNamed = /\bfocus (on|mode for)\b/.test(s) && named && !named.parentId ? named : null;
  const focusAsk =
    /\b(focus( mode)?|what should i (do|work on|tackle)( now| next| first| today)?|what'?s next|what is next|where (do|should) i start|what matters (most|now)|help me (focus|prioriti[sz]e))\b/.test(s);
  if (focusNamed || (focusAsk && !/\b(exit|leave|stop)\b/.test(s))) {
    const pinned = focusNamed ? { ...doc, view: { ...doc.view, focusId: focusNamed.id } } : { ...doc, view: { ...doc.view, focusId: null } };
    const pick = focusPick(pinned);
    if (!pick) return { ops: [{ op: "setRepresentation", representation: "focus" }], tone: "done", message: "Focus · everything is done", target: null };
    return {
      ops: [
        { op: "setRepresentation", representation: "focus" },
        { op: "setView", patch: { focusId: focusNamed ? focusNamed.id : null } },
      ],
      tone: "done",
      message: focusNamed ? `Focus · ${pick.task.title}` : `Focus · ${pick.task.title} — ${pick.reasons[0]?.text.toLowerCase() ?? "highest score"}`,
      target: null,
    };
  }
  if (/\b(exit|leave|stop) focus\b|\bshow (me )?(everything|all( tasks)?)( again)?\b/.test(s)) {
    return { ops: [{ op: "setRepresentation", representation: "cards" }], tone: "done", message: "Tracker · everything back", target: null };
  }

  // Representation
  const rep = representationIn(s, false);
  if (rep) {
    ops.push({ op: "setRepresentation", representation: rep.rep });
    if (rep.list) ops.push({ op: "setView", patch: { layout: "list" } });
    notes.push(rep.list ? "List" : REPRESENTATION_LABEL[rep.rep]);
    if (rep.rep === "timeline") {
      if (doc.tool.startDateIsSample) notes.push("sample dates, sequenced from estimates");
      const sch = schedule(doc);
      if (sch.unscheduled.length) notes.push(`${sch.unscheduled.length} task${sch.unscheduled.length > 1 ? "s" : ""} need a duration`);
    }
  }

  // Density (skip when the words were about a single emphasised entity)
  if (!entityHandled || plural) {
    if (/\b(less compact|bigger|larger|roomier|spacious|comfortable|more detail(ed)?|expand(ed)?|more space|airier|normal size)\b/.test(s)) {
      ops.push({ op: "setView", patch: { density: "comfortable" } });
      notes.push("Comfortable density");
    } else if (/\b(compact|compress|smaller|tighter|condensed?|denser|dense|slimmer|less space|shrink)\b/.test(s)) {
      ops.push({ op: "setView", patch: { density: "compact" } });
      notes.push("Compact");
    }
  }

  // Columns / layout
  const cols = s.match(/\b(one|two|three|four|single|1|2|3|4)\s+columns?\b/);
  if (cols) {
    const n = ({ one: 1, single: 1, two: 2, three: 3, four: 4 } as Record<string, number>)[cols[1]] ?? parseInt(cols[1], 10);
    ops.push({ op: "setView", patch: { columns: n } });
    if (doc.view.representation !== "cards" && !rep) ops.push({ op: "setRepresentation", representation: "cards" });
    notes.push(`${n} column${n > 1 ? "s" : ""}`);
  } else if (/\bgrid\b/.test(s)) {
    ops.push({ op: "setView", patch: { layout: "grid" } });
    if (doc.view.representation !== "cards" && !rep) ops.push({ op: "setRepresentation", representation: "cards" });
    notes.push("Grid");
  }

  // Sort
  if (/\b(sort|order|rank|arrange|reorder|prioriti[sz]e)\b/.test(s) || /\b(most|least) (urgent|important|done|complete)\b.*\bfirst\b/.test(s)) {
    let key: Sort | null = null;
    if (/\b(manual|original|default|workflow) order\b|\bunsort/.test(s)) key = "manual";
    else if (/\bby (priority|importance|urgency)\b|\b(urgent|important)\w* first\b|\bprioriti[sz]e\b/.test(s)) key = "priority";
    else if (/\bby (progress|completion)\b|\b(done|complete)\w* first\b/.test(s)) key = "progress";
    else if (/\bby status\b/.test(s)) key = "status";
    else if (/\bby (name|title)\b|\balphabetical\w*\b/.test(s)) key = "title";
    else if (/\bby (duration|length|estimate|effort|size)\b|\blongest first\b/.test(s)) key = "estimate";
    if (key) {
      ops.push({ op: "setView", patch: { sort: key } });
      notes.push(key === "manual" ? "Workflow order" : `Sorted by ${SORT_LABEL[key].toLowerCase()}`);
    } else if (!ops.length) {
      return clarify("Sort by what? Priority, progress, status, name or duration.");
    }
  }

  // Completed tasks
  if (/\b(hide|remove|filter out|without|exclude|don't show)\b.*\b(completed|done|finished|closed)\b/.test(s)) {
    ops.push({ op: "setView", patch: { hideDone: true } });
    notes.push("Completed hidden");
  } else if (/\b(show|reveal|bring back|include|unhide)\b.*\b(completed|done|finished|all tasks|everything)\b/.test(s) && doc.view.hideDone) {
    ops.push({ op: "setView", patch: { hideDone: false } });
    notes.push("Completed visible");
  }

  // Urgent highlight
  if (/\b(remove|clear|stop|turn off|no)\b.*\bhighlight/.test(s)) {
    ops.push({ op: "setView", patch: { highlightUrgent: false } });
    notes.push("Highlight off");
  } else if (/\b(highlight|emphasi[sz]e|flag|call out|spotlight|surface|mark)\b.*\b(urgent|critical|important|high[- ]priority)\b/.test(s) && (!entityHandled || plural)) {
    ops.push({ op: "setView", patch: { highlightUrgent: true } });
    notes.push("Urgent highlighted");
  }

  // Fields
  const hideVerb = /\b(hide|remove|drop|without)\b/;
  const showVerb = /\b(show|add|include|display|bring back)\b/;
  if (/\b(estimates?|durations?)\b/.test(s) && !target) {
    if (hideVerb.test(s)) {
      ops.push({ op: "setFields", patch: { estimate: false } });
      notes.push("Estimates hidden");
    } else if (showVerb.test(s)) {
      ops.push({ op: "setFields", patch: { estimate: true } });
      notes.push("Estimates visible");
    }
  }
  if (/\bpriorit(y|ies)\b/.test(s) && !/\bby priority\b/.test(s) && !target && !/\bprioriti[sz]e\b/.test(s)) {
    if (hideVerb.test(s)) {
      ops.push({ op: "setFields", patch: { priority: false } });
      notes.push("Priority hidden");
    } else if (showVerb.test(s)) {
      ops.push({ op: "setFields", patch: { priority: true } });
      notes.push("Priority visible");
    }
  }
  if (/\bprogress\b/.test(s) && !/\bby progress\b/.test(s) && !/\d\s*%/.test(s)) {
    if (hideVerb.test(s)) {
      ops.push({ op: "setFields", patch: { progress: false } }, { op: "removeBlock", block: "progress" });
      notes.push("Progress hidden");
    } else if (showVerb.test(s)) {
      if (!doc.view.fields.progress) {
        ops.push({ op: "setFields", patch: { progress: true } });
        notes.push("Progress bars visible");
      } else if (!doc.tool.blocks.includes("progress")) {
        ops.push({ op: "addBlock", block: "progress" });
        notes.push("Project progress indicator added");
      } else {
        notes.push("Progress is already visible");
      }
    }
  }

  // Metrics block
  if (/\b(metrics|summary|stats|overview|kpis?)\b/.test(s)) {
    if (hideVerb.test(s)) {
      ops.push({ op: "removeBlock", block: "metrics" });
      notes.push("Metrics removed");
    } else if (showVerb.test(s)) {
      ops.push({ op: "addBlock", block: "metrics" });
      notes.push("Metrics added");
    }
  }

  // New top-level task
  const add = clean.match(/\badd (?:a |an |another )?(?:new )?task\b(?:\s+(?:called|named|for))?\s*:?\s*"?([^"]*)"?$/i);
  if (add && !/\b(sub-?task|step)\b/.test(s)) {
    const title = capitalise(add[1] || "New task");
    ops.push({ op: "addTask", title, parentId: null, estimate: null });
    notes.push(`${title} added`);
  }

  if (!ops.length && !notes.length) {
    return unsupported(
      target && /\b(this|it)\b/.test(s)
        ? `I understood you mean ${target.title}, but not the change. Try 'break this into smaller steps', 'mark it done' or 'make this more prominent'.`
        : "Demo mode doesn't understand that yet. It handles views, layout, sorting, filtering and task edits.",
    );
  }

  return { ops, tone: "done", message: notes.join(" · "), target: target?.id ?? null };
}

/* ------------------------------------------------------------------
   Moodboard
   ------------------------------------------------------------------ */

const NAMED_COLOURS: [string, string][] = [
  ["off white", "#f2efe8"],
  ["off-white", "#f2efe8"],
  ["terracotta", "#c65d3b"],
  ["burgundy", "#7a1f2b"],
  ["charcoal", "#36393d"],
  ["mustard", "#d4a017"],
  ["chocolate", "#4e342e"],
  ["ivory", "#f6f1e3"],
  ["cream", "#f1e6cf"],
  ["beige", "#e3d5bd"],
  ["sand", "#d8c3a5"],
  ["olive", "#6f7a3a"],
  ["sage", "#9caf88"],
  ["teal", "#2a8c86"],
  ["navy", "#1f2a44"],
  ["lilac", "#c3aed6"],
  ["blush", "#efc9c2"],
  ["rust", "#a9461f"],
  ["gold", "#c9a227"],
  ["silver", "#c0c0c0"],
  ["black", "#0c0c0c"],
  ["white", "#ffffff"],
  ["grey", "#8a8a8a"],
  ["gray", "#8a8a8a"],
  ["blue", "#2f5bea"],
  ["green", "#2e7d4f"],
  ["yellow", "#f2c94c"],
  ["orange", "#f2994a"],
  ["red", "#d64545"],
  ["pink", "#f4a6b7"],
  ["purple", "#6b4fa0"],
  ["brown", "#7b5544"],
];

/** Colours named in a sentence, in reading order: hex codes and a small set of plain names. */
function coloursIn(s: string): MoodInput[] {
  const found: { at: number; hex: string; name: string | null }[] = [];
  for (const m of s.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) found.push({ at: m.index ?? 0, hex: `#${m[1]}`, name: null });
  let rest = s;
  for (const [name, hex] of NAMED_COLOURS) {
    const re = new RegExp(`\\b${name}\\b`);
    const m = re.exec(rest);
    if (!m) continue;
    found.push({ at: m.index, hex, name: capitalise(name.replace("-", " ")) });
    // Blank it out so "off white" isn't counted again as "white"
    rest = rest.slice(0, m.index) + " ".repeat(name.length) + rest.slice(m.index + name.length);
  }
  return found.sort((a, b) => a.at - b.at).slice(0, 12).map((c) => ({ kind: "color", hex: c.hex, text: c.name }));
}

function moodboardIntent(clean: string, s: string, doc: Doc): Interpretation | null {
  const named = /\bmoodboards?\b/.test(s);
  const has = doc.tool!.blocks.includes("moodboard");
  const n = doc.mood.length;
  const refs = /\b(references?|inspiration|images?|pictures?|photos?|swatch(es)?|palette)\b/.test(s);
  const colourWord = /\b(colou?rs?|swatch(es)?|palette|hex)\b/.test(s) || /#[0-9a-f]{3,6}\b/.test(s);
  const note = clean.match(/\b(?:add|write|put|pin|leave) (?:a |an |another )?(?:sticky )?note\b(?:\s+(?:saying|that says|with|about))?\s*[:,-]?\s*"?([^"]*)"?$/i);
  if (!named && !note && !(colourWord && /\b(add|put|include|pin|use)\b/.test(s)) && !(has && refs)) return null;
  const show: Operation[] = has ? [] : [{ op: "addBlock", block: "moodboard" }];

  if (named && /\b(remove|hide|close|drop|get rid of)\b/.test(s) && !/\b(note|colou?r|image|reference)s?\b/.test(s)) {
    if (!has) return { ops: [], tone: "done", message: "The moodboard is already hidden", target: null };
    return { ops: [{ op: "removeBlock", block: "moodboard" }], tone: "done", message: `Moodboard hidden${n ? ` · its ${n} references are kept` : ""}`, target: null };
  }
  if (named && /\b(clear|empty|wipe|delete everything)\b/.test(s)) {
    if (!n) return { ops: show, tone: "done", message: "The moodboard is already empty", target: null };
    return { ops: [...show, { op: "clearMood" }], tone: "done", message: `Moodboard cleared · ${n} references removed`, target: null };
  }
  if (/\b(tidy|arrange|organi[sz]e|lay ?out|clean up|align|sort out|rearrange|grid|masonry|collage|scatter)\b/.test(s) && (named || refs)) {
    if (n < 2) return clarify("Add a few references first — drop images onto the moodboard, or add notes and colours.");
    const layout: MoodLayout = /\b(collage|scatter\w*|loose|messy|table|overlap\w*)\b/.test(s)
      ? "collage"
      : /\b(grid|contact sheet|align\w*|uniform|even\w*|rows?)\b/.test(s)
        ? "grid"
        : "masonry";
    return { ops: [...show, { op: "arrangeMood", layout }], tone: "done", message: `Moodboard arranged as a ${layout}`, target: null };
  }
  if (note) {
    const text = note[1].trim();
    return { ops: [{ op: "addMoodItems", items: [{ kind: "note", text: text ? capitalise(text) : "" }] }], tone: "done", message: text ? "Note pinned to the moodboard" : "Empty note added · double-click it to write", target: null };
  }
  if (colourWord) {
    const items = coloursIn(s);
    if (!items.length) return clarify("Which colours? A hex code or a name — e.g. 'add #E4572E and off-white to the moodboard'.");
    return { ops: [{ op: "addMoodItems", items }], tone: "done", message: `${items.length} colour${items.length > 1 ? "s" : ""} added to the moodboard`, target: null };
  }
  if (refs && /\b(add|upload|import|drop|insert|bring in)\b/.test(s)) {
    // Text can't carry image files: say how they get in, and open the board for them
    return { ops: show, tone: show.length ? "done" : "clarify", message: "Drop images onto the moodboard, paste them, or use Add images", target: null };
  }
  if (named) {
    if (!has) return { ops: show, tone: "done", message: n ? `Moodboard back · ${n} references` : "Moodboard added · drop, paste or browse images", target: null };
    return {
      ops: [],
      tone: "unsupported",
      message: "On the moodboard I can add notes and colours, arrange it (masonry, grid, collage), clear or hide it. Images: drop, paste or browse.",
      target: null,
    };
  }
  return null;
}

/* ------------------------------------------------------------------
   Team
   ------------------------------------------------------------------ */

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Longest team member name mentioned in the sentence. */
function personIn(s: string, doc: Doc): Person | null {
  let best: Person | null = null;
  for (const p of doc.people) {
    if (new RegExp(`\\b${escapeRe(p.name.toLowerCase())}\\b`).test(s) && (!best || p.name.length > best.name.length)) best = p;
  }
  return best;
}

function teamIntent(clean: string, s: string, doc: Doc, selectedId: string | null): Interpretation | null {
  const person = personIn(s, doc);
  const teamWord =
    /\b(team|teammates?|people|workload|work load|capacity|overload\w*|over capacity|busiest|assign\w*|reassign\w*|unassign\w*|hand (it |this |that )?over|balance|rebalanc\w*|even out|redistribut\w*)\b/.test(s) ||
    /\bwho('s| is)? doing what\b|\bwho does what\b/.test(s);
  if (!teamWord && !person) return null;
  const toTeam: Operation[] = doc.view.representation !== "team" ? [{ op: "setRepresentation", representation: "team" }] : [];
  const loads = loadsOf(doc).filter((l) => l.person);
  const noTeam = clarify("There's no team yet. Say 'add a sample team', or 'add Giulia and Paolo to the team'.");
  const wantsShow =
    /\b(show|open|see|switch to|go to|view|display)\b.*\b(team|workload|work load|people|capacity)\b/.test(s) || /\bwho('s| is)? doing what\b|\bwho does what\b|\bteam (view|workload)\b/.test(s);

  // Sample team
  if (/\b(sample|demo|example) team\b/.test(s)) {
    return { ops: [...toTeam, { op: "addSampleTeam" }], tone: "done", message: "Sample team added · Marta, Sara and Luca", target: null };
  }

  // Add people: "add Giulia and Paolo to the team (as designers) (with 5 days)"
  const add = clean.match(/\badd (.+?) (?:to|into|on) (?:the |my |our )?team\b(.*)$/i);
  if (add) {
    const names = add[1].split(/,|\band\b|&/i).map((n) => n.trim().replace(/^(a|an|the) /i, "")).filter(Boolean).slice(0, 6);
    const role = (add[2].match(/\bas (?:a |an |the )?([\p{L} ]+?)(?: with\b|$)/iu)?.[1] ?? "").trim().replace(/s$/, "") || null;
    const days = Number(add[2].match(/(\d+(?:\.\d+)?)\s*(?:days?|d)\b/)?.[1]) || undefined;
    const fresh = names.filter((n) => !doc.people.some((p) => p.name.toLowerCase() === n.toLowerCase()));
    if (!fresh.length) return clarify(names.length ? `${names.join(" and ")} ${names.length > 1 ? "are" : "is"} already on the team.` : "Who should join the team?");
    return {
      ops: [...toTeam, ...fresh.map((name): Operation => ({ op: "addPerson", name: capitalise(name), role: role ? capitalise(role) : null, capacity: days }))],
      tone: "done",
      message: `${fresh.map(capitalise).join(" and ")} added to the team · ${days ?? 10}d${fresh.length > 1 ? " each" : ""}${days ? "" : " by default"}`,
      target: null,
    };
  }

  if (!doc.people.length) {
    // The view itself offers the sample team, so showing it is still useful
    if (wantsShow) return { ops: toTeam, tone: "done", message: "Team · no one yet. Use the sample team, or say 'add Giulia to the team'", target: null };
    return teamWord ? noTeam : null;
  }

  // Remove someone: their work stays, unassigned
  if (person && /\b(remove|delete|drop|take)\b/.test(s) && /\bteam\b/.test(s)) {
    const owned = loadsOf(doc).find((l) => l.person?.id === person.id)?.tasks.length ?? 0;
    return { ops: [...toTeam, { op: "removePerson", id: person.id }], tone: "done", message: `${person.name} removed${owned ? ` · ${owned} task${owned > 1 ? "s" : ""} now unassigned` : ""}`, target: null };
  }

  // Capacity: "set Marta's capacity to 10 days", "Marta has 10 days"
  const cap = s.match(/(\d+(?:\.\d+)?)\s*(?:working )?(?:days?|d)\b/);
  if (person && cap && /\b(capacity|available|availability|has|have|gets?|can (do|work))\b/.test(s)) {
    const capacity = Math.min(90, Math.max(0.5, Number(cap[1])));
    return { ops: [...toTeam, { op: "updatePerson", id: person.id, patch: { capacity } }], tone: "done", message: `${person.name} · ${fmtLoad(capacity)}d of capacity`, target: null };
  }

  // Balance
  if (/\b(balance|rebalanc\w*|even out|redistribut\w*|spread (out )?the (work|load))\b/.test(s)) {
    const moves = balancePlan(doc);
    const worst = [...loads].sort((a, b) => b.over - a.over)[0];
    if (!moves.length) {
      return {
        ops: toTeam,
        tone: "done",
        message: worst && worst.over > 0 ? `${worst.person!.name} is ${fmtLoad(worst.over)}d over, but no handover fits anyone's capacity` : "Nobody is over capacity · nothing to move",
        target: null,
      };
    }
    const why = worst && worst.over > 0 ? `${worst.person!.name} is ${fmtLoad(worst.over)}d over` : "Unassigned work gets an owner";
    return {
      ops: [...toTeam, { op: "proposeReassign", moves }],
      tone: "proposal",
      message: `${why} · ${moves.length} handover${moves.length > 1 ? "s" : ""} proposed. Review it on the team.`,
      target: null,
    };
  }

  // Who's overloaded?
  if (/\b(overload\w*|over capacity|too busy|busiest|too much (work|on))\b/.test(s)) {
    const over = loads.filter((l) => l.over > 0).sort((a, b) => b.over - a.over);
    const roomy = [...loads].sort((a, b) => b.free - a.free)[0];
    const message = over.length
      ? `${over.map((l) => `${l.person!.name} is ${fmtLoad(l.over)}d over`).join(" · ")} · most room: ${roomy.person!.name} (${fmtLoad(roomy.free)}d free)`
      : `Nobody is over capacity · most room: ${roomy.person!.name} (${fmtLoad(roomy.free)}d free)`;
    return { ops: toTeam, tone: "done", message, target: null };
  }

  // Assign: "assign UI Design to Sara", "give this to Luca", "Sara takes Research", "unassign Development"
  const named = findNamedTask(s, doc);
  const selected = selectedId ? (doc.tasks[selectedId] ?? null) : null;
  const task = named ?? (selected && /\b(this|it|that)\b/.test(s) ? selected : null);
  const unassign = /\bunassign\w*\b|\b(remove|take) .*\bowner\b/.test(s);
  if (task && (unassign || (person && /\b(assign|give|hand|move|reassign|transfer|takes?|owns?|will do|is doing|to)\b/.test(s)))) {
    if (task.parentId) return clarify(`Steps follow their task — assign ${doc.tasks[task.parentId]?.title ?? "the parent task"} instead.`);
    const to = unassign ? null : person!;
    if ((task.owner ?? null) === (to?.id ?? null)) return { ops: toTeam, tone: "done", message: `${task.title} is already ${to ? `with ${to.name}` : "unassigned"}`, target: task.id };
    let note = "";
    if (to) {
      const after = loadsOf({ ...doc, tasks: { ...doc.tasks, [task.id]: { ...task, owner: to.id } } }).find((l) => l.person?.id === to.id)!;
      note = after.over > 0 ? ` · ${to.name} is now ${fmtLoad(after.over)}d over` : ` · ${to.name} ${fmtLoad(after.days)}/${fmtLoad(to.capacity)}d`;
    }
    return {
      ops: [...toTeam, { op: "assignTask", taskId: task.id, personId: to?.id ?? null }],
      tone: "done",
      message: to ? `${task.title} → ${to.name}${note}` : `${task.title} unassigned`,
      target: task.id,
    };
  }
  if (person && !task && /\b(assign|give|hand|reassign|transfer)\b/.test(s)) return clarify(`Which task should go to ${person.name}? Name it, or select it first.`);

  // Show the team
  if (wantsShow) {
    const over = loads.filter((l) => l.over > 0);
    return {
      ops: toTeam,
      tone: "done",
      message: `Team · ${over.length ? `${over.map((l) => l.person!.name).join(" and ")} over capacity` : "everyone within capacity"}`,
      target: null,
    };
  }

  return null;
}

/* ------------------------------------------------------------------ */

function representationIn(s: string, creating: boolean): { rep: Representation; list: boolean } | null {
  const hits: { rep: Representation; at: number; list: boolean }[] = [];
  const push = (re: RegExp, rep: Representation, list = false) => {
    const m = re.exec(s);
    if (m) hits.push({ rep, at: m.index, list });
  };
  push(/\b(timeline|gantt|schedule|roadmap|calendar|over time|chronolog\w*|deadlines?|due dates?)\b/, "timeline");
  // "sort by status" is a sort, not a board
  const sortByStatus = /\b(sort|order|rank|arrange)\b.*\bby status\b/.test(s);
  push(sortByStatus ? /\b(board|kanban|status columns|swim ?lanes)\b/ : /\b(board|kanban|by status|status columns|swim ?lanes)\b/, "board");
  if (!creating) {
    push(/\b(?:as|into|to|show|switch to|return to|back to)\b(?: the| a| an| my)?(?: original| default| first)?(?: project)? (?:tracker|cards?|card view)\b/, "cards");
    push(/\b(back|return|revert)\b.*\b(tracker|cards?|original)\b/, "cards");
    push(/\b(?:as|into|in) (?:a )?list\b|\blist (?:view|layout)\b/, "cards", true);
  }
  if (!hits.length) return null;
  const last = hits.sort((a, b) => a.at - b.at)[hits.length - 1];
  return { rep: last.rep, list: last.list };
}

/** Longest task title mentioned in the sentence (case-insensitive). */
function findNamedTask(s: string, doc: Doc): Task | null {
  let best: Task | null = null;
  for (const t of Object.values(doc.tasks)) {
    const title = t.title.toLowerCase().trim();
    if (title.length < 3) continue;
    const re = new RegExp(`\\b${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (re.test(s) && (!best || title.length > best.title.length)) best = t;
  }
  return best;
}

function parseAmount(s: string): number | null {
  const m = s.match(/(?:€|eur|\$|usd|£)?\s?(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s?(k)?\b/);
  if (!m) return null;
  let raw = m[1];
  // "2,400" / "2.400" → thousands separators; "2.5" → decimal
  if (/^\d{1,3}([.,]\d{3})+$/.test(raw)) raw = raw.replace(/[.,]/g, "");
  else raw = raw.replace(",", ".");
  const n = parseFloat(raw) * (m[2] ? 1000 : 1);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function capitalise(t: string) {
  const v = t.trim();
  return v.charAt(0).toUpperCase() + v.slice(1);
}

function clarify(message: string, target: string | null = null): Interpretation {
  return { ops: [], tone: "clarify", message, target };
}
function unsupported(message: string): Interpretation {
  return { ops: [], tone: "unsupported", message, target: null };
}
function control(c: "undo" | "redo" | "reset", message: string): Interpretation {
  return { ops: [], tone: "done", message, control: c, target: null };
}
