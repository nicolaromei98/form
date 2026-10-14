const { createJiti } = await import("/Users/nicolaromei/code/form/node_modules/jiti/lib/jiti.mjs");
const jiti = createJiti(import.meta.url, { alias: { "@": "/Users/nicolaromei/code/form/src" } });
const R = "/Users/nicolaromei/code/form/src/lib/";
const { applyOperations, applyOperation } = await jiti.import(R + "ops.ts");
const { emptyDoc } = await jiti.import(R + "seed.ts");
const sel = await jiti.import(R + "selectors.ts");
const { focusPick, reasonsFor } = await jiti.import(R + "focus.ts");
const { balancePlan, loadsOf } = await jiti.import(R + "team.ts");

const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
let doc = applyOperation(emptyDoc(), { op: "createProject", title: "New website", template: "website", representation: "timeline" });
const sch = sel.schedule(doc);
const start = sel.parseISODate(doc.tool.startDate);
console.log("== Point 5: schedule (start", doc.tool.startDate, DAYS[start.getDay()], ") totalDays", sch.totalDays);
for (const t of sel.topLevel(doc)) {
  const s = sch.slots[t.id];
  const a = sel.addDays(start, s.start), b = sel.addDays(start, s.start + s.days - 1);
  const days = []; for (let i = 0; i < s.days; i++) { const d = sel.addDays(start, s.start + i); days.push(DAYS[d.getDay()] + " " + sel.toISODate(d)); }
  const weekend = days.filter(d => d.startsWith("Sat") || d.startsWith("Sun"));
  console.log(`${t.title.padEnd(17)} est ${s.days}d  ${sel.toISODate(a)} (${DAYS[a.getDay()]}) -> ${sel.toISODate(b)} (${DAYS[b.getDay()]})  weekend days counted: ${weekend.join(", ") || "none"}`);
}
// Working-day equivalent end (Mon-Fri) for comparison
function addWorking(d, n){ let x=new Date(d), c=0; while(true){ if(x.getDay()!==0&&x.getDay()!==6){c++; if(c===n) return x;} x=sel.addDays(x,1);} }
let cur = new Date(start);
console.log("-- same estimates on Mon-Fri working days, sequential:");
for (const t of sel.topLevel(doc)) {
  while (cur.getDay()===0||cur.getDay()===6) cur = sel.addDays(cur,1);
  const end = addWorking(cur, t.estimate);
  console.log(`${t.title.padEnd(17)} ${sel.toISODate(cur)} (${DAYS[cur.getDay()]}) -> ${sel.toISODate(end)} (${DAYS[end.getDay()]})`);
  cur = sel.addDays(end,1);
}

console.log("\n== Point 8: focus at different 'today' values (no deadline field exists)");
for (const today of ["2026-09-28","2026-10-02","2026-10-14","2027-01-15"]) {
  const p = focusPick(doc, sel.parseISODate(today));
  console.log(today, "->", p.task.title, "|", p.reasons.map(r=>`${r.text} (${Math.round(r.weight*10)/10})`).join("; "));
}

console.log("\n== Point 9: focus picks a task whose workflow predecessor is unfinished");
let d9 = applyOperations(doc, [
  { op: "setStartDate", date: "2026-11-02" },
  { op: "updateTask", id: "t-dev", patch: { priority: "urgent" } },
  { op: "updateTask", id: "t-ui", patch: { priority: "low" } },
]);
const p9 = focusPick(d9, sel.parseISODate("2026-10-14"));
console.log("pick:", p9.task.title, p9.task.status, "| UI Design status:", d9.tasks["t-ui"].status, d9.tasks["t-ui"].progress+"%", "| Visual Direction:", d9.tasks["t-visual"].status);
for (const t of sel.topLevel(d9).filter(t=>t.status!=="done")) console.log("  ", t.title.padEnd(17), reasonsFor(d9,t,sel.parseISODate("2026-10-14")).reduce((s,r)=>s+r.weight,0));

console.log("\n== Point 10: balancePlan is role-blind");
console.log("sample loads:", loadsOf(doc).map(l=>`${l.person?.name??"Unassigned"}(${l.person?.role??"-"}) ${l.days}/${l.person?.capacity??"-"}`).join(" | "));
console.log("sample plan:", JSON.stringify(balancePlan(doc)));
let d10 = applyOperation(doc, { op: "updatePerson", id: "p-luca", patch: { capacity: 20 } });
const plan10 = balancePlan(d10);
console.log("Luca capacity 20 -> plan:", plan10.map(m=>`${d10.tasks[m.taskId].title} (owner role ${d10.people.find(p=>p.id===d10.tasks[m.taskId].owner).role}) -> ${d10.people.find(p=>p.id===m.to).name} (${d10.people.find(p=>p.id===m.to).role})`).join("; "));
// review task movable?
let d10b = applyOperations(doc, [{ op: "updateTask", id: "t-ui", patch: { status: "done" } }, { op: "updatePerson", id: "p-marta", patch: { capacity: 2 } }]);
console.log("Marta cap 2, UI done -> plan:", balancePlan(d10b).map(m=>`${d10b.tasks[m.taskId].title} [${d10b.tasks[m.taskId].status} ${d10b.tasks[m.taskId].progress}%] -> ${d10b.people.find(p=>p.id===m.to).name}`).join("; "));

console.log("\n== Point 11: status/progress coercion");
const t = (d,id)=>`${d.tasks[id].status}/${d.tasks[id].progress}`;
let x = applyOperation(doc, { op: "updateTask", id: "t-visual", patch: { progress: 100 } });
console.log("review 85% -> progress 100:", t(x,"t-visual"));
x = applyOperation(doc, { op: "updateTask", id: "t-visual", patch: { status: "done", progress: 40 } });
console.log("patch {status:done, progress:40}:", t(x,"t-visual"));
x = applyOperation(doc, { op: "updateTask", id: "t-research", patch: { status: "review" } });
console.log("Done 100% -> status review:", t(x,"t-research"));
x = applyOperation(doc, { op: "updateTask", id: "t-research", patch: { status: "active" } });
console.log("Done 100% -> status active:", t(x,"t-research"));
x = applyOperation(doc, { op: "updateTask", id: "t-dev", patch: { status: "review" } });
console.log("To do 0% -> status review:", t(x,"t-dev"));
// slider drag through 100 on an In review task (live updates, one at a time)
let y = doc; for (const p of [90,95,100,95,90]) y = applyOperation(y, { op: "updateTask", id: "t-visual", patch: { progress: p } });
console.log("In review 85%, slider drag 90->95->100->95->90:", t(y,"t-visual"));
