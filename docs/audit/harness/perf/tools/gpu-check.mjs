import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--no-first-run", "--no-default-browser-check"] });
const p = await b.newPage();
await p.goto("about:blank");
const r = await p.evaluate(() => { const c = document.createElement("canvas"); const gl = c.getContext("webgl"); if (!gl) return "no webgl"; const e = gl.getExtension("WEBGL_debug_renderer_info"); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); });
console.log("UA:", await b.version(), "| WebGL renderer:", r);
const s = await p.target().createCDPSession();
try { const info = await (await b.target().createCDPSession()).send("SystemInfo.getInfo"); console.log("GPU:", JSON.stringify(info.gpu.devices.slice(0,2)), "featureStatus:", JSON.stringify(info.gpu.featureStatus).slice(0, 600)); } catch (e) { console.log("SystemInfo err", e.message); }
await b.close();
