// The v0 demo project (website template, 4 tasks, sample team) with all six views, landing on the tracker
const ROOT = process.argv[2], OUT = process.argv[3];
const { createJiti } = await import(ROOT + "/node_modules/jiti/lib/jiti.mjs");
const jiti = createJiti(import.meta.url);
const ops = await jiti.import(ROOT + "/src/lib/ops.ts");
const schema = await jiti.import(ROOT + "/src/lib/schema.ts");
const seed = await jiti.import(ROOT + "/src/lib/seed.ts");
const fs = await import("node:fs");
let doc = ops.applyOperations(seed.emptyDoc(), [{ op: "createProject", title: "New website", template: "website", representation: "cards" }]);
for (const r of ["board", "timeline", "team", "focus", "brief", "cards"]) doc = ops.applyOperations(doc, [{ op: "setRepresentation", representation: r }]);
const res = schema.DocSchema.safeParse(doc);
console.log("tasks", Object.keys(doc.tasks).length, "views", doc.tool.views.join(","), "DocSchema", res.success ? "PASS" : "FAIL");
fs.writeFileSync(OUT, JSON.stringify({ state: { doc, log: [] }, version: 1 }));
