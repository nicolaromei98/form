// Phase 0 audit probes for the domain model / reducer. Read-only against the repo.
const ROOT = "/Users/nicolaromei/code/form";
const { createJiti } = await import(`${ROOT}/node_modules/jiti/lib/jiti.mjs`);
const jiti = createJiti(import.meta.url, { alias: { "@": `${ROOT}/src` } });

const schema = await jiti.import(`${ROOT}/src/lib/schema.ts`);
const ops = await jiti.import(`${ROOT}/src/lib/ops.ts`);
const seed = await jiti.import(`${ROOT}/src/lib/seed.ts`);
const { DocSchema, OperationSchema } = schema;
const { applyOperation, applyOperations } = ops;

const out = {};
const log = (k, v) => { out[k] = v; console.log(k, "=>", JSON.stringify(v)); };
const valid = (doc) => { const r = DocSchema.safeParse(doc); return r.success ? "valid" : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 3); };
const base = () => applyOperation(seed.emptyDoc(), { op: "createProject", title: "Site", template: "website" });

// ---- 1. Operation inventory
const opNames = OperationSchema.options.map((o) => o.shape.op.value);
log("op.count", opNames.length);
log("op.names", opNames);

// ---- 2. Determinism: same input, same op, twice
const d0 = base();
const twice = (op) => {
  const a = applyOperation(d0, op), b = applyOperation(d0, op);
  return JSON.stringify(a) === JSON.stringify(b);
};
log("det.createProject", twice({ op: "createProject", title: "X", template: "website" }));
log("det.addTask", twice({ op: "addTask", title: "New", parentId: null, estimate: null }));
log("det.addPerson", twice({ op: "addPerson", name: "Ada" }));
log("det.addBriefLine", twice({ op: "addBriefLine", audience: "client", section: "note", text: "hi" }));
log("det.addMoodItems", twice({ op: "addMoodItems", items: [{ kind: "note", text: "n" }] }));
const withProp = applyOperation(d0, { op: "proposeSubtasks", parentId: "t-ui", items: [{ id: "t-ui", title: "collides", estimate: null }] });
log("det.acceptProposal(collision)", (() => { const a = applyOperation(withProp, { op: "acceptProposal" }), b = applyOperation(withProp, { op: "acceptProposal" }); return JSON.stringify(a) === JSON.stringify(b); })());
log("det.updateTask", twice({ op: "updateTask", id: "t-ui", patch: { progress: 100 } }));
log("det.arrangeMood", (() => { const m = applyOperation(d0, { op: "addMoodItems", items: [{ kind: "note", text: "a" }, { kind: "color", hex: "#ff0000" }] }); return JSON.stringify(applyOperation(m, { op: "arrangeMood", layout: "collage" })) === JSON.stringify(applyOperation(m, { op: "arrangeMood", layout: "collage" })); })());

// ---- 3. Input mutation: deep-freeze doc and op, run every op kind
const deepFreeze = (o) => { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };
const sampleOps = [
  { op: "createProject", title: "Y", template: "website", representation: "board" },
  { op: "renameTool", title: "Z" }, { op: "setRepresentation", representation: "team" }, { op: "removeView", representation: "cards" },
  { op: "setView", patch: { columns: 1 } }, { op: "setFields", patch: { estimate: false } },
  { op: "updateTask", id: "t-ui", patch: { progress: 100 } }, { op: "addTask", title: "A", parentId: "t-ui", estimate: 1 },
  { op: "removeTask", id: "t-visual" }, { op: "moveTask", id: "t-dev", toIndex: 0 },
  { op: "proposeSubtasks", parentId: "t-dev", items: [{ id: "p-1", title: "s", estimate: 1 }] }, { op: "acceptProposal" }, { op: "discardProposal" },
  { op: "addBlock", block: "moodboard" }, { op: "removeBlock", block: "metrics" }, { op: "setStartDate", date: "2026-10-05" },
  { op: "addMoodItems", items: [{ kind: "note", text: "x" }] }, { op: "arrangeMood", layout: "grid" }, { op: "clearMood" },
  { op: "addPerson", name: "Ada" }, { op: "updatePerson", id: "p-marta", patch: { capacity: 12 } }, { op: "removePerson", id: "p-luca" },
  { op: "assignTask", taskId: "t-dev", personId: "p-sara" }, { op: "addSampleTeam" },
  { op: "proposeReassign", moves: [{ taskId: "t-ui", to: "p-luca" }] }, { op: "acceptReassign" }, { op: "discardReassign" },
  { op: "editBriefLine", key: "client:done:all", text: "t", basis: "b" }, { op: "resetBriefLine", key: "client:done:all" },
  { op: "addBriefLine", audience: "team", section: "risks", text: "r" }, { op: "resetBrief", audience: "team" },
];
let mutErr = [];
let d = deepFreeze(base());
for (const op of sampleOps) {
  try { const snap = JSON.stringify(d); const n = applyOperation(d, deepFreeze(structuredClone(op))); if (JSON.stringify(d) !== snap) mutErr.push(op.op + ":changed-input"); d = deepFreeze(n); }
  catch (e) { mutErr.push(`${op.op}: ${e.message}`); }
}
log("mutation.errors", mutErr);
log("mutation.finalDocValid", valid(d));

