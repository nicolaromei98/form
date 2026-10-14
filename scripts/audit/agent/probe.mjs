// Phase 0 audit probe: demo parser behaviour + Claude post-processing, offline (mocked SDK).
// Usage: node scripts/audit/agent/probe.mjs [ctx|palette|sanitize|claude|all]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { LIB, ROOT, SRC, outDir } from "../paths.mjs";

const jiti = createJiti(ROOT, { alias: { "@": SRC } });
const MOCK = fileURLToPath(new URL("./mock-sdk.mjs", import.meta.url));

// The Claude module can't load outside Next ("server-only") and must never reach the network, so the
// probe runs a generated copy: server-only removed, the SDK client swapped for the mock, internals exported.
function claudeCopy() {
  const src = readFileSync(LIB + "interpret/claude.server.ts", "utf8")
    .replace(/^import "server-only";\n/m, "")
    .replace(/^import Anthropic from "@anthropic-ai\/sdk";$/m, `import Anthropic from ${JSON.stringify(MOCK)};`)
    .replace(/from "\.\.\/(\w+)"/g, (_, mod) => `from ${JSON.stringify(LIB + mod)}`)
    .replace(/^(const SYSTEM|function workspaceContext|function sanitise)/gm, "export $1");
  const file = outDir("agent") + "claude.server.copy.ts";
  writeFileSync(file, src);
  return file;
}

const { interpretDemo } = await jiti.import(LIB + "interpret/demo.ts");
const { applyOperations } = await jiti.import(LIB + "ops.ts");
const { emptyDoc } = await jiti.import(LIB + "seed.ts");
const S = await jiti.import(LIB + "schema.ts");
const C = await jiti.import(claudeCopy());
const mock = await jiti.import(MOCK);
const sec = process.argv[2] ?? "all";
const on = (k) => sec === "all" || sec === k;

const run = (doc, cmd, selectedId = null) => interpretDemo(cmd, { doc, selectedId });
const fmt = (r) => `${r.tone}${r.control ? "/" + r.control : ""} ops=[${r.ops.map((o) => o.op + (o.representation ? ":" + o.representation : "")).join(",")}] "${r.message}"`;
let doc = emptyDoc();
const born = run(doc, "Create a timeline for my project");
doc = applyOperations(doc, born.ops);

if (on("ctx")) {
  const ctx = C.workspaceContext(doc, null);
  const json = JSON.stringify(ctx);
  const userMsg = `Workspace:\n${json}\n\nCommand: Add a board`;
  console.log("template doc views:", doc.tool.views, "tasks:", Object.keys(doc.tasks).length, "people:", doc.people.length);
  console.log("workspaceContext keys:", Object.keys(ctx));
  console.log("workspaceContext JSON chars:", json.length, "~tokens(/4):", Math.round(json.length / 4));
  console.log("user message chars:", userMsg.length, "~tokens:", Math.round(userMsg.length / 4));
  console.log("SYSTEM chars:", C.SYSTEM.length, "~tokens:", Math.round(C.SYSTEM.length / 4));
  console.log("full doc JSON (what the client POSTs) chars:", JSON.stringify({ command: "Add a board", doc, selectedId: null }).length);
  console.log("sample ctx:", json.slice(0, 700));
  // Bigger doc: 150 tasks, every view, moodboard with 40 notes
  let big = doc;
  for (let i = 0; i < 146; i++) big = applyOperations(big, [{ op: "addTask", title: `Task number ${i} with a realistic title`, parentId: null, estimate: 3 }]);
  big = applyOperations(big, [{ op: "addMoodItems", items: Array.from({ length: 24 }, (_, i) => ({ kind: "note", text: `Reference note ${i} about tone and texture` })) }]);
  const bj = JSON.stringify(C.workspaceContext(big, null));
  console.log("150-task + 24 notes ctx chars:", bj.length, "~tokens:", Math.round(bj.length / 4));
}

if (on("palette")) {
  const { CAPABILITIES } = await jiti.import(SRC + "/components/agent/suggestions.ts");
  for (const g of CAPABILITIES) for (const item of g.items) {
    const base = g.needs === "none" ? emptyDoc() : doc;
    const sel = g.needs === "selection" ? "t-ui" : null;
    const r = run(base, item, sel);
    const bad = r.tone === "unsupported" || r.tone === "clarify";
    console.log(`${bad ? "!!" : "ok"} [${g.group}] ${item} -> ${fmt(r)}`);
  }
}

if (on("v1")) {
  const v1 = ["Set the deadline to 30 November", "The start is confirmed for Monday", "Budget is 12k", "Client is Ceramica Bassi", "Archive this project",
    "Development depends on UI Design", "Run Copywriting in parallel with UI Design", "Start QA on the 10th", "Development is due Friday", "Marta is on it half-time",
    "Level the schedule", "Suggest estimates", "Marta is off from 2 to 6 November", "Luca's day rate is 350", "This is me",
    "Zoom the timeline to weeks", "Only Marta's tasks", "What's due this week?", "Show the budget",
    "Share the brief with the client", "What changed since the last update?", "Mark it as sent",
    "Sposta lo sviluppo a lunedì", "Chi è sovraccarico la prossima settimana?", "Fammi il brief per il cliente", "annulla", "Aggiungi una timeline"];
  for (const c of v1) {
    const a = run(doc, c), b = run(doc, c, "t-ui");
    console.log(`${c}\n   no-sel: ${fmt(a)}\n   sel=UI: ${fmt(b)}`);
  }
}

