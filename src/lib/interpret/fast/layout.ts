import { TASK_TITLE } from "@/lib/domain/limits";
import type { LocalViewState } from "@/lib/domain/schema/local";
import type { SortKey } from "@/lib/domain/schema/primitives";
import type { ProjectDoc } from "@/lib/domain/schema/project";
import { clarify, type Collector, type FamilyResult, type FastContext } from "@/lib/interpret/fast/context";
import { type Command, lineOf, type Target } from "@/lib/interpret/fast/match";
import { showHome, viewIn } from "@/lib/interpret/fast/view";
import { addTaskOp, makeOp, setViewOp } from "@/lib/ops/build";
import { sortedByOrder } from "@/lib/domain/order";

/**
 * The workspace-level rules (plan §8.4 step 14), ported from v0: they accumulate after the task
 * edits. The view a sentence names, density, columns and the grid, sort, completed tasks, the
 * urgent highlight, field visibility, the metrics and progress blocks, a new top-level task, and
 * v0's quiet-view fix-up. Field visibility is setView `fields` (v0 setFields).
 */

const NUMBER: Readonly<Record<string, number>> = { one: 1, single: 1, two: 2, three: 3, four: 4 };

/** Shows the tracker when the layout options need it and the sentence named no view (v0) */
function toCards(c: Collector, local: LocalViewState, named: boolean): void {
  if (local.activeView !== "cards" && !named) c.show("cards");
}

