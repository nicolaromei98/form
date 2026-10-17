import { uid } from "../seed";
import type { ProposalItem, Task } from "../schema";

/**
 * Deterministic breakdown library used by the demo parser.
 * Steps are scaled to the parent's estimate so a proposal never
 * silently changes the plan's total duration.
 */
const LIBRARY: { match: RegExp; steps: [string, number][] }[] = [
  {
    match: /\b(research|discovery|audit|interviews?)\b/,
    steps: [
      ["Stakeholder interviews", 1],
      ["Competitor audit", 1],
      ["Insights summary", 1],
    ],
  },
  {
    match: /\b(visual|brand|direction|identity|moodboard)\b/,
    steps: [
      ["Moodboards", 1],
      ["Type & colour exploration", 1.5],
      ["Direction review", 1.5],
    ],
  },
  {
    match: /\b(ui|ux|interface|screens?|wireframes?|design)\b/,
    steps: [
      ["Wireframes & flows", 1.5],
      ["Key screens", 2],
      ["Component library", 1.5],
      ["Prototype & handoff", 1],
    ],
  },
  {
    match: /\b(develop\w*|build|code|engineering|implementation|front-?end)\b/,
    steps: [
      ["Setup & CMS", 2],
      ["Build pages", 4],
      ["QA & launch", 2],
    ],
  },
];

const GENERIC: [string, number][] = [
  ["Define scope", 1],
  ["First pass", 1],
  ["Review", 1],
  ["Finalise", 1],
];

const half = (n: number) => Math.max(0.5, Math.round(n * 2) / 2);

export function breakdownFor(task: Task): ProposalItem[] {
  const entry = LIBRARY.find((l) => l.match.test(task.title.toLowerCase()));
  const steps = entry ? entry.steps : GENERIC;
  const sum = steps.reduce((s, [, d]) => s + d, 0);
  const scale = task.estimate != null ? task.estimate / sum : null;
  return steps.map(([title, d]) => ({
    id: uid("p"),
    title,
    // Without a parent estimate there is nothing to derive durations from
    estimate: scale == null ? null : half(d * scale),
  }));
}