// ---- 4. Aliasing: op payload stored by reference into the doc
{
  const op = { op: "proposeSubtasks", parentId: "t-ui", items: [{ id: "p-x", title: "s", estimate: null }] };
  const n = applyOperation(base(), op);
  log("alias.proposal.items===op.items", n.proposal.items === op.items);
}

// ---- 5. Status/progress coherence (v1 §5.7)
const st = (patch, from = "t-ui") => { const t = applyOperation(base(), { op: "updateTask", id: from, patch }).tasks[from]; return `${t.status}@${t.progress}`; };
log("inv.done+progress40 (parser: 'mark it done at 40%')", st({ status: "done", progress: 40 }));
log("inv.active(30)->todo (status menu / board lane back)", st({ status: "todo" }));
log("inv.done(100)->review (board lane back)", st({ status: "review" }, "t-research"));
log("inv.done(100)->active (status menu)", st({ status: "active" }, "t-research"));
log("inv.review(85)->progress100", st({ progress: 100 }, "t-visual"));
log("inv.done->progress0", st({ progress: 0 }, "t-research"));
log("inv.todo->progress50", st({ progress: 50 }, "t-dev"));
log("inv.active->progress0", st({ progress: 0 }, "t-ui"));
log("inv.todo+progress100+status todo", st({ status: "todo", progress: 100 }, "t-dev"));
log("inv.done->todo progress", st({ status: "todo" }, "t-research"));

// ---- 6. Nesting / orphans / dangling refs
{
  let x = base();
  x = applyOperation(x, { op: "addTask", title: "Step", parentId: "t-ui", estimate: null });
  const stepId = Object.keys(x.tasks).find((k) => x.tasks[k].parentId === "t-ui");
  x = applyOperation(x, { op: "addTask", title: "Grandchild", parentId: stepId, estimate: null });
  const gc = Object.values(x.tasks).find((t) => t.parentId === stepId);
  log("nest.grandchildCreated", Boolean(gc));
  x = applyOperation(x, { op: "removeTask", id: "t-ui" });
  log("nest.orphanAfterParentRemoved", x.tasks[gc.id] ? `orphan ${gc.id} parentId=${x.tasks[gc.id].parentId} (exists: ${Boolean(x.tasks[x.tasks[gc.id].parentId])})` : "none");
  log("nest.docStillValid", valid(x));
  let f = applyOperation(base(), { op: "setView", patch: { focusId: "t-ui" } });
  f = applyOperation(f, { op: "removeTask", id: "t-ui" });
  log("dangling.focusIdAfterRemove", f.view.focusId);
  let p = applyOperation(base(), { op: "proposeSubtasks", parentId: "t-ui", items: [{ id: "p-marta", title: "Step named like a person id", estimate: null }] });
  p = applyOperation(p, { op: "acceptProposal" });
  log("ids.stepTaskIdEqualsPersonId", Boolean(p.tasks["p-marta"]) && p.people.some((q) => q.id === "p-marta"));
  const tmpl = base();
  log("ids.templateFixed", { tasks: Object.keys(tmpl.tasks), people: tmpl.people.map((q) => q.id), toolId: tmpl.tool.id });
  // addTask id collision is silent overwrite: simulate by forcing an existing id through Math.random
  const realRandom = Math.random;
  // uid = `${prefix}-${Math.random().toString(36).slice(2, 8)}`; find a value whose base36 slice is "ui"
  Math.random = () => parseInt("ui", 36) / 36 ** 2; // 0.ui in base 36
  const forced = seed.uid();
  const c = applyOperation(base(), { op: "addTask", title: "Overwrites", parentId: null, estimate: null });
  Math.random = realRandom;
  log("ids.forcedUid", forced);
  log("ids.collisionOverwrites t-ui", { title: c.tasks["t-ui"].title, orderHasDup: c.order.filter((i) => i === "t-ui").length });
  // Short ids: Math.random values with short base-36 expansions
  log("ids.shortUid(0.5)", (() => { Math.random = () => 0.5; const u = seed.uid(); Math.random = realRandom; return u; })());
}

