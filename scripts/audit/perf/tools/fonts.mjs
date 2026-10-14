// Which font faces does the page actually use after visiting every view, and what is transferred on first load
import fs from "node:fs";
import { BASE, FIXTURES, launch, newPage, sleep } from "./lib.mjs";
const docDemo = fs.readFileSync(`${FIXTURES}docDemo.json`, "utf8");
const b = await launch();
const { page } = await newPage(b, { introSeen: false, doc: docDemo });
const reqs = [];
page.on("response", async (r) => { try { const h = r.headers(); reqs.push({ url: r.url().replace(BASE, "/"), type: r.request().resourceType(), enc: h["content-encoding"] || "", len: Number(h["content-length"] || 0) }); } catch {} });
await page.goto(BASE, { waitUntil: "networkidle0" });
await sleep(3000);
const firstLoad = [...reqs];
await page.keyboard.press("Escape");
await sleep(1500);
for (const v of ["board", "timeline", "team", "focus", "brief", "cards"]) { await page.click(`[data-rep-tab="${v}"]`); await sleep(2500); }
await page.keyboard.press("/"); await sleep(1500);
const faces = await page.evaluate(() => [...document.fonts].map((f) => `${f.family} ${f.weight} ${f.status}`));
console.log("font faces after all views + intro + composer:\n " + faces.join("\n "));
const tf = await page.evaluate(() => performance.getEntriesByType("resource").map((e) => ({ n: e.name.split("/").pop(), t: e.initiatorType, transfer: e.transferSize, body: e.encodedBodySize })));
console.log("\nresources (transferSize):"); for (const r of tf) console.log(" ", String(r.transfer).padStart(7), r.t.padEnd(8), r.n);
const js = tf.filter((r) => r.n.endsWith(".js")).reduce((a, r) => a + r.transfer, 0), font = tf.filter((r) => r.n.endsWith(".woff2")).reduce((a, r) => a + r.transfer, 0);
console.log("JS transfer", js, "font transfer", font);
await b.close();
