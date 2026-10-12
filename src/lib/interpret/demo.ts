import { breakdownFor } from "./library";
import { schedule } from "../selectors";
import { focusPick } from "../focus";
import {
  REPRESENTATION_LABEL,
  SORT_LABEL,
  STATUS_LABEL,
  type Doc,
  type Interpretation,
  type Operation,
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
  const clean = raw.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
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

  if ((!doc.tool && ((createVerb && createNoun) || organise)) || (doc.tool && explicitCreate)) {
    const isWeb = /\b(web ?site|site|landing page|web)\b/.test(s);
    const subject = clean.match(/\bfor (?:my|our|the|a|an)?\s*(?:new\s+)?(.+)$/i)?.[1];
    const title = isWeb || !subject ? "New website" : capitalise(subject).slice(0, 60);
    const ops: Operation[] = [{ op: "createProject", title, template: "website" }];
    const rep = representationIn(s, true)?.rep;
    if (rep && rep !== "cards") ops.push({ op: "setRepresentation", representation: rep });
    const note = isWeb || !subject ? "" : " · Demo mode ships one template (website) — rename anything";
    return { ops, tone: "done", message: `Project tracker created · 4 tasks${note}`, target: null };
  }

  if (!doc.tool) {
    return clarify("Nothing to shape yet. Start with: 'Create a project tracker for my new website'.");
  }

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
