// Runtime measurements: idle agent loop, 60-task stress, view switches, backdrop-filter census
import fs from "node:fs";
import { BASE, FIXTURES, OUT, TRACE_CATS, launch, newPage, sleep, traceBusy, windowStats } from "./lib.mjs";

const which = process.argv[2] || "all";
const cpu = Number(process.argv[3] || 1);
const out = {};
const doc60 = fs.readFileSync(`${FIXTURES}doc60.json`, "utf8");
const docDemo = fs.readFileSync(`${FIXTURES}docDemo.json`, "utf8");

const census = () =>
  // Every element that actually renders a backdrop filter, grouped by a readable signature
  (() => {
    const all = [...document.querySelectorAll("body *")];
    const hits = all.filter((el) => {
      const cs = getComputedStyle(el);
      const v = cs.backdropFilter || cs.webkitBackdropFilter;
      return v && v !== "none";
    });
    const groups = {};
    for (const el of hits) {
      const tag = el.closest("[data-task-id]") === el ? "task surface [data-task-id]" : el.getAttribute("role") === "tablist" ? "tab bar" : String(el.className).match(/\bglass-hi\b/) ? ".glass-hi" : String(el.className).match(/\bglass\b/) ? ".glass" : String(el.className).match(/backdrop-blur/) ? "tailwind backdrop-blur-*" : el.tagName.toLowerCase() + " (inline)";
      groups[tag] = (groups[tag] || 0) + 1;
    }
    const r = (el) => el.getBoundingClientRect();
    const visible = hits.filter((el) => { const b = r(el); return b.bottom > 0 && b.top < innerHeight && b.width > 0 && b.height > 0; }).length;
    const area = hits.reduce((a, el) => { const b = r(el); return a + Math.max(0, b.width) * Math.max(0, b.height); }, 0);
    return { total: hits.length, inViewport: visible, groups, totalAreaMpx: Math.round(area / 1e4) / 100, taskSurfaces: document.querySelectorAll("[data-task-id]").length, domNodes: all.length };
  })();

async function attrMutationsPerSec(page) {
  return page.evaluate(
    () =>
      new Promise((res) => {
        const svg = document.querySelector("svg.fixed.inset-0");
        if (!svg) return res({ svg: false });
        let n = 0;
        const mo = new MutationObserver((l) => (n += l.length));
        mo.observe(svg, { attributes: true, subtree: true });
        const c0 = window.__perf.rafCalls;
        setTimeout(() => {
          mo.disconnect();
          res({ svg: true, ellipseAttrMutationsPerSec: n, appRafCallbacksPerSec: window.__perf.rafCalls - c0 });
        }, 1000);
      }),
  );
}

async function trace(page, ms, name) {
  const file = `${OUT}traces/${name}-cpu${cpu}.json`;
  fs.mkdirSync(`${OUT}traces`, { recursive: true });
  await page.tracing.start({ path: file, categories: TRACE_CATS });
  await sleep(ms);
  await page.tracing.stop();
  return traceBusy(file, ms / 1000);
}

async function idle() {
  const b = await launch();
  try {
    // A: empty workspace, idle ring
    {
      const { page, cdp } = await newPage(b, { introSeen: true, doc: null }, { cpu });
      await page.goto(BASE, { waitUntil: "networkidle0" });
      await sleep(4000);
      out.idleEmpty = await windowStats(page, cdp, 5000, "empty workspace, idle agent, 5 s");
      out.idleEmptyTrace = await trace(page, 5000, "idle-empty");
      await sleep(10000);
      out.idleEmptyAfter20s = await attrMutationsPerSec(page);
      await page.close();
    }
    // A2: same with prefers-reduced-motion
    {
      const { page, cdp } = await newPage(b, { introSeen: true, doc: null }, { cpu, reduced: true });
      await page.goto(BASE, { waitUntil: "networkidle0" });
      await sleep(4000);
      out.idleEmptyReduced = await windowStats(page, cdp, 5000, "empty workspace, reduced motion, 5 s");
      out.idleEmptyReducedMut = await attrMutationsPerSec(page);
      await page.close();
    }
    // A3: demo project open, agent docked (compact)
    {
      const { page, cdp } = await newPage(b, { introSeen: true, doc: docDemo }, { cpu });
      await page.goto(BASE, { waitUntil: "networkidle0" });
      await sleep(5000);
      out.compactDemo = await windowStats(page, cdp, 5000, "demo project (4 tasks), agent compact, 5 s");
      out.compactDemoMut = await attrMutationsPerSec(page);
      // Hidden tab: a second tab in front; does the loop keep running?
      const other = await b.newPage();
      await other.goto("about:blank");
      await other.bringToFront();
      await sleep(1500);
      const hidden = await page.evaluate(() => ({ hidden: document.hidden, vis: document.visibilityState }));
      out.compactDemoHidden = { ...hidden, ...(await attrMutationsPerSec(page)) };
      await other.close();
      await page.close();
    }
  } finally {
    await b.close();
  }
}

