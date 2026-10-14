const ROOT = "/Users/nicolaromei/code/form";
const { createJiti } = await import(`${ROOT}/node_modules/jiti/lib/jiti.mjs`);
const jiti = createJiti(import.meta.url);
const { interpretDemo } = await jiti.import(`${ROOT}/src/lib/interpret/demo.ts`);
const { applyOperations } = await jiti.import(`${ROOT}/src/lib/ops.ts`);
const seed = await jiti.import(`${ROOT}/src/lib/seed.ts`);
const e = seed.emptyDoc();
for (const c of ["add Giulia to the team", "add a terracotta colour to the moodboard", "add a note: hello"]) {
  const r = interpretDemo(c, { doc: e, selectedId: null });
  const n = applyOperations(e, r.ops);
  console.log(JSON.stringify(c), "->", r.tone, r.ops.map((o) => o.op), "| tool:", n.tool && n.tool.title, "people:", n.people.length, "mood:", n.mood.length);
}
const base = applyOperations(e, [{ op: "createProject", title: "S", template: "website" }]);
for (const c of ["mark UI Design done at 40%", "set Development to 2 weeks", "move UI Design to to do"]) {
  const r = interpretDemo(c, { doc: base, selectedId: null });
  const n = applyOperations(base, r.ops);
  const t = Object.values(n.tasks).find((x) => c.includes(x.title));
  console.log(JSON.stringify(c), "->", JSON.stringify(r.ops), "=>", t && `${t.status}@${t.progress} est ${t.estimate}`);
}