// ---- 7. No-op ops still return a new reference (history entry for nothing)
{
  const b = base();
  const same = (op) => applyOperation(b, op) === b;
  log("identity.setView(same sort)", same({ op: "setView", patch: { sort: "manual" } }));
  log("identity.setRepresentation(same)", same({ op: "setRepresentation", representation: "cards" }));
  log("identity.updateTask(same title)", same({ op: "updateTask", id: "t-ui", patch: { title: "UI Design" } }));
  log("identity.renameTool(same)", same({ op: "renameTool", title: "Site" }));
  log("identity.updateTask(unknown id)", same({ op: "updateTask", id: "nope", patch: { title: "x" } }));
}

// ---- 8. Data-loss: limits only enforced by DocSchema
{
  // tool.title: inline editor slices to 140, renameTool via commit() is not Zod-validated
  const t = applyOperation(base(), { op: "renameTool", title: "A".repeat(140) });
  log("loss.renameTool140.opSchema", OperationSchema.safeParse({ op: "renameTool", title: "A".repeat(140) }).success);
  log("loss.renameTool140.doc", valid(t));
  // people: TeamView "Add person" has no cap
  let p = base();
  for (let i = 4; i <= 21; i++) p = applyOperation(p, { op: "addPerson", name: `Person ${i}` });
  log("loss.people.count", p.people.length);
  log("loss.people21.doc", valid(p));
  // "Add person" uses `Person ${people.length + 1}`: after removing one, the name collides and the click is a silent no-op
  let q = applyOperation(base(), { op: "addPerson", name: "Person 4" });
  q = applyOperation(q, { op: "removePerson", id: "p-sara" });
  const before = q.people.length;
  q = applyOperation(q, { op: "addPerson", name: `Person ${q.people.length + 1}` });
  log("ux.addPersonNameCollisionNoop", q.people.length === before);
  // mood items: drops of 24 accumulate past 200
  let m = base();
  for (let i = 0; i < 9; i++) m = applyOperation(m, { op: "addMoodItems", items: Array.from({ length: 24 }, (_, k) => ({ kind: "image", asset: `img-${i}-${k}`, w: 0.24, h: 0.24 * 0.75 })) });
  log("loss.mood.count", m.mood.length);
  log("loss.mood216.doc", valid(m));
  // arrangeMood masonry: 120 phone screenshots (aspect 2.16)
  let s = base();
  for (let i = 0; i < 5; i++) s = applyOperation(s, { op: "addMoodItems", items: Array.from({ length: 24 }, (_, k) => ({ kind: "image", asset: `img-${i}-${k}`, w: 0.24, h: 0.24 * 2.16 })) });
  const sm = applyOperation(s, { op: "arrangeMood", layout: "masonry" });
  log("loss.masonry120tall.maxY", Math.max(...sm.mood.map((i) => i.y)).toFixed(2));
  log("loss.masonry120tall.doc", valid(sm));
  const sc = applyOperation(s, { op: "arrangeMood", layout: "collage" });
  log("loss.collage120tall.doc", valid(sc));
  const sg = applyOperation(s, { op: "arrangeMood", layout: "grid" });
  log("loss.grid120tall.doc", valid(sg));
  // find the smallest count of tall images that breaks masonry
  for (let n = 10; n <= 200; n += 2) {
    let z = base();
    z = applyOperation(z, { op: "addMoodItems", items: Array.from({ length: Math.min(24, n) }, (_, k) => ({ kind: "image", asset: `a${k}`, w: 0.24, h: 0.24 * 2.16 })) });
    while (z.mood.length < n) z = applyOperation(z, { op: "addMoodItems", items: Array.from({ length: Math.min(24, n - z.mood.length) }, (_, k) => ({ kind: "image", asset: `b${z.mood.length}-${k}`, w: 0.24, h: 0.24 * 2.16 })) });
    if (valid(applyOperation(z, { op: "arrangeMood", layout: "masonry" })) !== "valid") { log("loss.masonry.firstBreakingCount(aspect2.16)", n); break; }
  }
  // a note resized narrow+tall in the UI (w 0.06, h 3) then arranged
  let nt = applyOperation(base(), { op: "addMoodItems", items: [{ kind: "note", text: "tall" }] });
  nt = applyOperation(nt, { op: "updateMoodItem", id: nt.mood[0].id, patch: { w: 0.06, h: 3 } });
  log("loss.tallNote.beforeArrange", valid(nt));
  log("loss.tallNote.masonry", valid(applyOperation(nt, { op: "arrangeMood", layout: "masonry" })));
  log("loss.tallNote.collage", valid(applyOperation(nt, { op: "arrangeMood", layout: "collage" })));
  log("loss.tallNote.grid", valid(applyOperation(nt, { op: "arrangeMood", layout: "grid" })));
  // updateTask title via inline editor: 140 = TaskSchema max, OK
  log("ok.taskTitle140", valid(applyOperation(base(), { op: "updateTask", id: "t-ui", patch: { title: "B".repeat(140) } })));
  // estimate not on a 0.5 grid (Claude path allows any float)
  log("v2.estimateOffGrid.opSchema", OperationSchema.safeParse({ op: "updateTask", id: "t-ui", patch: { estimate: 2.7 } }).success);
}

