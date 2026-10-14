const { createJiti } = await import("/Users/nicolaromei/code/form/node_modules/jiti/lib/jiti.mjs");
const jiti = createJiti(import.meta.url, { alias: { "@": "/Users/nicolaromei/code/form/src" } });
const R = "/Users/nicolaromei/code/form/src/lib/";
const { applyOperations, applyOperation } = await jiti.import(R + "ops.ts");
const { emptyDoc } = await jiti.import(R + "seed.ts");
const sel = await jiti.import(R + "selectors.ts");
const { focusPick, reasonsFor } = await jiti.import(R + "focus.ts");
const { interpretDemo } = await jiti.import(R + "interpret/demo.ts");
const { OperationListSchema } = await jiti.import(R + "schema.ts");
let doc = applyOperation(emptyDoc(), { op: "createProject", title: "New website", template: "website" });

console.log("== Point 9 (clean case)");
let d9 = applyOperations(doc, [
  { op: "setStartDate", date: "2026-11-02" },
  { op: "updateTask", id: "t-visual", patch: { status: "done" } },
  { op: "updateTask", id: "t-dev", patch: { priority: "urgent" } },
  { op: "updateTask", id: "t-ui", patch: { priority: "low" } },
]);
const today = sel.parseISODate("2026-10-14");
const p9 = focusPick(d9, today);
for (const t of sel.topLevel(d9).filter(t=>t.status!=="done")) console.log("  ", t.title.padEnd(12), t.status, t.progress+"%", "score", reasonsFor(d9,t,today).reduce((s,r)=>s+r.weight,0));
console.log("pick:", p9.task.title, "while UI Design (earlier in workflow order, the only sequencing FORM has) is", d9.tasks["t-ui"].status, d9.tasks["t-ui"].progress + "%");

console.log("\n== Point 1: every create command yields the same 4-task website");
for (const c of ["Create a project tracker for my new website", "Create a board for my brand identity for Forno Rossi", "Help me organise my wedding", "Create a timeline for my podcast launch"]) {
  const r = interpretDemo(c, { doc: emptyDoc(), selectedId: null });
  const d = applyOperations(emptyDoc(), r.ops);
  console.log(`"${c}" -> title "${d.tool?.title}", template ${d.tool?.template}, tasks [${sel.topLevel(d).map(t=>t.title).join(", ")}], people [${d.people.map(p=>p.name).join(", ")}] | caption: ${r.message}`);
}

console.log("\n== Point 16: parser on Italian / free phrasing");
for (const c of ["Sposta lo sviluppo a lunedì", "Segna UI Design come fatto", "Chi è sovraccarico la prossima settimana?", "Fammi il brief per il cliente", "Nuovo progetto di brand identity per Forno Rossi", "annulla", "UI Design is finished, move on to Development", "Can you push Development back a week?", "mark ui design done"]) {
  const r = interpretDemo(c, { doc, selectedId: null });
  console.log(`"${c}" -> tone ${r.tone}, ops ${JSON.stringify(r.ops.map(o=>o.op))}${r.control?" control "+r.control:""} | ${r.message}`);
}

console.log("\n== Caption vs applied ops (demo engine)");
for (const c of ["Add Giulia to the team with 200 days", "Mark Research done", "Assign Research to Sara"]) {
  const r = interpretDemo(c, { doc, selectedId: null });
  const v = OperationListSchema.safeParse(r.ops);
  const next = v.success ? applyOperations(doc, v.data) : doc;
  console.log(`"${c}" -> caption "${r.message}" | schema valid: ${v.success} | doc changed (ref): ${next !== doc} | deep-equal: ${JSON.stringify(next)===JSON.stringify(doc)}`);
}

console.log("\n== Reducer determinism (uid = Math.random)");
const a = applyOperation(emptyDoc(), { op: "createProject", title: "X", template: "website" });
const b = applyOperation(emptyDoc(), { op: "createProject", title: "X", template: "website" });
console.log("createProject twice -> tool.id", a.tool.id, b.tool.id, "equal:", a.tool.id===b.tool.id);
const c1 = applyOperation(doc, { op: "addTask", title: "Copy", parentId: null, estimate: null });
const c2 = applyOperation(doc, { op: "addTask", title: "Copy", parentId: null, estimate: null });
console.log("addTask twice -> ids", c1.order.at(-1), c2.order.at(-1));
console.log("addPerson default capacity:", applyOperation(doc, { op: "addPerson", name: "Giulia" }).people.at(-1));
