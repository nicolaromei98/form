// axe-core scan of each FORM state (production build on :3499)
import fs from "node:fs";
import { createRequire } from "node:module";
import { BASE, FIXTURES, OUT, launch, newPage, sleep } from "./lib.mjs";

const AXE = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const docDemo = fs.readFileSync(`${FIXTURES}docDemo.json`, "utf8");
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

async function scan(page, state) {
  await page.addScriptTag({ path: AXE });
  const r = await page.evaluate(async (tags) => {
    const res = await window.axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations", "incomplete"] });
    const pick = (v) => ({
      id: v.id,
      impact: v.impact,
      wcag: v.tags.filter((t) => /^wcag\d/.test(t)).join(","),
      help: v.help,
      nodes: v.nodes.length,
      examples: v.nodes.slice(0, 3).map((n) => ({ target: n.target.join(" "), html: n.html.slice(0, 160), why: (n.failureSummary || n.any?.[0]?.message || "").replace(/\s+/g, " ").slice(0, 220) })),
    });
    const cc = res.incomplete.find((i) => i.id === "color-contrast");
    const ccWhy = {};
    if (cc) for (const n of cc.nodes) { const k = (n.any?.[0]?.data?.messageKey || n.any?.[0]?.message || "?").toString().slice(0, 80); ccWhy[k] = (ccWhy[k] || 0) + 1; }
    return { violations: res.violations.map(pick), incomplete: res.incomplete.map(pick), ccIncompleteWhy: ccWhy };
  }, TAGS);
  return { state, ...r };
}

const b = await launch();
const results = [];
try {
  // Intro open (first visit)
  {
    const { page } = await newPage(b, { introSeen: false, doc: null });
    await page.goto(BASE, { waitUntil: "networkidle0" });
    await sleep(3500);
    results.push(await scan(page, "intro open (first visit, empty workspace behind)"));
    await page.close();
  }
  // Empty workspace, then the composer open
  {
    const { page } = await newPage(b, { introSeen: true, doc: null });
    await page.goto(BASE, { waitUntil: "networkidle0" });
    await sleep(4000);
    results.push(await scan(page, "empty workspace (idle agent)"));
    await page.keyboard.press("/");
    await sleep(2500);
    results.push(await scan(page, "empty workspace, composer open"));
    await page.close();
  }
  // The demo project in each view
  {
    const { page } = await newPage(b, { introSeen: true, doc: docDemo });
    await page.goto(BASE, { waitUntil: "networkidle0" });
    await sleep(4500);
    results.push(await scan(page, "tracker (demo project, 4 tasks)"));
    for (const v of ["board", "timeline", "team", "focus", "brief"]) {
      await page.click(`[data-rep-tab="${v}"]`);
      await sleep(3500);
      results.push(await scan(page, v));
    }
    await page.close();
  }
} finally {
  await b.close();
}
fs.writeFileSync(`${OUT}results-axe.json`, JSON.stringify(results, null, 2));
for (const r of results) {
  console.log(`\n### ${r.state}: ${r.violations.length} violated rules, ${r.violations.reduce((a, v) => a + v.nodes, 0)} nodes | incomplete: ${r.incomplete.map((i) => `${i.id}(${i.nodes})`).join(", ")}`);
  console.log("  color-contrast incomplete because:", JSON.stringify(r.ccIncompleteWhy));
  for (const v of r.violations) console.log(`  - ${v.id} [${v.impact}] ${v.wcag || "best-practice"} nodes=${v.nodes} :: ${v.examples[0]?.target} :: ${v.examples[0]?.why.slice(0, 140)}`);
}
