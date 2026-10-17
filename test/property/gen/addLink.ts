// Property generator for addLink: on the project or a task (or a missing one), with a fresh id or
// now and then one already taken, a label that may be invalid, and sometimes a URL the schema
// refuses (javascript:). Repeated adds reach the 20-link limit.
import { activeProject, type OpGen, pick, pickTask, titleFrom } from "./_pick";

const URLS = ["https://www.figma.com/file/form", "http://example.com/brief", "https://drive.example.com/folder?id=7"];

const gen: OpGen = (s, state, mint) => {
  const project = activeProject(state);
  const taken = project ? [...project.links, ...Object.values(project.tasks).flatMap((t) => t.links)].map((l) => l.id).sort() : [];
  const target = s.flags[0] ? { kind: "project" } : { kind: "task", taskId: pickTask(s, state, mint, 0) };
  const id = taken.length > 0 && s.picks[1] % 25 === 0 ? pick(taken, s.picks[2]) : mint("link");
  const url = s.picks[2] % 15 === 0 ? "javascript:alert(1)" : pick(URLS, s.picks[3]);
  return { op: "addLink", target, link: { id, label: titleFrom(s, 60), url } };
};

export default gen;
