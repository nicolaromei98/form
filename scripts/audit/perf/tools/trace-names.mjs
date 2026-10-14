// Self-time-ish breakdown: total duration by event name on the renderer main thread (nested events overlap)
import fs from "node:fs";
const f = process.argv[2], secs = Number(process.argv[3] || 4);
const ev = JSON.parse(fs.readFileSync(f, "utf8")).traceEvents;
const names = new Map(); const mains = new Set();
for (const e of ev) if (e.ph === "M" && e.name === "thread_name" && e.args.name === "CrRendererMain") mains.add(`${e.pid}:${e.tid}`);
const cnt = {}; for (const e of ev) { const k = `${e.pid}:${e.tid}`; if (mains.has(k) && e.ph === "X") cnt[k] = (cnt[k] || 0) + (e.dur || 0); }
const main = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0];
const agg = {};
const paints = [];
for (const e of ev) {
  if (`${e.pid}:${e.tid}` !== main || e.ph !== "X" || !e.dur) continue;
  agg[e.name] = agg[e.name] || [0, 0]; agg[e.name][0] += e.dur; agg[e.name][1]++;
  if (e.name === "Paint" && e.args?.data) paints.push(e.args.data);
}
Object.entries(agg).sort((a, b) => b[1][0] - a[1][0]).slice(0, 18).forEach(([k, v]) => console.log(`${(v[0] / 1000 / secs).toFixed(1).padStart(7)} ms/s  ${String(v[1]).padStart(5)}x  ${k}`));
if (paints.length) { const c = {}; for (const p of paints) { const k = JSON.stringify(p.clip ? [Math.round(p.clip[2]-p.clip[0]), Math.round(p.clip[5]-p.clip[1])] : p.nodeId); c[k] = (c[k] || 0) + 1; } console.log("Paint clips (w,h):", JSON.stringify(Object.entries(c).slice(0, 8))); }
