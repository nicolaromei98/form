// Timing helpers for the perf suite (plan §10.7). Budgets are written for the development Mac;
// PERF_SCALE stretches them on slower machines (CI runs with PERF_SCALE=3).

export const PERF_SCALE = Number(process.env.PERF_SCALE ?? 1);

/** A budget in milliseconds, scaled for the machine running the suite. */
export const budget = (ms: number): number => ms * PERF_SCALE;

export interface Timing {
  /** Milliseconds per call. */
  median: number;
  p95: number;
  min: number;
}

/** Calls `fn` `warmup` times untimed, then `runs` times timed, and summarises the timed calls. */
export function time(fn: () => unknown, { warmup = 5, runs = 25 }: { warmup?: number; runs?: number } = {}): Timing {
  for (let i = 0; i < warmup; i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const at = (q: number) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))];
  return { median: at(0.5), p95: at(0.95), min: samples[0] };
}
