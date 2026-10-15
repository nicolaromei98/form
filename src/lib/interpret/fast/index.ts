import { briefEdit, briefRequest } from "@/lib/interpret/fast/brief";
import { type Confidence, confidenceOf } from "@/lib/interpret/fast/confidence";
import { clarify, Collector, type FamilyResult, type FastContext, unsupported } from "@/lib/interpret/fast/context";
import { planFollowUp, proposalFollowUp, reset, undoRedo } from "@/lib/interpret/fast/control";
import { create, noProject } from "@/lib/interpret/fast/create";
import { workspaceRules } from "@/lib/interpret/fast/layout";
import { findNamed, normalise, type Target } from "@/lib/interpret/fast/match";
import { moodboard } from "@/lib/interpret/fast/mood";
import { breakdown, entityEdits, notUnderstood, PLURAL } from "@/lib/interpret/fast/task";
import { team } from "@/lib/interpret/fast/team";
import { exitFocus, focus, removeView } from "@/lib/interpret/fast/view";
import type { Op } from "@/lib/ops/build";
import type { Command as RunnerCommand } from "@/lib/ops/command";
import type { LocalIntent } from "@/lib/ops/local-intents";
import type { NoticeKey } from "@/lib/ops/notices";
import type { QueryNote } from "@/lib/ops/queries";

/**
 * The fast parser (plan §8.4): v0's deterministic demo parser, split by family, emitting registry
 * ops built through `ops/build` (every id minted with `ctx.mint`) and local intents. It never
 * writes a change caption: the runner composes one from what applied. Clarify and unsupported
 * replies keep v0's wording.
 *
 * Precedence, as in v0:
 *  1. control (undo, redo);       2. view removal;         3. brief edits;
 *  4. reset;                      5. unsupported families; 6. status brief;
 *  7. create;                     8. no project;           9. plan follow-ups;
 * 10. moodboard;                 11. team;                12. proposal follow-ups;
 * 13. entity (task edits);       14. workspace (views, layout, blocks, a new task).
 *
 * The result is the §9.2 contract: matched with a confidence (Q17), control, or none.
 */

export type FastResult =
  | {
      status: "matched";
      confidence: Confidence;
      ops: Op[];
      local: LocalIntent[];
      notes: QueryNote[];
      notices: NoticeKey[];
      reply?: { tone: "clarify"; text: string };
    }
  | { status: "matched"; confidence: 1; control: "undo" | "redo" | "reset" }
  | { status: "none"; reply: { tone: "unsupported"; text: string } };

export type { Breakdown, BreakdownStep, DemoExpansions, FastContext } from "@/lib/interpret/fast/context";
export { DEMO_THRESHOLD, paletteKey, type Confidence } from "@/lib/interpret/fast/confidence";
export { replacesProject } from "@/lib/interpret/fast/match";

function finish(r: FamilyResult, s: string, ctx: FastContext): FastResult {
  switch (r.kind) {
    case "control":
      return { status: "matched", confidence: 1, control: r.control };
    case "unsupported":
      return { status: "none", reply: { tone: "unsupported", text: r.text } };
    case "clarify":
      return { status: "matched", confidence: confidenceOf(s, ctx.palette, r.tier), ops: [], local: [], notes: [], notices: [], reply: { tone: "clarify", text: r.text } };
    case "intent": {
      const { ops, local, notes, notices, reply } = r.intent;
      return { status: "matched", confidence: confidenceOf(s, ctx.palette, r.tier), ops, local, notes, notices, ...(reply ? { reply } : {}) };
    }
  }
}

/** The family answer for a command, in v0's precedence */
function interpret(raw: string, ctx: FastContext): { result: FamilyResult; s: string } {
  const cmd = normalise(raw);
  const { s } = cmd;
  const { project } = ctx;
  const done = (result: FamilyResult) => ({ result, s });

  if (!s) return done(clarify("Describe what you want to build or change."));

  /* ---------- 1–4. control, view removal, brief edits, reset ---------- */
  const early = undoRedo(s) ?? removeView(s, project) ?? briefEdit(cmd, project, ctx.local, ctx.mint) ?? reset(s);
  if (early) return done(early);

  /* ---------- 5. tool families not in this build ---------- */
  if (/\b(compar\w*|versus|vs|pros and cons|trade-?offs?)\b/.test(s)) {
    return done(unsupported("Comparison tools aren't in this build yet — the project tracker is the live tool family."));
  }
  if (/\b(budget|expenses?|spending)\b/.test(s) && !(ctx.selectedTaskId && /\d/.test(s))) {
    return done(unsupported("Budget overviews aren't in this build yet. You can give a selected task a cost — e.g. 'set the cost to €2,400'."));
  }

  /* ---------- 6–8. status brief, create, no project ---------- */
  const made = briefRequest(s, project, ctx.local) ?? create(cmd, ctx);
  if (made) return done(made);
  if (!project) return done(noProject());

  /* ---------- 9–12. plan follow-ups, moodboard, team, proposal follow-ups ---------- */
  const answered = planFollowUp(s, project) ?? moodboard(cmd, project, ctx.mint) ?? team(cmd, ctx, project) ?? proposalFollowUp(s, project);
  if (answered) return done(answered);

  /* ---------- 13. entity level (Point & Ask or a named task) ---------- */
  const plural = PLURAL.test(s);
  const named = findNamed(s, project);
  const selected = ctx.selectedTaskId !== null && Object.hasOwn(project.tasks, ctx.selectedTaskId) ? project.tasks[ctx.selectedTaskId] : null;
  const target: Target | null = named ?? (selected && !plural ? { kind: "task", task: selected } : null);
  const c = new Collector(project);

  const proposed = breakdown(s, ctx, project, target, c);
  if (proposed) return done(proposed);

  let entityHandled = false;
  if (target) {
    const outcome = entityEdits(cmd, ctx, target, named !== null, c);
    if (outcome.early) return done(outcome.early);
    entityHandled = outcome.handled;
  }

  /* ---------- 14. workspace level ---------- */
  // Focus and "show me everything again" return early, as in v0
  const focused = focus(s, project, named?.kind === "task" ? named.task : null) ?? exitFocus(s, project);
  if (focused) return done(focused);
  const sortClarify = workspaceRules(cmd, ctx, project, target, entityHandled, c);
  if (sortClarify) return done(sortClarify);

  if (c.empty) return done(unsupported(notUnderstood(target, s)));
  return done(c.result("keyword"));
}

/** Reads one command against the current state. Synchronous, pure and deterministic given `ctx.mint`. */
export function fastParse(text: string, ctx: FastContext): FastResult {
  const { result, s } = interpret(text, ctx);
  return finish(result, s, ctx);
}

/**
 * The runner's command for a matched result with something to do (plan §5.7); null for control,
 * for "none" and for a bare clarify, whose reply the caller shows as it is.
 */
export function toCommand(result: FastResult, text: string): RunnerCommand | null {
  if (result.status !== "matched" || "control" in result) return null;
  if (result.ops.length === 0 && result.local.length === 0 && result.notes.length === 0 && result.notices.length === 0) return null;
  return {
    ops: result.ops,
    local: result.local,
    notes: result.notes,
    notices: result.notices,
    ...(result.reply ? { reply: result.reply } : {}),
    source: "direct",
    text,
  };
}
