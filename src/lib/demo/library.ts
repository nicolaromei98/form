/**
 * The /demo breakdown library (plan §8.4, Q20): the steps "Break this task into smaller steps"
 * proposes for a task, chosen by its title. Only /demo uses it (the agent proposes steps in /app,
 * Phase 5); the store injects it into the fast parser's context, which never imports lib/demo.
 *
 * The entries are v0's (`lib/interpret/library.ts`), with their relative weights. What changes is
 * the arithmetic, so the proposal caption's "fits its Nd estimate" is always true:
 *
 * - the task's estimate is cut into half-day units (6d = 12 units);
 * - every step gets one unit, and the rest is shared by weight with the largest-remainder method
 *   (ties go to the earlier step), so the steps add up to the estimate exactly;
 * - with fewer units than steps, or no estimate at all, the steps carry no estimate (null), and
 *   the caption says "no estimates" instead of claiming a fit.
 *
 * v0 rounded each step on its own, so a 5-day task got four 1.5-day steps (6 days) while the
 * caption claimed they fit. Pure and deterministic: no ids here, the producer mints them.
 */

/** One proposed step, before the producer mints its id */
export interface BreakdownStep {
  readonly title: string;
  /** Half days, at least 0.5; null when the estimate can't be shared out */
  readonly estimateDays: number | null;
}

/** What the parser needs from a task to break it down */
export interface BreakdownTask {
  readonly title: string;
  readonly estimateDays: number | null;
}

interface Entry {
  readonly match: RegExp;
  /** Step titles with their relative weights */
  readonly steps: readonly (readonly [title: string, weight: number])[];
}

/** v0's library, in v0's order: the first entry whose words appear in the title wins */
export const BREAKDOWN_LIBRARY: readonly Entry[] = [
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

/** Any other task */
export const GENERIC_STEPS: readonly (readonly [title: string, weight: number])[] = [
  ["Define scope", 1],
  ["First pass", 1],
  ["Review", 1],
  ["Finalise", 1],
];

/** Remainders closer than this are a tie */
const EPS = 1e-9;

/**
 * Shares `units` among `weights`: one unit each, then the rest in proportion to the weights by
 * largest remainder (ties to the earlier index). Null when there are fewer units than weights.
 * The result always sums to `units`.
 */
export function allocateUnits(units: number, weights: readonly number[]): number[] | null {
  const n = weights.length;
  if (n === 0 || !Number.isInteger(units) || units < n) return null;
  const rest = units - n;
  const total = weights.reduce((s, w) => s + w, 0);
  // Equal weights when they can't be compared (all zero)
  const share = (i: number) => (total > 0 ? (rest * weights[i]) / total : rest / n);
  // A share a hair below a whole number (float noise) counts as that number
  const out = weights.map((_, i) => Math.floor(share(i) + EPS));
  let left = rest - out.reduce((s, u) => s + u, 0);
  const remainder = (i: number) => share(i) - out[i];
  const byRemainder = weights
    .map((_, i) => i)
    .sort((a, b) => (Math.abs(remainder(b) - remainder(a)) > EPS ? remainder(b) - remainder(a) : a - b));
  for (const i of byRemainder) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  return out.map((u) => u + 1);
}

/** The steps v0's library proposes for a task, with estimates that add up to its own */
export function breakdownFor(task: BreakdownTask): BreakdownStep[] {
  const title = task.title.toLowerCase();
  const steps = BREAKDOWN_LIBRARY.find((entry) => entry.match.test(title))?.steps ?? GENERIC_STEPS;
  // Estimates are half days, so twice the estimate is a whole number of units
  const units = task.estimateDays === null ? null : allocateUnits(Math.round(task.estimateDays * 2), steps.map(([, weight]) => weight));
  return steps.map(([stepTitle], i) => ({ title: stepTitle, estimateDays: units === null ? null : units[i] / 2 }));
}
