#!/usr/bin/env node
// Turns an a11y.spec.ts run of baseline A into e2e/baselines/a11y-A.json: for every state, the axe
// rules A already breaks apart from colour contrast (which Q14 fixes). a11y.spec.ts then fails a
// later build only on a rule that A doesn't break in the same state (plan §10.8).
//
//   node scripts/e2e/compare.mjs --base phase1-baseline-a --head <ref> -- a11y.spec.ts
//   node scripts/e2e/a11y-baseline.mjs <run>/base/artifacts <commit>
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const [artifacts, commit] = process.argv.slice(2);
if (!artifacts || !commit) {
  console.error("Usage: node scripts/e2e/a11y-baseline.mjs <artifacts dir of a run of A> <A's commit>");
  process.exit(1);
}
const dir = join(resolve(artifacts), "a11y");
if (!existsSync(dir)) throw new Error(`No a11y results in ${dir}`);

const results = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
if (results.some((r) => r.q14)) throw new Error("These results come from a build with the Q14 tokens: the baseline is A's");

const rules = (r) => [...new Set([...Object.keys(r.rendered.violations), ...Object.keys(r.flatGround.violations)])].filter((id) => id !== "color-contrast").sort();
const contrast = (pass) => pass.violations["color-contrast"]?.nodes.length ?? 0;

const baseline = {
  label: "A",
  commit,
  note: "Axe rules baseline A breaks in each state, colour contrast aside (Q14 fixes it). a11y.spec.ts fails a later build on any other rule. Regenerate with the commands in scripts/e2e/a11y-baseline.mjs.",
  source: relative(REPO, dir),
  states: Object.fromEntries(results.map((r) => [r.state, rules(r)])),
  colorContrastNodes: Object.fromEntries(results.map((r) => [r.state, { rendered: contrast(r.rendered), flatGround: contrast(r.flatGround) }])),
};
const file = join(REPO, "e2e/baselines/a11y-A.json");
writeFileSync(file, JSON.stringify(baseline, null, 2) + "\n");
console.log(`${results.length} states → ${relative(REPO, file)}`);
