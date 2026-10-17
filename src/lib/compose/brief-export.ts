import type { ProjectDoc } from "@/lib/domain/schema/project";
import type { WorkspaceDoc } from "@/lib/domain/schema/workspace";
import type { Brief, BriefLine, Sentence } from "@/lib/compose/brief";

/**
 * The brief as text (plan §2, ported from v0 `lib/brief.ts`): a sentence's plain wording, a
 * line's current wording, and the whole brief for Mail (plain text) or for editors that paste
 * HTML as formatting (Mail, Gmail, Notion, Slack).
 *
 * Mentions resolve at read time: a task to its title in the project, a person to their name in
 * the workspace (Q7). A mention of something that no longer exists reads as "", as in v0.
 */

/** What reading a sentence needs: the project's tasks and the workspace's people */
export type BriefNamesProject = Pick<ProjectDoc, "tasks">;
export type BriefNamesWorkspace = Pick<WorkspaceDoc, "people">;

/** A sentence as plain text */
export function plainText(sentence: Sentence, project: BriefNamesProject, ws: BriefNamesWorkspace): string {
  let out = "";
  for (const run of sentence) {
    if (typeof run === "string") out += run;
    else if ("task" in run) out += Object.hasOwn(project.tasks, run.task) ? project.tasks[run.task].title : "";
    else out += Object.hasOwn(ws.people, run.person) ? ws.people[run.person].name : "";
  }
  return out;
}

/** What a line says now: the user's wording, or FORM's */
export function lineText(line: BriefLine, project: BriefNamesProject, ws: BriefNamesWorkspace): string {
  if (line.edited !== null) return line.edited;
  return line.kind === "custom" ? String(line.runs[0] ?? "") : plainText(line.runs, project, ws);
}

/** Plain text for anywhere: labels as capitals, no markup to leak into Mail */
export function briefPlainText(brief: Brief, project: BriefNamesProject & Pick<ProjectDoc, "title">, ws: BriefNamesWorkspace): string {
  const lines = [`${project.title} · ${brief.eyebrow.join(" · ")}`, "", brief.headline.map((l) => lineText(l, project, ws)).join(" ")];
  for (const s of brief.sections) if (s.lines.length) lines.push("", s.label.toUpperCase(), ...s.lines.map((l) => `– ${lineText(l, project, ws)}`));
  lines.push("", "Composed by FORM from the project data.");
  return lines.join("\n");
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Rich text for Mail, Gmail, Notion and Slack, which paste HTML as formatting */
export function briefHtml(brief: Brief, project: BriefNamesProject & Pick<ProjectDoc, "title">, ws: BriefNamesWorkspace): string {
  const parts = [
    `<p><strong>${esc(project.title)}</strong> · ${esc(brief.eyebrow.join(" · "))}</p>`,
    `<p><strong>${esc(brief.headline.map((l) => lineText(l, project, ws)).join(" "))}</strong></p>`,
  ];
  for (const s of brief.sections) {
    if (s.lines.length) parts.push(`<p><strong>${esc(s.label)}</strong></p><ul>${s.lines.map((l) => `<li>${esc(lineText(l, project, ws))}</li>`).join("")}</ul>`);
  }
  parts.push(`<p><em>Composed by FORM from the project data.</em></p>`);
  return parts.join("");
}