if (on("nomatch")) {
  for (const c of ["asdf qwerty", "Compare two vendors", "Show the budget", "Sort them", "Mark it done", "Make it pop", "Add a board and then email the client"]) {
    console.log(c.padEnd(42), fmt(run(doc, c)));
  }
  console.log("Mark it done (sel=t-ui)".padEnd(42), fmt(run(doc, "Mark it done", "t-ui")));
  // no-op ops: caption claims a change; reducer may return same doc
  const done = run(doc, "Mark Research done");
  const next = applyOperations(doc, done.ops);
  console.log("Mark Research done (already done):", fmt(done), "| reducer returned same ref:", next === doc, "| deep-equal:", JSON.stringify(next) === JSON.stringify(doc));
}

if (on("timing")) {
  const cmds = ["undo", "Add a board", "Make the cards more compact and sort them by priority", "Assign Development to Sara", "Add to the brief: homepage preview on Friday", "asdf qwerty"];
  for (const c of cmds) {
    const t0 = performance.now(); for (let i = 0; i < 2000; i++) run(doc, c); const ms = (performance.now() - t0) / 2000;
    console.log(c.padEnd(56), ms.toFixed(3), "ms/parse");
  }
}

if (on("sanitize")) {
  const s = (ops, cmd = "x", d = doc) => JSON.stringify(C.sanitise(ops, d, cmd).map((o) => o.op + (o.representation ? ":" + o.representation : "")));
  console.log("two new views in one command (project open):", s([{ op: "setRepresentation", representation: "board" }, { op: "setRepresentation", representation: "team" }, { op: "setRepresentation", representation: "brief" }]));
  console.log("focusId of unknown task:", JSON.stringify(C.sanitise([{ op: "setView", patch: { focusId: "t-nope" } }], doc, "x")));
  console.log("invented start date:", s([{ op: "setStartDate", date: "2027-01-04" }]));
  console.log("invented capacity:", JSON.stringify(C.sanitise([{ op: "addPerson", name: "Giulia", capacity: 12 }], doc, "add giulia")));
  console.log("unknown brief line ids:", s([{ op: "updateBriefLine", id: "nope", text: "x" }, { op: "removeBriefLine", id: "nope" }, { op: "editBriefLine", key: "client:nope", text: "x", basis: "y" }]));
  const withStep = applyOperations(doc, [{ op: "addTask", title: "Step A", parentId: "t-ui", estimate: null }]);
  const stepId = Object.values(withStep.tasks).find((t) => t.parentId)?.id;
  console.log("addTask under a step (nesting):", s([{ op: "addTask", title: "Nested", parentId: stepId, estimate: null }], "x", withStep));
  console.log("updateTask unknown id:", s([{ op: "updateTask", id: "t-nope", patch: { status: "done" } }]));
  console.log("createProject with project open, no 'new':", s([{ op: "createProject", title: "X", template: "website" }], "create a timeline for my project"));
  console.log("13 ops (over cap):", (() => { try { S.OperationListSchema.parse(Array(13).fill({ op: "clearMood" })); return "accepted"; } catch { return "rejected by OperationListSchema"; } })());
}

if (on("claude")) {
  const msg = (text, stop = "end_turn") => ({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: stop, content: text == null ? [] : [{ type: "text", text }], usage: {} });
  const tryIt = async (label, m, cmd = "Add a board") => {
    mock.canned.next = m;
    try { const r = await C.interpretWithClaude(cmd, doc, null); console.log(label.padEnd(44), "->", fmt(r)); }
    catch (e) { console.log(label.padEnd(44), "-> THROWS", e.constructor.name, "| instanceof APIError:", e instanceof mock.default.APIError, "|", String(e.message).slice(0, 90)); }
  };
  await tryIt("valid board", msg(JSON.stringify({ ops: [{ op: "setRepresentation", representation: "board" }], tone: "done", message: "Board" })));
  const p = mock.canned.lastParams;
  console.log("request params:", JSON.stringify({ model: p.model, max_tokens: p.max_tokens, effort: p.output_config.effort, betas: p.betas, fallbacks: p.fallbacks, thinking: p.thinking ?? "(omitted)", temperature: p.temperature ?? "(omitted)", system_is_string: typeof p.system === "string", cache_control: p.cache_control ?? "(none)", tools: p.tools ?? "(none)" }));
  await tryIt("model caption lies (says Timeline)", msg(JSON.stringify({ ops: [{ op: "setRepresentation", representation: "board" }], tone: "done", message: "Timeline zoomed to weeks" })));
  await tryIt("unknown op name (enum not enforced)", msg(JSON.stringify({ ops: [{ op: "deleteEverything" }], tone: "done", message: "x" })));
  await tryIt("bad tone value", msg(JSON.stringify({ ops: [], tone: "ok", message: "x" })));
  await tryIt("message > 280", msg(JSON.stringify({ ops: [], tone: "done", message: "x".repeat(300) })));
  await tryIt("refusal, no text", msg(null, "refusal"));
  await tryIt("refusal, partial text", msg('{"ops":[', "refusal"));
  await tryIt("max_tokens truncation", msg('{"ops":[{"op":"setView"', "max_tokens"));
  await tryIt("all ops sanitised away, tone done", msg(JSON.stringify({ ops: [{ op: "updateTask", id: "t-nope", patch: { status: "done" } }], tone: "done", message: "Marked done" })), "mark nope done");
}
