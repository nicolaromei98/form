// Group every client chunk's modules into packages; print package totals across first-load chunks
const fs = require("fs");
const b = fs.readFileSync(process.argv[2]);
const n = b.readUInt32BE(0);
const j = JSON.parse(b.slice(4, 4 + n).toString());
const full = (i) => { const p = []; let s = j.sources[i]; let g = 0; while (s && g++ < 200) { p.unshift(s.path); s = s.parent_source_index != null ? j.sources[s.parent_source_index] : null; } return p.join(""); };
const files = j.output_files.map((f) => f.filename);
const client = files.map((f, i) => [f, i]).filter(([f]) => /static\/chunks\/.*\.js$/.test(f) && !/0cz1d0mv5g_q7/.test(f));
const pkg = (p) => { if (p.includes("/src/")) return "app src"; if (p.includes("next/dist/compiled/react-dom")) return "react-dom"; if (p.includes("next/dist/compiled/react")) return "react"; if (p.includes("next/dist/compiled/scheduler")) return "scheduler"; const m = p.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/); if (m) return m[1] === "next" ? "next (router/runtime)" : m[1]; return "turbopack runtime"; };
const agg = {};
for (const [, oi] of client) for (const c of j.chunk_parts.filter((c) => c.output_file_index === oi)) { const k = pkg(full(c.source_index)); agg[k] = agg[k] || [0, 0]; agg[k][0] += c.size; agg[k][1] += c.compressed_size; }
let T = [0, 0];
Object.entries(agg).sort((a, b) => b[1][0] - a[1][0]).forEach(([k, v]) => { T[0] += v[0]; T[1] += v[1]; console.log(`${String(v[0]).padStart(8)} raw ${String(v[1]).padStart(8)} c  ${k}`); });
console.log("TOTAL", T);
// list any module path mentioning anthropic / server-only / claude.server in client chunks
for (const [, oi] of client) for (const c of j.chunk_parts.filter((c) => c.output_file_index === oi)) { const p = full(c.source_index); if (/anthropic|server-only|claude\.server|api\/interpret/.test(p)) console.log("SERVER-ISH IN CLIENT:", p); }
// list the app src modules in client
const src = new Set(); for (const [, oi] of client) for (const c of j.chunk_parts.filter((c) => c.output_file_index === oi)) { const p = full(c.source_index); if (p.includes("/src/")) src.add(p.replace(/.*\/src\//, "src/")); }
console.log([...src].sort().join("\n"));
// gsap sub modules
const gs = {}; for (const [, oi] of client) for (const c of j.chunk_parts.filter((c) => c.output_file_index === oi)) { const p = full(c.source_index); const m = p.match(/node_modules\/(gsap|zod|@gsap\/react)\/(.*)/); if (m) { const k = m[1] + "/" + m[2].split("/").slice(0, 3).join("/"); gs[k] = (gs[k] || 0) + c.size; } }
console.log(Object.entries(gs).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${v} ${k}`).join("\n"));
