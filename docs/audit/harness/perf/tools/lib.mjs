// Shared helpers for the Phase 0 performance / a11y audit (scratch only)
import puppeteer from "puppeteer-core";
import fs from "node:fs";

export const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const BASE = "http://localhost:3499/";
export const SCRATCH = "/private/tmp/claude-501/-Users-nicolaromei-code/7d2f5c6e-ce33-4568-8701-91bffc7211b3/scratchpad/audit/perf";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch() {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-first-run", "--no-default-browser-check", "--window-size=1440,900"],
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
  });
}

/**
 * Runs before any page script: seeds localStorage, installs PerformanceObservers,
 * wraps requestAnimationFrame to time every app callback per frame, and keeps an
 * independent frame clock on the original rAF.
 */
export function initScript(cfg) {
  try {
    localStorage.clear();
    if (cfg.introSeen) localStorage.setItem("form.intro.seen.v1", "1");
    if (cfg.doc) localStorage.setItem("form.workspace.v1", cfg.doc);
  } catch {}
  const P = (window.__perf = { longtasks: [], lcp: [], events: [], cls: 0, frames: [], rafFrames: [], rafCalls: 0 });
  const obs = (type, fn, extra = {}) => {
    try {
      new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true, ...extra });
    } catch {}
  };
  obs("longtask", (e) => P.longtasks.push({ start: e.startTime, dur: e.duration }));
  obs("largest-contentful-paint", (e) => P.lcp.push({ t: e.startTime, size: e.size, el: e.element ? e.element.tagName + "." + String(e.element.className).slice(0, 40) : null }));
  obs("layout-shift", (e) => {
    if (!e.hadRecentInput) P.cls += e.value;
  });
  obs("event", (e) => P.events.push({ name: e.name, start: e.startTime, dur: e.duration, delay: e.processingStart - e.startTime, proc: e.processingEnd - e.processingStart }), { durationThreshold: 16 });
  const orig = window.requestAnimationFrame.bind(window);
  let curTs = -1;
  let acc = 0;
  window.requestAnimationFrame = (cb) =>
    orig((ts) => {
      const t0 = performance.now();
      try {
        cb(ts);
      } finally {
        const d = performance.now() - t0;
        P.rafCalls++;
        if (ts !== curTs) {
          if (curTs >= 0) P.rafFrames.push([curTs, acc]);
          curTs = ts;
          acc = 0;
        }
        acc += d;
        if (P.rafFrames.length > 30000) P.rafFrames.splice(0, 15000);
      }
    });
  const tick = (ts) => {
    P.frames.push(ts);
    if (P.frames.length > 30000) P.frames.splice(0, 15000);
    orig(tick);
  };
  orig(tick);
}

