import { resolvePerson } from "@/lib/domain/invariants/check";
import { CAPACITY_MAX_DAYS, PERSON_NAME, PERSON_ROLE } from "@/lib/domain/limits";
import type { PersonId } from "@/lib/domain/schema/ids";
import type { ProjectDoc } from "@/lib/domain/schema/project";
import { clarify, Collector, type FamilyResult, type FastContext } from "@/lib/interpret/fast/context";
import { activeNamed, capitalise, type Command, findNamed, personIn, type Target, toHalfDays } from "@/lib/interpret/fast/match";
import { makeOp } from "@/lib/ops/build";
import { balance, planProject } from "@/lib/planning";

/**
 * The team (plan §8.4 step 11), ported from v0: the sample team, adding and removing people,
 * capacities, balancing, "who's overloaded?", assignments and the Team view. Team rows are the
 * project's members (plan §6.5), so "the team" a command means is the project's: adding someone
 * puts them in the workspace and in the project. Captions come from the ops and the query notes.
 *
 * Changes from v0 (plan §8.4): capacities are days per week, so "N days" in a capacity sentence
 * is N a week and above 7 asks back; people added by command get no capacity (Q3) unless the
 * command says one; "Add a sample team" is the demo expansion; balance is v2's, with owner moves
 * only in /demo.
 */

const TEAM_WORD =
  /\b(team|teammates?|people|workload|work load|capacity|overload\w*|over capacity|busiest|assign\w*|reassign\w*|unassign\w*|hand (it |this |that )?over|balance|rebalanc\w*|even out|redistribut\w*)\b/;
