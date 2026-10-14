// Lab LCP/TBT under Lighthouse-like mobile throttling (150 ms RTT, 1.6 Mbps, 4x CPU). Lab only, not field p75.
import fs from "node:fs";
import { BASE, SCRATCH, launch, newPage, sleep } from "./lib.mjs";
const doc60 = fs.readFileSync(`${SCRATCH}/doc60.json`, "utf8");
const cases = [["first visit (intro)", { introSeen: false, doc: null }], ["return visit, empty workspace", { introSeen: true, doc: null }], ["return visit, 60-task tracker", { introSeen: true, doc: doc60 }]];
const b = await launch();
for (const [name, cfg] of cases) {
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const ctx = await b.createBrowserContext();
    const page = await ctx.newPage();
    const cdp = await page.createCDPSession();
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const { initScript } = await import("./lib.mjs");
    await page.evaluateOnNewDocument(initScript, cfg);
    await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
    await sleep(6000);
    const r = await page.evaluate(() => {
      const p = window.__perf; const nav = performance.getEntriesByType("navigation")[0];
      const fcp = performance.getEntriesByName("first-contentful-paint")[0];
      return { fcp: fcp ? Math.round(fcp.startTime) : null, lcp: p.lcp.length ? Math.round(p.lcp.at(-1).t) : null, lcpEl: p.lcp.at(-1)?.el, load: Math.round(nav.loadEventEnd), tbt: Math.round(p.longtasks.reduce((a, l) => a + Math.max(0, l.dur - 50), 0)), cls: Math.round(p.cls * 1000) / 1000 };
    });
    runs.push(r);
    await ctx.close();
  }
  const med = (k) => runs.map((r) => r[k]).sort((a, b) => a - b)[1];
  console.log(name.padEnd(32), "FCP", med("fcp"), "LCP", med("lcp"), "load", med("load"), "TBT", med("tbt"), "CLS", med("cls"), "| LCP el:", runs[1].lcpEl);
}
await b.close();
