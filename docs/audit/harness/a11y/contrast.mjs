// WCAG 2.x contrast with alpha compositing (sRGB, straight alpha, "over" operator).
// Usage: node contrast.mjs
const hex = (h, a = 1) => {
  h = h.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a };
};
const rgba = (r, g, b, a = 1) => ({ r, g, b, a });
// Composite fg over an opaque bg
const over = (fg, bg) => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
});
const lin = (c) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const L = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
const ratio = (a, b) => {
  const [x, y] = [L(a), L(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const toHex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

// A group (layer) at opacity o over an opaque backdrop: final = o*layerPixel + (1-o)*backdrop
// where layerPixel is the layer content composited on transparent. For a layer whose
// surface is semi-transparent, compute layer pixel = (content over surface) with alpha.
const layerOver = (content, surface) => {
  // premultiplied over of content onto a semi-transparent surface
  const a = content.a + surface.a * (1 - content.a);
  const mix = (k) => (content[k] * content.a + surface[k] * surface.a * (1 - content.a)) / a;
  return { r: mix("r"), g: mix("g"), b: mix("b"), a };
};
const withOpacity = (c, o) => ({ ...c, a: c.a * o });

const T = {
  text: hex("0a0a0a"),
  "text-2": rgba(10, 10, 10, 0.58),
  "text-3": rgba(10, 10, 10, 0.38),
  "text-4": rgba(10, 10, 10, 0.2),
  "on-ink": hex("f4f4f2"),
  "on-ink-2": rgba(244, 244, 242, 0.6),
  "on-ink-3": rgba(244, 244, 242, 0.34),
};

const paper = hex("e9e9e6");
const paperHi = hex("f2f2ef");
const paperLo = hex("dcdcd8");
const glassC = rgba(255, 255, 255, 0.52);
const glassHiC = rgba(250, 250, 248, 0.92);
const ink = hex("0a0a0a");
const inkCard = hex("0c0c0c");
const briefPaper = hex("fbfbf9");

const S = {
  "paper #e9e9e6": paper,
  "paper-hi #f2f2ef (ground centre)": paperHi,
  "paper-lo #dcdcd8 (ground edge)": paperLo,
  "glass on paper": over(glassC, paper),
  "glass on paper-lo": over(glassC, paperLo),
  "glass-hi on paper": over(glassHiC, paper),
  "brief sheet #fbfbf9": briefPaper,
  "board card (white 72%) on lane glass": over(rgba(255, 255, 255, 0.72), over(glassC, paper)),
  "chip (white 66%) on card glass": over(rgba(255, 255, 255, 0.66), over(glassC, paper)),
  "badge #f6f6f4": hex("f6f6f4"),
  "ink #0a0a0a": ink,
  "ink card #0c0c0c": inkCard,
  "ink-material darkest #090909": hex("090909"),
  "ink-material lightest (#161616 + 7.5% white)": over(rgba(255, 255, 255, 0.075), hex("161616")),
};

const out = [];
const row = (fgName, fg, bgName, bg) => {
  const eff = fg.a < 1 ? over(fg, bg) : fg;
  const r = ratio(eff, bg);
  out.push({ fg: fgName, bg: bgName, fgEff: toHex(eff), bgEff: toHex(bg), ratio: +r.toFixed(2), "4.5": r >= 4.5 ? "pass" : "FAIL", "3.0": r >= 3 ? "pass" : "FAIL" });
};

console.log("== Effective surfaces ==");
for (const [k, v] of Object.entries(S)) console.log(k.padEnd(48), toHex(v));

const lightSurfaces = Object.keys(S).filter((k) => !k.startsWith("ink"));
const darkSurfaces = Object.keys(S).filter((k) => k.startsWith("ink"));

console.log("\n== Text tokens on light surfaces ==");
for (const t of ["text", "text-2", "text-3", "text-4"]) for (const s of lightSurfaces) row(t, T[t], s, S[s]);
console.log("\n== On-ink tokens on dark surfaces ==");
for (const t of ["on-ink", "on-ink-2", "on-ink-3"]) for (const s of darkSurfaces) row(t, T[t], s, S[s]);

console.log("\n== Signal red ==");
const signal = hex("ff3b2f");
for (const s of [...lightSurfaces]) row("signal #ff3b2f", signal, s, S[s]);
for (const s of darkSurfaces.slice(0, 2)) row("signal #ff3b2f", signal, s, S[s]);
console.table(out);

// ---- Dimmed tasks: whole card group at opacity o over its backdrop ----
const dimRows = [];
const dim = (label, content, surface, o, backdrop) => {
  const layerText = layerOver(content, surface); // pixel inside a glyph
  const layerBg = surface; // pixel outside glyphs
  const fgFinal = over(withOpacity(layerText, o), backdrop);
  const bgFinal = over(withOpacity(layerBg, o), backdrop);
  const r = ratio(fgFinal, bgFinal);
  dimRows.push({ case: label, fg: toHex(fgFinal), bg: toHex(bgFinal), ratio: +r.toFixed(2), "4.5": r >= 4.5 ? "pass" : "FAIL", "3.0": r >= 3 ? "pass" : "FAIL" });
};
const laneBg = over(glassC, paper);
for (const t of ["text", "text-2", "text-3"]) {
  dim(`tracker card 55%: ${t}`, T[t], glassC, 0.55, paper);
  dim(`board card 55%: ${t}`, T[t], rgba(255, 255, 255, 0.72), 0.55, laneBg);
}
dim("emphasised (ink) card dimmed? n/a (emphasis never dims)", T["on-ink"], hex("0c0c0c"), 1, paper);
dim("team segment 50%: text on white 90% over track #e9e9e7", T.text, rgba(255, 255, 255, 0.9), 0.5, hex("e9e9e7"));
dim("team segment 50%: text-3 on white 90%", T["text-3"], rgba(255, 255, 255, 0.9), 0.5, hex("e9e9e7"));
dim("timeline bar 50%: text-2 % label on bar 7.5% ink", T["text-2"], rgba(10, 10, 10, 0.075), 0.5, laneBg);
dim("timeline bar 50%: on-ink % inside ink fill", T["on-ink"], ink, 0.5, laneBg);
dim("team segment 'leaving' 40%: text on white 90%", T.text, rgba(255, 255, 255, 0.9), 0.4, hex("e9e9e7"));
console.log("\n== Dimmed task surfaces (group opacity) ==");
console.table(dimRows);

// ---- Placeholders & misc ----
const misc = [];
const m = (label, fg, bg) => {
  const eff = fg.a < 1 ? over(fg, bg) : fg;
  const r = ratio(eff, bg);
  misc.push({ case: label, fg: toHex(eff), bg: toHex(bg), ratio: +r.toFixed(2), "4.5": r >= 4.5 ? "pass" : "FAIL", "3.0": r >= 3 ? "pass" : "FAIL" });
};
m("composer placeholder on-ink-3 / ink-material darkest", T["on-ink-3"], hex("090909"));
m("composer placeholder on-ink-3 / ink-material lightest", T["on-ink-3"], S["ink-material lightest (#161616 + 7.5% white)"]);
const pickerField = over(rgba(0, 0, 0, 0.05), S["glass-hi on paper"]);
m("colour-name placeholder 38% / black 5% on glass-hi", rgba(10, 10, 10, 0.38), pickerField);
m("[contenteditable] placeholder text-3 / glass", T["text-3"], S["glass on paper"]);
m("note placeholder text-4 / glass-hi note", T["text-4"], S["glass-hi on paper"]);
const editorBg = over(rgba(0, 0, 0, 0.04), briefPaper);
m("brief editor placeholder text-4 / black 4% on #fbfbf9", T["text-4"], editorBg);
m("command-sheet hint text-4 / glass-hi (not a disabled control)", T["text-4"], S["glass-hi on paper"]);
m("timeline weekend day number text-4 / glass", T["text-4"], S["glass on paper"]);
m("timeline weekend day text-4 / glass + weekend band 2.2%", T["text-4"], over(rgba(10, 10, 10, 0.022), S["glass on paper"]));
m("plan card on-ink/50 eyebrow / ink", rgba(244, 244, 242, 0.5), ink);
m("plan card on-ink/60 body / ink", rgba(244, 244, 242, 0.6), ink);
m("team segment on-ink/60 / ink", rgba(244, 244, 242, 0.6), ink);
m("intro chips text-2 / black 5% on glass-hi", T["text-2"], over(rgba(0, 0, 0, 0.05), S["glass-hi on paper"]));
m("progress-block label text-2 / black 7% on glass", T["text-2"], over(rgba(0, 0, 0, 0.07), S["glass on paper"]));
m("Today tag on-ink / ink", T["on-ink"], ink);
console.log("\n== Placeholders and specific spots ==");
console.table(misc);

// ---- Non-text (1.4.11) ----
const nt = [];
const n = (label, fg, bg) => {
  const eff = fg.a < 1 ? over(fg, bg) : fg;
  const r = ratio(eff, bg);
  nt.push({ case: label, fg: toHex(eff), bg: toHex(bg), ratio: +r.toFixed(2), "3.0": r >= 3 ? "pass" : "FAIL" });
};
const cardGlass = S["glass on paper"];
n("priority dot OFF ring 15% ink / card glass", rgba(10, 10, 10, 0.15), cardGlass);
n("priority dot ON (ink) / card glass", ink, cardGlass);
n("priority dot ON (on-ink) / ink card", T["on-ink"], inkCard);
n("priority dot OFF ring white 22% / ink card", rgba(255, 255, 255, 0.22), inkCard);
n("urgent dot #ff3b2f / card glass", signal, cardGlass);
n("urgent dot #ff3b2f / board card", signal, S["board card (white 72%) on lane glass"]);
n("urgent dot #ff3b2f / timeline bar (7.5% ink on glass)", signal, over(rgba(10, 10, 10, 0.075), cardGlass));
n("urgent dot #ff3b2f / ink card", signal, inkCard);
n("badge urgent dot #ff3b2f / badge #f6f6f4", signal, hex("f6f6f4"));
n("metrics urgent dot #ff3b2f / glass", signal, cardGlass);
n("stale-line dot #ff3b2f / brief sheet", signal, briefPaper);
n("avatar over ring #ff3b2f / paper offset", signal, paper);
n("over-capacity hatch dark stripe rgba(214,69,69,.2) / glass", rgba(214, 69, 69, 0.2), cardGlass);
n("progress track 8% / card glass (unfilled)", rgba(10, 10, 10, 0.08), cardGlass);
n("progress fill ink / track", ink, over(rgba(10, 10, 10, 0.08), cardGlass));
n("switch OFF track black 9% / glass (header sits on paper)", rgba(0, 0, 0, 0.09), paper);
n("switch OFF knob white / its track", hex("ffffff"), over(rgba(0, 0, 0, 0.09), paper));
n("editable :focus ring 1px 14% ink / white 92% fill", rgba(10, 10, 10, 0.14), over(rgba(255, 255, 255, 0.92), cardGlass));
n("editable :focus fill white 92% / card glass (fill change only)", over(rgba(255, 255, 255, 0.92), cardGlass), cardGlass);
n("hex/name input :focus bg 8% vs 5% black (focus cue)", over(rgba(0, 0, 0, 0.08), S["glass-hi on paper"]), over(rgba(0, 0, 0, 0.05), S["glass-hi on paper"]));
n(".focus-ring ink 1.5px / paper gap", ink, paper);
n(".focus-ring-ink white 70% / ink", rgba(255, 255, 255, 0.7), ink);
n("caption 'clarify' dashed ring text-3 / glass-hi", T["text-3"], S["glass-hi on paper"]);
n("unsized/leaving segment dashed border text-3 / white 90%", T["text-3"], over(rgba(255, 255, 255, 0.9), hex("e9e9e7")));
n("plan-preview dashed border ink / track", ink, hex("e9e9e7"));
n("selected outline ink / paper", ink, paper);
console.log("\n== Non-text contrast (1.4.11) ==");
console.table(nt);

// ---- Proposed tokens ----
const prop = [];
const p = (label, fg, bgName) => {
  const bg = S[bgName] ?? bgName;
  const eff = fg.a < 1 ? over(fg, bg) : fg;
  const r = ratio(eff, bg);
  prop.push({ token: label, bg: typeof bgName === "string" ? bgName : toHex(bg), fgEff: toHex(eff), ratio: +r.toFixed(2), "4.5": r >= 4.5 ? "pass" : "FAIL", "3.0": r >= 3 ? "pass" : "FAIL" });
};
// minimum ink alpha for 4.5:1 on each light surface
const minAlpha = (base, bg, target) => {
  for (let a = 0; a <= 1.0001; a += 0.005) if (ratio(over({ ...base, a }, bg), bg) >= target) return +a.toFixed(3);
  return null;
};
console.log("\n== Minimum alpha for #0a0a0a to reach 4.5:1 / 3:1 ==");
for (const s of lightSurfaces) console.log(s.padEnd(48), "4.5:", minAlpha(T.text, S[s], 4.5), "  3:", minAlpha(T.text, S[s], 3));
console.log("\n== Minimum alpha for #f4f4f2 on dark surfaces ==");
for (const s of darkSurfaces) console.log(s.padEnd(48), "4.5:", minAlpha(T["on-ink"], S[s], 4.5), "  3:", minAlpha(T["on-ink"], S[s], 3));

const NEW = {
  "text-2 → 0.72": rgba(10, 10, 10, 0.72),
  "text-3 → 0.62": rgba(10, 10, 10, 0.62),
  "text-3 → 0.64": rgba(10, 10, 10, 0.64),
  "text-4 → 0.46 (non-text/disabled only)": rgba(10, 10, 10, 0.46),
  "on-ink-2 → 0.74": rgba(244, 244, 242, 0.74),
  "on-ink-3 → 0.58": rgba(244, 244, 242, 0.58),
  "signal-text #c0221a": hex("c0221a"),
  "signal-text #b81f17": hex("b81f17"),
  "signal (graphic) #e8261b": hex("e8261b"),
  "signal (graphic) #ff3b2f": hex("ff3b2f"),
};
for (const [k, v] of Object.entries(NEW)) {
  const bgs = k.startsWith("on-ink") ? darkSurfaces : lightSurfaces;
  for (const s of bgs) p(k, v, s);
}
console.log("\n== Proposed tokens ==");
console.table(prop);

// Proposed values under the dim-the-surface-not-the-text rule
const dim2 = [];
const d2 = (label, content, surfaceA, backdrop) => {
  const bg = over(surfaceA, backdrop);
  const fg = over(content, bg);
  const r = ratio(fg, bg);
  dim2.push({ case: label, fg: toHex(fg), bg: toHex(bg), ratio: +r.toFixed(2), "4.5": r >= 4.5 ? "pass" : "FAIL" });
};
d2("v1 rule: surface at 55% (white 28.6%), text-2 0.72 full", rgba(10, 10, 10, 0.72), rgba(255, 255, 255, 0.286), paper);
d2("v1 rule: surface at 55%, text-3 0.62 full", rgba(10, 10, 10, 0.62), rgba(255, 255, 255, 0.286), paper);
d2("alt: text dims to 0.62 alpha (title), surface 55%", rgba(10, 10, 10, 0.62), rgba(255, 255, 255, 0.286), paper);
console.log("\n== Proposed dim rule ==");
console.table(dim2);
