// Global fast-check settings (plan §10.1). FC_SEED replays a run; FC_RUNS scales it
// (default 500, CI 10,000, nightly 100,000). A failure stops at the first counterexample and
// prints its seed and path, which `fc.assert(…, { seed, path })` replays.
import fc from "fast-check";

const seed = process.env.FC_SEED;
if (seed !== undefined && seed !== "" && !Number.isSafeInteger(Number(seed))) {
  throw new Error(`FC_SEED must be an integer, got "${seed}"`);
}

fc.configureGlobal({
  ...(seed ? { seed: Number(seed) } : {}),
  numRuns: Number(process.env.FC_RUNS ?? 500),
  endOnFailure: true,
});
