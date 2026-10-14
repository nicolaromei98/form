const ROOT = "/Users/nicolaromei/code/form";
const { createJiti } = await import(`${ROOT}/node_modules/jiti/lib/jiti.mjs`);
const jiti = createJiti(import.meta.url);
const { DocSchema } = await jiti.import(`${ROOT}/src/lib/schema.ts`);
const { applyOperation } = await jiti.import(`${ROOT}/src/lib/ops.ts`);
const seed = await jiti.import(`${ROOT}/src/lib/seed.ts`);
const ok = (d) => DocSchema.safeParse(d).success;
const base = () => applyOperation(seed.emptyDoc(), { op: "createProject", title: "Site", template: "website" });
// first breaking count for masonry by aspect
for (const aspect of [1, 1.33, 1.5, 2.16, 3, 4]) {
  let found = null;
  for (let n = 2; n <= 200; n++) {
    let z = base();
    while (z.mood.length < n) z = applyOperation(z, { op: "addMoodItems", items: Array.from({ length: Math.min(24, n - z.mood.length) }, () => ({ kind: "image", asset: "a", w: 0.24, h: Math.min(3, 0.24 * aspect) })) });
    if (!ok(applyOperation(z, { op: "arrangeMood", layout: "masonry" }))) { found = n; break; }
  }
  console.log("masonry aspect", aspect, "first invalid at n =", found);
}
// smallest note aspect that breaks each layout, single note + 2 colours
for (const layout of ["masonry", "grid", "collage"]) {
  let found = null;
  for (let a = 1; a <= 50; a += 0.25) {
    let z = applyOperation(base(), { op: "addMoodItems", items: [{ kind: "note", text: "n" }] });
    const w = 3 / a >= 0.06 ? 0.06 : 3 / a; // narrowest UI width 0.06
    z = applyOperation(z, { op: "updateMoodItem", id: z.mood[0].id, patch: { w: 0.06, h: Math.min(3, 0.06 * a) } });
    if (!ok(applyOperation(z, { op: "arrangeMood", layout }))) { found = { aspect: a, w: 0.06, h: +(0.06 * a).toFixed(2) }; break; }
  }
  console.log("single tall note breaks", layout, "at", JSON.stringify(found));
}
// version mismatch on a fresh load
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.window = globalThis;
store.set("form.workspace.v1", JSON.stringify({ state: { doc: base(), log: [] }, version: 2 }));
const ce = console.error; let err = ""; console.error = (m) => (err = m);
const { useForm } = await jiti.import(`${ROOT}/src/lib/store.ts`);
console.error = ce;
console.log("fresh load, persisted version 2 -> tool:", useForm.getState().doc.tool, "|", err);
useForm.getState().setReducedMotion(true);
console.log("after first set, stored version/tool:", JSON.parse(store.get("form.workspace.v1")).version, JSON.parse(store.get("form.workspace.v1")).state.doc.tool);
// submit() applies the ops twice: nextDoc (caption) vs committed doc
const { applyOperations } = await jiti.import(`${ROOT}/src/lib/ops.ts`);
const d0 = base(); const opsList = [{ op: "addTask", title: "X", parentId: null, estimate: null }];
const a = applyOperations(d0, opsList), b = applyOperations(d0, opsList);
console.log("double-apply ids differ:", a.order.at(-1), b.order.at(-1));
// a single tab click is a history entry
useForm.getState().commit([{ op: "createProject", title: "P", template: "website" }], "c");
useForm.getState().commit([{ op: "setRepresentation", representation: "board" }], "x");
const p1 = useForm.getState().past.length;
useForm.getState().setRepresentation("cards");
console.log("tab switch pushes history:", useForm.getState().past.length - p1);
