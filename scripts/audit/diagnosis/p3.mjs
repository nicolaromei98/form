import { createJiti } from "jiti";
import { LIB, SRC } from "../paths.mjs";
const jiti = createJiti(import.meta.url, { alias: { "@": SRC } });
const R = LIB;
const { applyOperations, applyOperation } = await jiti.import(R + "ops.ts");
const { emptyDoc } = await jiti.import(R + "seed.ts");
const sel = await jiti.import(R + "selectors.ts");
const { interpretDemo } = await jiti.import(R + "interpret/demo.ts");
let doc = applyOperation(emptyDoc(), { op: "createProject", title: "W", template: "website" });
doc = applyOperations(doc, [{ op: "addTask", title: "Copywriting", parentId: null, estimate: 3 }]);
const id = doc.order.at(-1);
const r = interpretDemo("Break this task into smaller steps", { doc, selectedId: id });
const items = r.ops.find(o => o.op === "proposeSubtasks").items;
console.log("Copywriting 3d ->", items.map(i => `${i.title} ${i.estimate}d`).join(", "), "sum", items.reduce((s,i)=>s+i.estimate,0), "| caption:", r.message);
// unknown duration does not push successors
const d2 = applyOperation(doc, { op: "updateTask", id: "t-ui", patch: { estimate: null } });
const s2 = sel.schedule(d2), st = sel.parseISODate(d2.tool.startDate);
console.log("UI Design estimate null -> unscheduled:", s2.unscheduled.map(i=>d2.tasks[i].title), "| Development starts", sel.toISODate(sel.addDays(st, s2.slots["t-dev"].start)), "(was 2026-10-11)");
