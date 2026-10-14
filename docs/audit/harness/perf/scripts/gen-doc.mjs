// Generate a valid persisted FORM workspace with 60 top-level tasks, using the app's own reducer
const ROOT = process.argv[2];
const OUT = process.argv[3];
const { createJiti } = await import(ROOT + "/node_modules/jiti/lib/jiti.mjs");
const jiti = createJiti(import.meta.url);
const ops = await jiti.import(ROOT + "/src/lib/ops.ts");
const schema = await jiti.import(ROOT + "/src/lib/schema.ts");
const seed = await jiti.import(ROOT + "/src/lib/seed.ts");
const fs = await import("node:fs");

let doc = seed.emptyDoc();
doc = ops.applyOperations(doc, [{ op: "createProject", title: "Stress project", template: "website", representation: "cards" }]);
const PRI = ["low", "medium", "high", "urgent"];
const ST = ["todo", "active", "review", "done"];
const people = ["p-marta", "p-sara", "p-luca"];
// 56 more top-level tasks -> 60
for (let i = 5; i <= 60; i++) {
  doc = ops.applyOperations(doc, [{ op: "addTask", title: `Task ${String(i).padStart(2, "0")} · ${["Wireframes", "Copy review", "Asset export", "QA pass", "Client call prep", "Motion study"][i % 6]}`, parentId: null, estimate: [1, 2, 3, 4, 5, 8][i % 6], priority: PRI[i % 4] }]);
}
// Vary status/progress/owner deterministically so every lane, bar and row has content
doc.order.forEach((id, i) => {
  if (i < 4) return;
  const status = ST[i % 4];
  const progress = status === "done" ? 100 : status === "todo" ? 0 : (i * 7) % 95 + 1;
  doc = ops.applyOperations(doc, [
    { op: "updateTask", id, patch: { status, progress } },
    { op: "assignTask", taskId: id, personId: people[i % 3] },
  ]);
});
// All six views exist; land on the tracker
for (const r of ["board", "timeline", "team", "focus", "brief", "cards"]) doc = ops.applyOperations(doc, [{ op: "setRepresentation", representation: r }]);
const top = doc.order.filter((id) => !doc.tasks[id].parentId).length;
const res = schema.DocSchema.safeParse(doc);
console.log("top-level tasks:", top, "total tasks:", Object.keys(doc.tasks).length, "views:", doc.tool.views.join(","), "DocSchema:", res.success ? "PASS" : JSON.stringify(res.error.issues.slice(0, 3)));
if (!res.success) process.exit(1);
fs.writeFileSync(OUT, JSON.stringify({ state: { doc, log: [] }, version: 1 }));
console.log("bytes:", fs.statSync(OUT).size);
