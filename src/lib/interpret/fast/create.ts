import { PROJECT_TITLE } from "@/lib/domain/limits";
import type { BirthView } from "@/lib/domain/schema/primitives";
import { clarify, Collector, type FamilyResult, type FastContext } from "@/lib/interpret/fast/context";
import { capitalise, type Command, replacesProject } from "@/lib/interpret/fast/match";
import { viewIn } from "@/lib/interpret/fast/view";

/**
 * Creating a project (plan §8.4 steps 7 and 8), ported from v0. /demo ships one template, the
 * website, created through the injected `createDemoProject` expansion: with a project open, only
 * an explicit new project replaces it ("create a timeline for my project" adds a view instead).
 * Without a project, anything else asks for one first.
 */

const CREATE_VERB = /\b(create|make|build|set ?up|start|generate|spin up|give me|i need|new)\b/;
const CREATE_NOUN = /\b(tracker|project|plan|planner|tasks?|to-?dos?|workspace|board|kanban|timeline)\b/;
const ORGANISE = /\b(help me )?(organi[sz]e|track|plan)\b.*\b(tasks?|work|project|website|site|launch)\b/;
// A project starts as a tracker, board or timeline; the other views need its tasks first. Ask, don't guess —
// but only when that view is the thing being created ("create a team view"), not "a project for the team"
const OTHER_VIEW =
  /\b(?:create|make|build|set ?up|give me|i need|start)\b(?: me)?(?: an?| the| my)? (team(?: view| workload)?|workload|focus(?: view)?|brief(?! summary)|status (?:update|report))\b(?! project| member)/;

export function create(cmd: Command, ctx: FastContext): FamilyResult | null {
  const { clean, s } = cmd;
  const { project } = ctx;
  const createVerb = CREATE_VERB.test(s);
  const createNoun = CREATE_NOUN.test(s);
  const organise = ORGANISE.test(s);
  const wantsMood = /\bmoodboards?\b/.test(s);
  const birth = viewIn(s, true)?.view;
  // With a project open, "create a timeline for my project" adds a view: only an explicit new project replaces it
  const recreate = replacesProject(s);
  const other = OTHER_VIEW.exec(s)?.[1];
  if ((!project || recreate) && !birth && other) {
    const label = /team|workload/.test(other) ? "Team" : other === "focus" ? "Focus" : "Brief";
    return clarify(`A project starts as a tracker, board or timeline. Try 'Create a timeline for my project', then add the ${label} view.`);
  }
  if (!((!project && ((createVerb && (createNoun || wantsMood)) || organise)) || (project && recreate))) return null;

  const isWeb = /\b(web ?site|site|landing page|web)\b/.test(s);
  const subject = clean.match(/\bfor (?:my|our|the|a|an)?\s*(?:new\s+)?(.+)$/i)?.[1];
  // "for my project" names no subject: "New project", not "Project"
  const generic = !!subject && /^(?:(?:this|that|the|my|our) )?(?:project|work|tasks?|it|me|us)$/i.test(subject);
  const title = isWeb || !subject ? "New website" : generic ? "New project" : capitalise(subject).slice(0, Math.min(60, PROJECT_TITLE)).trimEnd();
  const startAs: BirthView = birth === "board" || birth === "timeline" ? birth : "cards";

  const c = new Collector(project);
  // A moodboard lives inside a project: asking for one creates the project around it
  c.op(...ctx.demo.createProject({ workspace: ctx.ws, project }, { title, startAs, wantsMoodboard: wantsMood, replace: project !== null }, ctx.mint));
  if (!(isWeb || !subject || wantsMood)) c.notice("demoOneTemplate");
  return c.result("keyword");
}

/** No project yet: everything else needs one first (v0 wording) */
export function noProject(): FamilyResult {
  return clarify("Nothing to shape yet. Start with 'Create a timeline for my project', or a tracker or a board.");
}