// ---- 9. Persistence round-trip: invalid persisted doc -> silently replaced, then overwritten
{
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear(), key: () => null, length: 0 };
  globalThis.window = globalThis;
  const bad = applyOperation(base(), { op: "renameTool", title: "A".repeat(81) });
  store.set("form.workspace.v1", JSON.stringify({ state: { doc: bad, log: [{ at: 1, label: "x", source: "direct" }] }, version: 1 }));
  const { useForm } = await jiti.import(`${ROOT}/src/lib/store.ts`);
  const st0 = useForm.getState();
  log("persist.afterHydrate.toolIsNull", st0.doc.tool === null);
  log("persist.storageStillHasBadDocBeforeAnySet", JSON.parse(store.get("form.workspace.v1")).state.doc.tool?.title?.length);
  st0.setReducedMotion(false); // what FormApp does on mount
  log("persist.afterFirstSet.storedTool", JSON.parse(store.get("form.workspace.v1")).state.doc.tool);
  // commit path does not validate ops
  useForm.getState().commit([{ op: "createProject", title: "Ok", template: "website" }], "t");
  useForm.getState().commit([{ op: "renameTool", title: "C".repeat(140) }], "rename project", "direct");
  log("persist.commitAcceptedInvalidTitle", useForm.getState().doc.tool.title.length);
  log("persist.storedDocValid", valid(JSON.parse(store.get("form.workspace.v1")).state.doc));
  // version bump without migrate
  store.set("form.workspace.v1", JSON.stringify({ state: { doc: base(), log: [] }, version: 2 }));
  const errs = []; const ce = console.error; console.error = (...a) => errs.push(a.join(" "));
  await useForm.persist.rehydrate();
  console.error = ce;
  log("persist.versionMismatch.toolNull", useForm.getState().doc.tool === null);
  log("persist.versionMismatch.consoleError", errs[0]?.slice(0, 90));
  // history
  const h = useForm.getState();
  log("history.limit/past", { past: h.past.length, partializeKeys: Object.keys(JSON.parse(store.get("form.workspace.v1")).state) });
}

import { writeFileSync } from "node:fs";
writeFileSync(new URL("./results.json", import.meta.url), JSON.stringify(out, null, 2));