const WHO_DOES_WHAT = /\bwho('s| is)? doing what\b|\bwho does what\b/;
const WANTS_SHOW = [
  /\b(show|open|see|switch to|go to|view|display)\b.*\b(team|workload|work load|people|capacity)\b/,
  // Creating the view, and only the view: "add the team view" (not "add a team member called Giulia")
  /^(?:please )?(?:create|add|make|build|set ?up|open|give me)(?: me)?(?: an?| the| my)? (?:team|workload)(?: view| tab)?(?: for (?:the|my|our|this) project)?$/,
  /\bwho('s| is)? doing what\b|\bwho does what\b|\bteam (view|workload)\b/,
];

const NO_TEAM = "There's no team yet. Say 'add a sample team', or 'add Giulia and Paolo to the team'.";
export const CAPACITY_TOO_HIGH = `Capacity is days per week, up to ${CAPACITY_MAX_DAYS}.`;

/** The project's members who are active in the workspace (Q7) */
function members(project: ProjectDoc, ctx: FastContext): PersonId[] {
  return project.memberIds.filter((id) => typeof resolvePerson(id, ctx.ws) === "object");
}

/** "Add Giulia and Paolo to the team (as designers) (with 4 days)" */
function addPeople(add: RegExpMatchArray, project: ProjectDoc, ctx: FastContext): FamilyResult {
  const names = add[1]
    .split(/,|\band\b|&/i)
    .map((n) => n.trim().replace(/^(a|an|the) /i, ""))
    .filter(Boolean)
    .slice(0, 6);
  const role = (add[2].match(/\bas (?:a |an |the )?([\p{L} ]+?)(?: with\b|$)/iu)?.[1] ?? "").trim().replace(/s$/, "") || null;
  const days = Number(add[2].match(/(\d+(?:\.\d+)?)\s*(?:days?|d)\b/)?.[1]) || null;
  // Days a week (Q3): a figure past the week is no capacity at all, and FORM asks for it later
  const capacity = days !== null && days <= CAPACITY_MAX_DAYS ? toHalfDays(days) : null;

  const c = new Collector(project);
  const joining: string[] = [];
  for (const name of names) {
    const existing = activeNamed(ctx.ws, name);
    if (existing !== null && project.memberIds.includes(existing)) continue;
    joining.push(name);
    if (existing !== null) {
      c.op(makeOp({ op: "addMember", personId: existing }));
      continue;
    }
    const personId = ctx.mint("person");
    c.op(
      makeOp({
        op: "addPerson",
        personId,
        name: capitalise(name).slice(0, PERSON_NAME).trimEnd(),
        role: role ? capitalise(role).slice(0, PERSON_ROLE).trimEnd() : null,
        email: null,
        capacityDaysPerWeek: capacity,
        dayRateCents: null,
      }),
      makeOp({ op: "addMember", personId }),
    );
  }
  if (!joining.length) return clarify(names.length ? `${names.join(" and ")} ${names.length > 1 ? "are" : "is"} already on the team.` : "Who should join the team?");
  return c.reveal("team", ctx.local.activeView).result("keyword");
}

export function team(cmd: Command, ctx: FastContext, project: ProjectDoc): FamilyResult | null {
  const { clean, s } = cmd;
  const person = personIn(s, ctx.ws);
  const teamWord = TEAM_WORD.test(s) || WHO_DOES_WHAT.test(s);
  if (!teamWord && !person) return null;
  const wantsShow = WANTS_SHOW.some((re) => re.test(s));
  const c = new Collector(project);
  // The change happens on the Team view: opened when it isn't on screen
  const toTeam = () => c.reveal("team", ctx.local.activeView);

  // Sample team: the expansion speaks as one, for the Team view too (caption policy rule 3)
  if (/\b(sample|demo|example) team\b/.test(s)) {
    c.op(...ctx.demo.sampleTeam(ctx.ws, project));
    toTeam();
    return c.expands("sampleTeam").result("keyword");
  }

  // Add people: "add Giulia and Paolo to the team (as designers) (with 5 days)"
  const add = clean.match(/\badd (.+?) (?:to|into|on) (?:the |my |our )?team\b(.*)$/i);
  if (add) return addPeople(add, project, ctx);

  if (members(project, ctx).length === 0) {
    // The view itself offers the sample team, so showing it is still useful
    if (wantsShow) return c.show("team").result("keyword");
    return teamWord ? clarify(NO_TEAM) : null;
  }

  // Remove someone: their work stays, unassigned
  if (person && /\b(remove|delete|drop|take)\b/.test(s) && /\bteam\b/.test(s)) {
    toTeam();
    return c.op(makeOp({ op: "archivePerson", personId: person.id })).result("keyword");
  }

  // Capacity: "set Marta's capacity to 4 days a week", "Sara has 3 days a week"
  const cap = s.match(/(\d+(?:\.\d+)?)\s*(?:working )?(?:days?|d)\b/);
  if (person && cap && /\b(capacity|available|availability|has|have|gets?|can (do|work))\b/.test(s)) {
    const days = Number(cap[1]);
    if (days > CAPACITY_MAX_DAYS) return clarify(CAPACITY_TOO_HIGH);
    toTeam();
    return c.op(makeOp({ op: "updatePerson", personId: person.id, field: "capacityDaysPerWeek", value: toHalfDays(days) })).result("keyword");
  }

  // Balance: owner moves only in /demo (plan §6.6)
  if (/\b(balance|rebalanc\w*|even out|redistribut\w*|spread (out )?the (work|load))\b/.test(s)) {
    const plans = ctx.projects.map((p) => planProject(p, ctx.ws, ctx.today));
    if (!ctx.projects.some((p) => p.id === project.id)) plans.push(planProject(project, ctx.ws, ctx.today));
    const { moves } = balance(ctx.ws, plans, project.id, { allowShift: false });
    toTeam();
    if (!moves.length) return c.note({ kind: "nothingToBalance" }).result("keyword");
    return c
      .op(makeOp({ op: "proposeReassign", proposalId: ctx.mint("proposal"), moves: moves.map((m) => ({ ...m })), source: "parser" }))
      .result("keyword");
  }

  // Who's overloaded?
  if (/\b(overload\w*|over capacity|too busy|busiest|too much (work|on))\b/.test(s)) {
    toTeam();
    return c.note({ kind: "overloaded" }).result("keyword");
  }

  // Assign: "assign UI Design to Sara", "give this to Luca", "Sara takes Research", "unassign Development"
  const named = findNamed(s, project);
  const selected = ctx.selectedTaskId !== null && Object.hasOwn(project.tasks, ctx.selectedTaskId) ? project.tasks[ctx.selectedTaskId] : null;
  const target: Target | null = named ?? (selected && /\b(this|it|that)\b/.test(s) ? { kind: "task", task: selected } : null);
  const unassign = /\bunassign\w*\b|\b(remove|take) .*\bowner\b/.test(s);
  if (target && (unassign || (person && /\b(assign|give|hand|move|reassign|transfer|takes?|owns?|will do|is doing|to)\b/.test(s)))) {
    if (target.kind === "step") return clarify(`Steps follow their task — assign ${target.task.title} instead.`);
    toTeam();
    // Already theirs: the honest no-op says "Development is already with Sara"
    if (unassign) return c.op(makeOp({ op: "unassignTask", taskId: target.task.id })).result("keyword");
    return c.op(makeOp({ op: "assignTask", taskId: target.task.id, personId: person!.id })).result("keyword");
  }
  if (person && !target && /\b(assign|give|hand|reassign|transfer)\b/.test(s)) return clarify(`Which task should go to ${person.name}? Name it, or select it first.`);

  // Show the team
  if (wantsShow) return c.show("team").result("keyword");
  return null;
}
