import { createJiti } from "jiti";
import { LIB, SRC } from "../paths.mjs";
const jiti = createJiti(import.meta.url, { alias: { "@": SRC } });
const R = LIB;
const { applyOperations, applyOperation } = await jiti.import(R + "ops.ts");
const { emptyDoc } = await jiti.import(R + "seed.ts");
const sel = await jiti.import(R + "selectors.ts");
const { focusPick } = await jiti.import(R + "focus.ts");
const { balancePlan, loadsOf } = await jiti.import(R + "team.ts");
const { composeBrief } = await jiti.import(R + "brief.ts");
const base = applyOperation(emptyDoc(), { op: "createProject", title: "Scale", template: "website" });
for (const n of [4, 30, 60, 150]) {
  let doc = base;
  const ops = [];
  for (let i = 4; i < n; i++) ops.push({ op: "addTask", title: `Task ${i}`, parentId: null, estimate: 1 + (i % 5) });
  doc = applyOperations(doc, ops);
  // 3 steps per task
  const sops = []; for (const id of doc.order) for (let k=0;k<3;k++) sops.push({ op: "addTask", title: `Step ${k}`, parentId: id, estimate: 0.5 });
  doc = applyOperations(doc, sops);
  const today = sel.parseISODate("2026-10-14");
  const time = (fn, reps = 20) => { fn(); const t = performance.now(); for (let i = 0; i < reps; i++) fn(); return ((performance.now() - t) / reps).toFixed(2); };
  console.log(`${String(n).padStart(3)} tasks (+${3*n} steps): schedule ${time(()=>sel.schedule(doc))} ms | focusPick ${time(()=>focusPick(doc, today))} ms | loadsOf ${time(()=>loadsOf(doc))} ms | balancePlan ${time(()=>balancePlan(doc))} ms | composeBrief ${time(()=>composeBrief(doc,"team",false,today),5)} ms | timeline days ${sel.schedule(doc).totalDays}`);
}
