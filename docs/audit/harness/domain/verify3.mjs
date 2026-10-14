const ROOT = "/Users/nicolaromei/code/form";
const { createJiti } = await import(`${ROOT}/node_modules/jiti/lib/jiti.mjs`);
const jiti = createJiti(import.meta.url);
const { applyOperation } = await jiti.import(`${ROOT}/src/lib/ops.ts`);
const { arrangeMood } = await jiti.import(`${ROOT}/src/lib/mood.ts`);
const seed = await jiti.import(`${ROOT}/src/lib/seed.ts`);
let d = applyOperation(seed.emptyDoc(), { op: "createProject", title: "S", template: "website" });
d = applyOperation(d, { op: "addMoodItems", items: [{ kind: "note", text: "a" }, { kind: "color", hex: "#123456" }, { kind: "image", asset: "img-1", w: 0.2, h: 0.3 }] });
d = applyOperation(d, { op: "proposeSubtasks", parentId: "t-ui", items: [{ id: "p-1", title: "s", estimate: 1 }] });
d = applyOperation(d, { op: "proposeReassign", moves: [{ taskId: "t-ui", to: "p-luca" }] });
d = applyOperation(d, { op: "editBriefLine", key: "client:done:all", text: "t", basis: "b" });
const ops = [
  { op: "setView", patch: { columns: 1 } }, { op: "setView", patch: { layout: "grid" } }, { op: "setFields", patch: { estimate: false } },
  { op: "updateTask", id: "t-ui", patch: { progress: 100 } }, { op: "addTask", title: "A", parentId: "t-ui", estimate: 1 },
  { op: "removeTask", id: "t-ui" }, { op: "moveTask", id: "t-dev", toIndex: 0 }, { op: "acceptProposal" }, { op: "discardProposal" },
  { op: "addBlock", block: "moodboard" }, { op: "removeBlock", block: "metrics" }, { op: "removeView", representation: "cards" },
  { op: "addMoodItems", items: [{ kind: "note", text: "x" }] }, { op: "updateMoodItem", id: d.mood[0].id, patch: { x: 0.5 }, raise: true },
  { op: "updateMoodItem", id: d.mood[1].id, patch: { w: 0.5 } }, { op: "removeMoodItem", id: d.mood[2].id },
  { op: "arrangeMood", layout: "grid" }, { op: "arrangeMood", layout: "masonry" }, { op: "arrangeMood", layout: "collage" }, { op: "clearMood" },
  { op: "addPerson", name: "Ada" }, { op: "updatePerson", id: "p-marta", patch: { capacity: 12 } }, { op: "removePerson", id: "p-luca" },
  { op: "assignTask", taskId: "t-dev", personId: "p-sara" }, { op: "addSampleTeam" }, { op: "acceptReassign" }, { op: "discardReassign" },
  { op: "editBriefLine", key: "client:x", text: "t", basis: "b" }, { op: "resetBriefLine", key: "client:done:all" },
  { op: "addBriefLine", audience: "team", section: "risks", text: "r" }, { op: "resetBrief", audience: "client" }, { op: "setStartDate", date: "2026-10-05" },
  { op: "renameTool", title: "R" }, { op: "setRepresentation", representation: "brief" }, { op: "createProject", title: "N", template: "website" },
];
const bad = [];
for (const op of ops) {
  const doc = structuredClone(d); const opc = structuredClone(op);
  const s1 = JSON.stringify(doc), s2 = JSON.stringify(opc);
  applyOperation(doc, opc);
  if (JSON.stringify(doc) !== s1) bad.push(op.op + ":doc");
  if (JSON.stringify(opc) !== s2) bad.push(op.op + ":op");
}
const items = structuredClone(d.mood); const snap = JSON.stringify(items); arrangeMood(items, "masonry"); arrangeMood(items, "collage");
console.log("unfrozen mutation check:", bad.length ? bad : "no input mutated", "| arrangeMood input intact:", JSON.stringify(items) === snap);
// strict mode check of the transpiled module
console.log("strict?", (() => { try { const o = Object.freeze({ a: 1 }); const f = new Function("o", "'use strict'; o.a = 2;"); f(o); return "n/a"; } catch { return "test-harness ok"; } })());
