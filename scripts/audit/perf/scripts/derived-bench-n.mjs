// Micro-benchmark of derived computations on the 60-task doc (Node/V8 on the audit Mac; order of magnitude only)
// Usage: node scripts/audit/perf/scripts/derived-bench-n.mjs [root] [doc.json]. The root defaults to this checkout; pass another checkout (a git worktree) to compare commits.
import { resolve } from "node:path";
import { createJiti } from "jiti";
import { LIB } from "../../paths.mjs";
// The v0 lib: the frozen copies by default (step 18 deleted the originals), or another checkout's src/lib
const LIBDIR = process.argv[2] ? resolve(process.argv[2]) + "/src/lib/" : LIB;
const jiti = createJiti(import.meta.url);
const fs = await import("node:fs");
const sel = await jiti.import(LIBDIR + "selectors.ts");
const focus = await jiti.import(LIBDIR + "focus.ts");
const team = await jiti.import(LIBDIR + "team.ts");
const brief = await jiti.import(LIBDIR + "brief.ts");
const schema = await jiti.import(LIBDIR + "schema.ts");
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
