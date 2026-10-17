// Aggregate the Turbopack analyzer data: per client chunk, which packages/modules it holds
const fs = require("fs");
const b = fs.readFileSync(process.argv[2]);
const n = b.readUInt32BE(0);
const j = JSON.parse(b.slice(4, 4 + n).toString());
const full = (i) => { const p = []; let s = j.sources[i]; let guard = 0; while (s && guard++ < 200) { p.unshift(s.path); s = s.parent_source_index != null ? j.sources[s.parent_source_index] : null; } return p.join(""); };
const files = j.output_files.map((f) => f.filename);
const wanted = files.map((f, i) => [f, i]).filter(([f]) => /static\/chunks\/.*\.js$/.test(f));
console.log("client chunk files:", wanted.map(([f]) => f.split("/").pop()).join(", "));
const pkgOf = (p) => { const m = p.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/); return m ? m[1] : p.startsWith("[project]/src") || p.includes("/src/") ? "src: " + p.replace(/.*\/src\//, "src/") : p; };
for (const [f, oi] of wanted) {
  const parts = j.chunk_parts.filter((c) => c.output_file_index === oi);
  const tot = parts.reduce((a, c) => a + c.size, 0), totc = parts.reduce((a, c) => a + c.compressed_size, 0);
  const agg = {};
  for (const c of parts) { const k = pkgOf(full(c.source_index)); agg[k] = agg[k] || [0, 0]; agg[k][0] += c.size; agg[k][1] += c.compressed_size; }
  console.log(`\n== ${f.split("/").pop()}  raw ${tot}  compressed ${totc}`);
  Object.entries(agg).sort((a, b) => b[1][1] - a[1][1]).slice(0, +process.argv[3] || 25).forEach(([k, v]) => console.log(`  ${String(v[1]).padStart(7)} c  ${String(v[0]).padStart(7)} raw  ${k}`));
}
