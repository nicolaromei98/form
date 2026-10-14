// Micro-benchmark of derived computations on the 60-task doc (Node/V8 on the audit Mac; order of magnitude only)
// Usage: node scripts/audit/perf/scripts/derived-bench-n.mjs [root] [doc.json]. The root defaults to this checkout; pass another checkout (a git worktree) to compare commits.
import { resolve } from "node:path";
import { createJiti } from "jiti";
import { ROOT as REPO } from "../../paths.mjs";
const ROOT = process.argv[2] ? resolve(process.argv[2]) + "/" : REPO;
const jiti = createJiti(import.meta.url);
const fs = await import("node:fs");
const sel = await jiti.import(ROOT + "src/lib/selectors.ts");
const focus = await jiti.import(ROOT + "src/lib/focus.ts");
const team = await jiti.import(ROOT + "src/lib/team.ts");
const brief = await jiti.import(ROOT + "src/lib/brief.ts");
const schema = await jiti.import(ROOT + "src/lib/schema.ts");
const doc = JSON.parse(fs.readFileSync(process.argv[3] || new URL("../fixtures/doc60.json", import.meta.url), "utf8")).state.doc;
const bench = (name, fn, n = Number(process.env.N || 300)) => { for (let i = 0; i < 3; i++) fn(); const t = performance.now(); for (let i = 0; i < n; i++) fn(); console.log(name.padEnd(34), ((performance.now() - t) / n).toFixed(3), "ms/call"); };
bench("DocSchema.safeParse (hydrate)", () => schema.DocSchema.safeParse(doc));
bench("schedule", () => sel.schedule(doc));
bench("metrics", () => sel.metrics(doc));
bench("visibleTasks", () => sel.visibleTasks(doc));
bench("focusPick", () => focus.focusPick(doc));
bench("loadsOf", () => team.loadsOf(doc));
bench("balancePlan", () => team.balancePlan(doc));
bench("composeBrief(client,full)", () => brief.composeBrief(doc, "client", false));
bench("composeBrief(team,full)", () => brief.composeBrief(doc, "team", false));
