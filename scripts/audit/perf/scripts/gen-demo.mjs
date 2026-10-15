// The v0 demo project (website template, 4 tasks, sample team) with all six views, landing on the tracker
// Usage: node scripts/audit/perf/scripts/gen-demo.mjs [root] [out]. The root defaults to this checkout; pass another checkout (a git worktree) to compare commits.
import { resolve } from "node:path";
import { createJiti } from "jiti";
import { LIB, outDir } from "../../paths.mjs";
// The v0 lib: the frozen copies by default (step 18 deleted the originals), or another checkout's src/lib
const LIBDIR = process.argv[2] ? resolve(process.argv[2]) + "/src/lib/" : LIB;
const OUT = process.argv[3] || outDir("perf") + "docDemo.json";
const jiti = createJiti(import.meta.url);
const ops = await jiti.import(LIBDIR + "ops.ts");
const schema = await jiti.import(LIBDIR + "schema.ts");
const seed = await jiti.import(LIBDIR + "seed.ts");
const fs = await import("node:fs");
let doc = ops.applyOperations(seed.emptyDoc(), [{ op: "createProject", title: "New website", template: "website", representation: "cards" }]);
for (const r of ["board", "timeline", "team", "focus", "brief", "cards"]) doc = ops.applyOperations(doc, [{ op: "setRepresentation", representation: r }]);
const res = schema.DocSchema.safeParse(doc);
console.log("tasks", Object.keys(doc.tasks).length, "views", doc.tool.views.join(","), "DocSchema", res.success ? "PASS" : "FAIL");
fs.writeFileSync(OUT, JSON.stringify({ state: { doc, log: [] }, version: 1 }));