async function stress() {
  const b = await launch();
  try {
    const { page, cdp } = await newPage(b, { introSeen: true, doc: doc60 }, { cpu });
    const navStart = Date.now();
    await page.goto(BASE, { waitUntil: "load" });
    await page.waitForFunction(() => document.querySelectorAll("[data-task-id]").length >= 60, { timeout: 30000, polling: 50 });
    const cardsAt = Date.now() - navStart;
    await sleep(5000);
    const load = await page.evaluate(() => {
      const p = window.__perf;
      const nav = performance.getEntriesByType("navigation")[0];
      const lt = p.longtasks.filter((l) => l.start < 6000);
      return {
        domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
        loadEventMs: Math.round(nav.loadEventEnd),
        lcpMs: p.lcp.length ? Math.round(p.lcp[p.lcp.length - 1].t) : null,
        lcpElement: p.lcp.length ? p.lcp[p.lcp.length - 1].el : null,
        cls: Math.round(p.cls * 1000) / 1000,
        longTasksFirst6s: lt.length,
        longTaskMaxMs: Math.round(Math.max(0, ...lt.map((l) => l.dur))),
        tbtFirst6sMs: Math.round(lt.reduce((a, l) => a + Math.max(0, l.dur - 50), 0)),
        longTasks: lt.map((l) => [Math.round(l.start), Math.round(l.dur)]),
      };
    });
    out.stressLoad = { ...load, sixtyCardsInDomMs_wallclock: cardsAt };
    out.trackerRest = await windowStats(page, cdp, 5000, "tracker, 60 cards, at rest, 5 s");
    out.trackerRestTrace = await trace(page, 4000, "tracker-rest");
    out.censusTracker = await page.evaluate(census);
    out.switches = [];
    for (const view of ["board", "timeline", "team", "focus", "brief", "cards"]) {
      const before = await page.evaluate(() => performance.now());
      const sw = await windowStats(page, cdp, 3000, `switch → ${view} (3 s incl. click)`, () => page.click(`[data-rep-tab="${view}"]`));
      const ev = await page.evaluate((t) => window.__perf.events.filter((e) => e.start >= t - 5 && ["pointerdown", "pointerup", "click", "mousedown", "mouseup"].includes(e.name)), before);
      const rest = await windowStats(page, cdp, 3000, `${view} at rest (3 s)`);
      const c = await page.evaluate(census);
      const extra = await page.evaluate(() => ({
        focusVolumes: document.querySelectorAll('section[aria-label="Project volumes"] [data-task-id]').length,
        timelineRows: document.querySelectorAll("[data-task-id]").length,
      }));
      let restTrace = null;
      if (view === "focus" || view === "board") restTrace = await trace(page, 3000, `${view}-rest`);
      out.switches.push({ view, clickEventTiming: ev.map((e) => ({ name: e.name, durMs: Math.round(e.dur), inputDelayMs: Math.round(e.delay), processingMs: Math.round(e.proc) })), switchWindow: sw, rest, census: c, extra, restTrace });
    }
    await page.close();
  } finally {
    await b.close();
  }
}

async function ab() {
  // Attribution on the 60-card tracker at rest: what does the agent loop cost, what do the card blurs cost?
  const b = await launch();
  try {
    const { page, cdp } = await newPage(b, { introSeen: true, doc: doc60 }, { cpu });
    await page.goto(BASE, { waitUntil: "load" });
    await page.waitForFunction(() => document.querySelectorAll("[data-task-id]").length >= 60, { timeout: 30000 });
    await sleep(5000);
    out.ab = [];
    const variants = [
      ["baseline", ""],
      ["no backdrop-filter on task cards", "[data-task-id]{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}"],
      ["agent SVG hidden (loop still runs, nothing painted)", "svg.fixed.inset-0{display:none!important}"],
      ["both", "[data-task-id]{backdrop-filter:none!important;-webkit-backdrop-filter:none!important} svg.fixed.inset-0{display:none!important}"],
    ];
    for (const [name, css] of variants) {
      await page.evaluate((css) => { let el = document.getElementById("__ab"); if (!el) { el = document.createElement("style"); el.id = "__ab"; document.head.appendChild(el); } el.textContent = css; }, css);
      await sleep(1500);
      const w = await windowStats(page, cdp, 4000, name);
      const t = await trace(page, 4000, "ab-" + name.replace(/[^a-z]+/gi, "-"));
      out.ab.push({ name, mainTaskMsPerSec: w.mainThreadMsPerSecond.task, scriptMsPerSec: w.mainThreadMsPerSecond.script, layoutsPer4s: w.layoutCount, fps: w.fps, threads: t.threads.slice(0, 5) });
    }
    await page.close();
  } finally {
    await b.close();
  }
}

if (which === "ab") await ab();
if (which === "all" || which === "idle") await idle();
if (which === "all" || which === "stress") await stress();
const file = `${OUT}results-${which}-cpu${cpu}.json`;
fs.writeFileSync(file, JSON.stringify(out, null, 2));
console.log("wrote", file);