export async function newPage(browser, cfg, { cpu = 1, reduced = false } = {}) {
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  await cdp.send("Performance.enable");
  if (cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  if (reduced) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.evaluateOnNewDocument(initScript, cfg);
  return { page, cdp };
}

export async function metrics(cdp) {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

/** Measures a window: CDP metric deltas, frame clock, per-frame rAF callback time, long tasks. */
export async function windowStats(page, cdp, ms, label, action) {
  const t0 = await page.evaluate(() => performance.now());
  const m0 = await metrics(cdp);
  if (action) await action();
  await sleep(ms);
  const m1 = await metrics(cdp);
  const t1 = await page.evaluate(() => performance.now());
  const P = await page.evaluate((a, b) => {
    const p = window.__perf;
    return {
      frames: p.frames.filter((t) => t >= a && t <= b),
      raf: p.rafFrames.filter(([t]) => t >= a && t <= b).map(([, d]) => d),
      longtasks: p.longtasks.filter((l) => l.start >= a && l.start <= b),
    };
  }, t0, t1);
  const gaps = P.frames.slice(1).map((t, i) => t - P.frames[i]);
  const secs = (m1.Timestamp - m0.Timestamp) || ms / 1000;
  const nFrames = P.frames.length;
  const d = (k) => (m1[k] - m0[k]) * 1000; // ms
  return {
    label,
    windowMs: Math.round(secs * 1000),
    fps: r2(nFrames / secs),
    frameGap: { p50: r2(pct(gaps, 50)), p95: r2(pct(gaps, 95)), max: r2(Math.max(0, ...gaps)), over33ms: gaps.filter((g) => g > 33.4).length, over50ms: gaps.filter((g) => g > 50).length },
    appRafJsPerFrameMs: { framesWithAppCallbacks: P.raf.length, mean: r2(P.raf.reduce((a, b) => a + b, 0) / Math.max(1, P.raf.length)), p50: r2(pct(P.raf, 50)), p95: r2(pct(P.raf, 95)), max: r2(Math.max(0, ...P.raf)) },
    mainThreadMsPerSecond: { script: r2(d("ScriptDuration") / secs), task: r2(d("TaskDuration") / secs), layout: r2(d("LayoutDuration") / secs), style: r2(d("RecalcStyleDuration") / secs) },
    mainThreadMsPerFrame: { script: r2(d("ScriptDuration") / Math.max(1, nFrames)), task: r2(d("TaskDuration") / Math.max(1, nFrames)), layout: r2(d("LayoutDuration") / Math.max(1, nFrames)), style: r2(d("RecalcStyleDuration") / Math.max(1, nFrames)) },
    layoutCount: m1.LayoutCount - m0.LayoutCount,
    styleRecalcCount: m1.RecalcStyleCount - m0.RecalcStyleCount,
    longTasks: { count: P.longtasks.length, totalMs: r2(P.longtasks.reduce((a, l) => a + l.dur, 0)), maxMs: r2(Math.max(0, ...P.longtasks.map((l) => l.dur))) },
    domNodes: m1.Nodes,
    jsHeapMB: r2(m1.JSHeapUsedSize / 1048576),
  };
}

/** Thread busy time from a Chrome trace: union of top-level task intervals per thread. */
export function traceBusy(file, secs) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const ev = raw.traceEvents || raw;
  const tname = new Map();
  const pname = new Map();
  for (const e of ev) {
    if (e.ph === "M" && e.name === "thread_name") tname.set(`${e.pid}:${e.tid}`, e.args.name);
    if (e.ph === "M" && e.name === "process_name") pname.set(e.pid, e.args.name);
  }
  const per = new Map();
  for (const e of ev) {
    if (e.ph !== "X" || !e.dur) continue;
    if (!/toplevel/.test(e.cat || "")) continue;
    const k = `${e.pid}:${e.tid}`;
    if (!per.has(k)) per.set(k, []);
    per.get(k).push([e.ts, e.ts + e.dur]);
  }
  const out = [];
  for (const [k, iv] of per) {
    iv.sort((a, b) => a[0] - b[0]);
    let busy = 0;
    let cs = -1;
    let ce = -1;
    for (const [s, e] of iv) {
      if (s > ce) {
        if (ce > cs) busy += ce - cs;
        cs = s;
        ce = e;
      } else ce = Math.max(ce, e);
    }
    if (ce > cs) busy += ce - cs;
    const pid = Number(k.split(":")[0]);
    out.push({ process: pname.get(pid) || pid, thread: tname.get(k) || k, busyMsPerSec: r2(busy / 1000 / secs) });
  }
  const frames = ev.filter((e) => e.name === "PipelineReporter" && e.ph === "b").length;
  return { threads: out.filter((t) => t.busyMsPerSec >= 0.5).sort((a, b) => b.busyMsPerSec - a.busyMsPerSec).slice(0, 14), pipelineReporterFrames: frames };
}

export const TRACE_CATS = ["toplevel", "devtools.timeline", "disabled-by-default-devtools.timeline.frame", "cc", "viz", "gpu", "benchmark"];
