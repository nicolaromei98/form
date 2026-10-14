// The v0 demo project (website template, 4 tasks, sample team) with all six views, landing on the tracker
// Usage: node scripts/audit/perf/scripts/gen-demo.mjs [root] [out]. The root defaults to this checkout; pass another checkout (a git worktree) to compare commits.
import { resolve } from "node:path";
import { createJiti } from "jiti";
import { ROOT as REPO, outDir } from "../../paths.mjs";
const ROOT = process.argv[2] ? resolve(process.argv[2]) + "/" : REPO;
const OUT = process.argv[3] || outDir("perf") + "docDemo.json";
const jiti = createJiti(import.meta.url);
const ops = await jiti.import(ROOT + "src/lib/ops.ts");
const schema = await jiti.import(ROOT + "src/lib/schema.ts");
const seed = await jiti.import(ROOT + "src/lib/seed.ts");
const fs = await import("node:fs");
let doc = ops.applyOperations(seed.emptyDoc(), [{ op: "createProject", title: "New website", template: "website", representation: "cards" }]);
for (const r of ["board", "timeline", "team", "focus", "brief", "cards"]) doc = ops.applyOperations(doc, [{ op: "setRepresentation", representation: r }]);
const res = schema.DocSchema.safeParse(doc);
console.log("tasks", Object.keys(doc.tasks).length, "views", doc.tool.views.join(","), "DocSchema", res.success ? "PASS" : "FAIL");
fs.writeFileSync(OUT, JSON.stringify({ state: { doc, log: [] }, version: 1 }));