/** Runs the workspace rules; an answer when one returns early (the sort clarify) */
export function workspaceRules(
  cmd: Command,
  ctx: FastContext,
  project: ProjectDoc,
  target: Target | null,
  entityHandled: boolean,
  c: Collector,
): FamilyResult | null {
  const { clean, s } = cmd;
  const { local } = ctx;
  const vc = project.viewConfig;
  const plural = /\b(ones|tasks|cards|items|all|everything|them|these|those|rows|bars)\b/.test(s);

  // The view a sentence names: added when the project doesn't have it, then shown
  const rep = viewIn(s, false);
  if (rep) {
    // "As a list" is about the layout: the tracker opens only when it isn't on screen (v0 said "List")
    if (rep.list) c.reveal(rep.view, local.activeView).op(setViewOp({ layout: "list" }));
    else c.show(rep.view);
  }

  // Density (skip when the words were about a single emphasised entity)
  if (!entityHandled || plural) {
    if (/\b(less compact|bigger|larger|roomier|spacious|comfortable|more detail(ed)?|expand(ed)?|more space|airier|normal size)\b/.test(s)) {
      c.op(setViewOp({ density: "comfortable" }));
    } else if (/\b(compact|compress|smaller|tighter|condensed?|denser|dense|slimmer|less space|shrink)\b/.test(s)) {
      c.op(setViewOp({ density: "compact" }));
    }
  }

  // Columns / layout
  const cols = s.match(/\b(one|two|three|four|single|1|2|3|4)\s+columns?\b/);
  if (cols) {
    c.op(setViewOp({ columns: NUMBER[cols[1]] ?? parseInt(cols[1], 10) }));
    toCards(c, local, rep !== null);
  } else if (/\bgrid\b/.test(s)) {
    c.op(setViewOp({ layout: "grid" }));
    toCards(c, local, rep !== null);
  }

  // Sort
  if (/\b(sort|order|rank|arrange|reorder|prioriti[sz]e)\b/.test(s) || /\b(most|least) (urgent|important|done|complete)\b.*\bfirst\b/.test(s)) {
    let key: SortKey | null = null;
    if (/\b(manual|original|default|workflow) order\b|\bunsort/.test(s)) key = "manual";
    else if (/\bby (priority|importance|urgency)\b|\b(urgent|important)\w* first\b|\bprioriti[sz]e\b/.test(s)) key = "priority";
    else if (/\bby (progress|completion)\b|\b(done|complete)\w* first\b/.test(s)) key = "progress";
    else if (/\bby status\b/.test(s)) key = "status";
    else if (/\bby (name|title)\b|\balphabetical\w*\b/.test(s)) key = "title";
    else if (/\bby (duration|length|estimate|effort|size)\b|\blongest first\b/.test(s)) key = "estimate";
    if (key) c.op(setViewOp({ sort: key }));
    else if (c.ops.length === 0 && c.local.length === 0) return clarify("Sort by what? Priority, progress, status, name or duration.");
  }

  // Completed tasks
  if (/\b(hide|remove|filter out|without|exclude|don't show)\b.*\b(completed|done|finished|closed)\b/.test(s)) {
    c.op(setViewOp({ hideDone: true }));
  } else if (/\b(show|reveal|bring back|include|unhide)\b.*\b(completed|done|finished|all tasks|everything)\b/.test(s) && vc.hideDone) {
    c.op(setViewOp({ hideDone: false }));
  }

  // Urgent highlight
  if (/\b(remove|clear|stop|turn off|no)\b.*\bhighlight/.test(s)) {
    c.op(setViewOp({ highlightUrgent: false }));
  } else if (/\b(highlight|emphasi[sz]e|flag|call out|spotlight|surface|mark)\b.*\b(urgent|critical|important|high[- ]priority)\b/.test(s) && (!entityHandled || plural)) {
    c.op(setViewOp({ highlightUrgent: true }));
  }

  // Fields (v0 setFields)
  const hideVerb = /\b(hide|remove|drop|without)\b/;
  const showVerb = /\b(show|add|include|display|bring back)\b/;
  if (/\b(estimates?|durations?)\b/.test(s) && !target) {
    if (hideVerb.test(s)) c.op(setViewOp({ fields: { estimate: false } }));
    else if (showVerb.test(s)) c.op(setViewOp({ fields: { estimate: true } }));
  }
  if (/\bpriorit(y|ies)\b/.test(s) && !/\bby priority\b/.test(s) && !target && !/\bprioriti[sz]e\b/.test(s)) {
    if (hideVerb.test(s)) c.op(setViewOp({ fields: { priority: false } }));
    else if (showVerb.test(s)) c.op(setViewOp({ fields: { priority: true } }));
  }
  if (/\bprogress\b/.test(s) && !/\bby progress\b/.test(s) && !/\d\s*%/.test(s)) {
    if (hideVerb.test(s)) {
      c.op(setViewOp({ fields: { progress: false } }), makeOp({ op: "removeBlock", block: "progress" }));
    } else if (showVerb.test(s)) {
      if (!vc.fields.progress) c.op(setViewOp({ fields: { progress: true } }));
      else if (!project.blocks.includes("progress")) c.op(makeOp({ op: "addBlock", block: "progress" }));
      else c.note({ kind: "alreadyVisible", what: "progress" });
    }
  }

  // Metrics block
  if (/\b(metrics|summary|stats|overview|kpis?)\b/.test(s)) {
    if (hideVerb.test(s)) c.op(makeOp({ op: "removeBlock", block: "metrics" }));
    else if (showVerb.test(s)) c.op(makeOp({ op: "addBlock", block: "metrics" }));
  }

  // New top-level task: at the end, after the last task when the project chains new work (plan §4.5)
  const add = clean.match(/\badd (?:a |an |another )?(?:new )?task\b(?:\s+(?:called|named|for))?\s*:?\s*"?([^"]*)"?$/i);
  if (add && !/\b(sub-?task|step)\b/.test(s)) {
    const workflow = sortedByOrder(project.tasks);
    const last = workflow[workflow.length - 1];
    c.op(
      addTaskOp({
        taskId: ctx.mint("task"),
        title: lineOf(add[1] || "New task", TASK_TITLE),
        dependsOn: project.autoChain && last ? [last.id] : [],
      }),
    );
  }

  // Focus and the brief hide the metrics and progress blocks: show the tasks so an added block is visible
  const quiet = local.activeView === "focus" || local.activeView === "brief";
  const addsBlock = c.ops.some((o) => o.op === "addBlock" && (o.block === "metrics" || o.block === "progress"));
  if (quiet && addsBlock && !c.shows) showHome(c, project);
  return null;
}
