import type { ProjectDoc } from "@/lib/domain/schema/project";
import { collect, control, type FamilyResult } from "@/lib/interpret/fast/context";
import { covers } from "@/lib/interpret/fast/match";
import { makeOp } from "@/lib/ops/build";

/**
 * Control and follow-ups (plan §8.4 steps 1, 4, 9 and 12): undo, redo and reset, then the yes/no
 * that resolves a pending proposal. v0 had two pending things, a subtasks proposal and a workload
 * plan, answered at two points of the precedence; v2 has one proposal, so its kind picks the
 * point: a subtasks proposal is answered where v0 answered `doc.proposal`, every other kind where
 * v0 answered `doc.plan`. The ops name the pending proposal's id.
 */

const UNDO = /^(undo|undo (that|it)|go back|revert( that)?)$/;
const REDO = /^redo( that| it)?$/;
// "Reset the brief" / "restore FORM's version" only clear the user's brief edits, never the workspace
const RESET = /\b(reset|start over|clear (the )?(workspace|everything)|wipe (it|everything))\b/;
const NOT_RESET = /\b(brief|my edits)\b|form'?s version/;

/** "undo", "redo" (anchored, before anything else) */
export function undoRedo(s: string): FamilyResult | null {
  if (UNDO.test(s)) return control("undo");
  if (REDO.test(s)) return control("redo");
  return null;
}

/** "reset", "start over": the demo's Reset, after the brief edits */
export function reset(s: string): FamilyResult | null {
  return RESET.test(s) && !NOT_RESET.test(s) ? control("reset") : null;
}

const PLAN_YES = /^(yes|ok|okay|sure|accept( (it|them|all|the plan))?|apply|do it|confirm|looks good|go ahead)\b/;
const PLAN_NO = /^(no|discard|reject|cancel|dismiss|never ?mind|keep it as it is)\b/;
const PROPOSAL_YES = /^(yes|ok|okay|sure|accept( (them|all|these|it))?|apply|keep (them|it)|looks good|add (them|these)|do it|confirm)\b/;
const PROPOSAL_NO = /^(no|discard|reject|cancel|dismiss|remove (them|these)|never ?mind)\b/;

function answer(s: string, project: ProjectDoc, yes: RegExp, no: RegExp): FamilyResult | null {
  const proposal = project.proposal;
  if (proposal === null) return null;
  const tier = (re: RegExp) => (covers(re, s) ? "anchored" : "keyword");
  if (yes.test(s)) return collect(project, (c) => c.op(makeOp({ op: "acceptProposal", proposalId: proposal.id })), tier(yes));
  if (no.test(s)) return collect(project, (c) => c.op(makeOp({ op: "discardProposal", proposalId: proposal.id })), tier(no));
  return null;
}

/** v0's workload-plan yes/no (step 9): every pending proposal but a subtasks one */
export function planFollowUp(s: string, project: ProjectDoc): FamilyResult | null {
  if (project.proposal === null || project.proposal.kind === "subtasks") return null;
  return answer(s, project, PLAN_YES, PLAN_NO);
}

/** v0's subtask-proposal yes/no (step 12) */
export function proposalFollowUp(s: string, project: ProjectDoc): FamilyResult | null {
  if (project.proposal?.kind !== "subtasks") return null;
  return answer(s, project, PROPOSAL_YES, PROPOSAL_NO);
}
