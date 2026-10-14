#!/usr/bin/env node
// Q14 contrast check (plan §9.2, AUDIT §12.1). It reads the colour tokens from src/app/globals.css
// and the dimmed-surface constants from the components, composites them over every surface they
// sit on (sRGB, straight alpha, "over"), and checks the WCAG 2.x ratio: 4.5:1 for text, 3:1 for
// graphics and meaningful strokes. Unlike contrast.mjs (the Phase 0 evidence, with v0's values
// written in), nothing here is a copy: a token or constant that moves is measured as it is.
//
//   node scripts/audit/a11y/q14.mjs           tables, then a verdict; exits 1 when a check fails
//   node scripts/audit/a11y/q14.mjs --json    the rows as JSON
//
// Effective surfaces as in AUDIT §12.1. Translucent surfaces are measured over both ends of the
// ground gradient that matter, paper and paper-lo (the darker edge). Backdrop blur and the 7.5%
// dot grid are ignored, as in the audit.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel) => readFileSync(join(REPO, rel), "utf8");

/* ------------------------------------------------------------------ */
/* Colour maths                                                        */
/* ------------------------------------------------------------------ */

/** "#rrggbb" or "rgba(r, g, b, a)" → { r, g, b, a } */
export function parseColour(text) {
  const s = text.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (fn) return { r: +fn[1], g: +fn[2], b: +fn[3], a: fn[4] === undefined ? 1 : +fn[4] };
  throw new Error(`Not a colour this check can read: "${text}"`);
}

/** fg composited over an opaque bg */
export const over = (fg, bg) => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
});

const channel = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (c) => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);

/** WCAG 2.x contrast ratio of two opaque colours */
export function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const toHex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/* ------------------------------------------------------------------ */
/* Sources                                                             */
/* ------------------------------------------------------------------ */

/** The custom properties declared in one rule of globals.css (the first rule with that selector). */
function block(css, selector) {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`globals.css has no "${selector}" rule`);
  const body = css.slice(at, css.indexOf("}", at));
  const props = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) props[m[1]] = m[2].trim();
  return props;
}

/** A tone's tokens: its own declarations over :root, with var() resolved. */
function resolver(...scopes) {
  const merged = Object.assign({}, ...scopes);
  const get = (name, seen = new Set()) => {
    if (seen.has(name)) throw new Error(`Cyclic token ${name}`);
    seen.add(name);
    const value = merged[name];
    if (value === undefined) throw new Error(`Token ${name} is not declared`);
    const v = /^var\((--[\w-]+)\)$/.exec(value);
    return v ? get(v[1], seen) : parseColour(value);
  };
  return get;
}

/** A `const NAME = "<colour>"` in a component: the surfaces the components draw with. */
function constant(file, name) {
  const m = new RegExp(`const ${name} = "([^"]+)"`).exec(read(file));
  if (!m) throw new Error(`${file} declares no ${name}: the check reads its dimmed surfaces from there`);
  return parseColour(m[1]);
}

/* ------------------------------------------------------------------ */
/* The checks                                                          */
/* ------------------------------------------------------------------ */

export function run() {
  const css = read("src/app/globals.css");
  const root = block(css, ":root");
  const tok = resolver(root);
  const light = resolver(root, block(css, ".tone-light"));
  const dark = resolver(root, block(css, ".tone-dark"));

  const TASK = "src/components/workspace/TaskCard.tsx";
  const BOARD = "src/components/workspace/BoardView.tsx";
  const TEAM = "src/components/workspace/TeamView.tsx";
  const TIMELINE = "src/components/workspace/TimelineView.tsx";

  const white = (a) => ({ r: 255, g: 255, b: 255, a });
  const black = (a) => ({ r: 0, g: 0, b: 0, a });

  // Grounds
  const paper = tok("--paper");
  const paperLo = tok("--paper-lo");
  const grounds = { paper, "paper-lo": paperLo };

  // Light surfaces a text token can sit on, each over both grounds when it is translucent
  const S = {};
  const add = (name, colour) => (S[name] = colour);
  add("paper", paper);
  add("paper-hi", tok("--paper-hi"));
  add("paper-lo", paperLo);
  for (const [g, ground] of Object.entries(grounds)) {
    const glass = over(tok("--glass"), ground);
    add(`glass/${g}`, glass);
    add(`glass-hi/${g}`, over(tok("--glass-hi"), ground));
    add(`board card/${g}`, over(constant(BOARD, "CARD"), glass));
    add(`dimmed card/${g}`, over(constant(TASK, "GLASS_DIM"), ground));
    add(`dimmed board card/${g}`, over(constant(BOARD, "CARD_DIM"), glass));
    add(`timeline track/${g}`, over(constant(TIMELINE, "TRACK"), glass));
    add(`dimmed timeline track/${g}`, over(constant(TIMELINE, "TRACK_DIM"), glass));
  }
  add("sheet #fbfbf9", parseColour("#fbfbf9"));
  add("badge #f6f6f4", parseColour("#f6f6f4"));
  // Team segments sit on the capacity lane (#e9e9e7), or past it on glass or the hatch
  const lane = parseColour("#e9e9e7");
  const hatch = over(parseColour("rgba(214, 69, 69, 0.2)"), over(tok("--glass"), paperLo));
  for (const [n, base] of Object.entries({ lane, hatch })) {
    add(`segment/${n}`, over(constant(TEAM, "SEG"), base));
    add(`dimmed segment/${n}`, over(constant(TEAM, "SEG_DIM"), base));
    add(`leaving segment/${n}`, over(constant(TEAM, "SEG_LEAVING"), base));
  }

  // Dark surfaces
  const D = {
    ink: tok("--ink"),
    "ink card #0c0c0c": parseColour("#0c0c0c"),
    "ink-material darkest #090909": parseColour("#090909"),
    "ink-material lightest": over(white(0.075), parseColour("#161616")),
  };

  const rows = [];
  const check = (group, what, fg, bgName, bg, min) => {
    const shown = fg.a < 1 ? over(fg, bg) : fg;
    const r = ratio(shown, bg);
    rows.push({ group, what, on: bgName, fg: toHex(shown), bg: toHex(bg), ratio: Math.floor(r * 100) / 100, min, pass: r >= min });
  };
  const everyLight = (group, what, fg, min, filter = () => true) => {
    for (const [name, bg] of Object.entries(S)) if (filter(name)) check(group, what, fg, name, bg, min);
  };

  // 1. Text tokens on every light surface: 4.5:1
  for (const t of ["--text", "--text-2", "--text-3"]) everyLight("text", t, light(t), 4.5);
  everyLight("text", "--signal-text (.tone-light)", light("--signal-text"), 4.5);
  // 2. Text tokens on ink: 4.5:1
  for (const t of ["--on-ink", "--on-ink-2", "--on-ink-3"]) for (const [n, bg] of Object.entries(D)) check("text on ink", t, dark(t), n, bg, 4.5);
  for (const n of ["ink", "ink card #0c0c0c"]) check("text on ink", "--signal-text (.tone-dark)", dark("--signal-text"), n, D[n], 4.5);

  // 3. Graphics and meaningful strokes: 3:1
  everyLight("graphic", "--line-strong", tok("--line-strong"), 3, (n) => !n.includes("track"));
  everyLight("graphic", "--signal-graphic", tok("--signal-graphic"), 3, (n) => !n.includes("segment") && !n.startsWith("dimmed"));
  // --signal stays where it already passes: glass, glass-hi, the sheet, cards, the badge and ink
  everyLight("graphic", "--signal (dots on glass and cards)", tok("--signal"), 3, (n) => /^(glass|glass-hi|board card|segment)\/|^(sheet|badge)/.test(n));
  check("graphic", "--signal (dots on ink)", tok("--signal"), "ink card #0c0c0c", D["ink card #0c0c0c"], 3);
  everyLight("graphic", ".tone-light --c-dot-off (priority off ring)", light("--c-dot-off"), 3, (n) => /^(glass|board card|dimmed)/.test(n));
  check("graphic", ".tone-dark --c-dot-off (priority off ring)", dark("--c-dot-off"), "ink card #0c0c0c", D["ink card #0c0c0c"], 3);

  // 4. Specific spots (AUDIT §12.1 call sites)
  const spot = (what, fg, bgName, bg, min) => check("spot", what, fg, bgName, bg, min);
  for (const [g, ground] of Object.entries(grounds)) {
    const glassHi = over(tok("--glass-hi"), ground);
    const glass = over(tok("--glass"), ground);
    spot("CommandSheet hint (text-3)", light("--text-3"), `glass-hi/${g}`, glassHi, 4.5);
    spot("note placeholder (text-3)", light("--text-3"), `glass-hi/${g}`, glassHi, 4.5);
    spot("colour-name placeholder (text-3)", light("--text-3"), `black 5% field on glass-hi/${g}`, over(black(0.05), glassHi), 4.5);
    spot("weekend day number (text-3)", light("--text-3"), `weekend band 2.2% on glass/${g}`, over(parseColour("rgba(10, 10, 10, 0.022)"), glass), 4.5);
    spot("timeline % label (text-2) on a dimmed track", light("--text-2"), `dimmed timeline track/${g}`, S[`dimmed timeline track/${g}`], 4.5);
    spot("switch off track (--line-strong) vs paper", tok("--line-strong"), g, ground, 3);
    spot("switch knob (white) vs its off track", white(1), `--line-strong on ${g}`, over(tok("--line-strong"), ground), 3);
    const editFill = over(white(0.92), glass);
    spot("editable focus ring (--c-line-strong) vs its fill", light("--c-line-strong"), `white 92% on glass/${g}`, editFill, 3);
    spot("colour-picker focus ring (--line-strong) vs the panel", tok("--line-strong"), `glass-hi/${g}`, glassHi, 3);
    spot("avatar over ring (--signal-graphic) vs its paper offset", tok("--signal-graphic"), g, ground, 3);
    spot("timeline proposal border (--line-strong)", tok("--line-strong"), `glass/${g}`, glass, 3);
    spot("timeline urgent dot (--signal-graphic) on the track", tok("--signal-graphic"), `timeline track/${g}`, S[`timeline track/${g}`], 3);
  }
  spot("brief editor placeholder (text-3)", light("--text-3"), "black 4% on the sheet", over(black(0.04), parseColour("#fbfbf9")), 4.5);
  for (const n of ["lane", "hatch"]) {
    spot("segment state border (--line-strong)", tok("--line-strong"), `leaving segment/${n}`, S[`leaving segment/${n}`], 3);
    spot("segment state border (--line-strong)", tok("--line-strong"), `segment/${n}`, S[`segment/${n}`], 3);
  }
  const inkCard = D["ink card #0c0c0c"];
  spot("editable focus ring (.tone-dark --c-line-strong) vs the ink card", dark("--c-line-strong"), "ink card #0c0c0c", inkCard, 3);
  spot("composer placeholder (--on-ink-3)", tok("--on-ink-3"), "ink-material darkest #090909", D["ink-material darkest #090909"], 4.5);
  spot("composer placeholder (--on-ink-3)", tok("--on-ink-3"), "ink-material lightest", D["ink-material lightest"], 4.5);
  spot("ink segment figures (on-ink 60%)", parseColour("rgba(244, 244, 242, 0.6)"), "ink segment", constant(TEAM, "SEG_INK"), 4.5);
  spot("timeline % inside the ink fill (on-ink)", tok("--on-ink"), "ink", tok("--ink"), 4.5);

  return { rows, failures: rows.filter((r) => !r.pass) };
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { rows, failures } = run();
  if (process.argv.includes("--json")) console.log(JSON.stringify({ rows, failures }, null, 2));
  else {
    for (const group of [...new Set(rows.map((r) => r.group))]) {
      console.log(`\n== ${group} ==`);
      const list = rows.filter((r) => r.group === group);
      for (const what of [...new Set(list.map((r) => r.what))]) {
        const of = list.filter((r) => r.what === what);
        const lo = of.reduce((m, r) => (r.ratio < m.ratio ? r : m));
        const hi = of.reduce((m, r) => (r.ratio > m.ratio ? r : m));
        const bad = of.filter((r) => !r.pass);
        console.log(
          `${bad.length ? "FAIL" : "pass"}  ${what.padEnd(58)} ≥ ${of[0].min}:1  min ${lo.ratio.toFixed(2)} (${lo.on})  max ${hi.ratio.toFixed(2)}  ·  ${of.length} surface${of.length === 1 ? "" : "s"}`,
        );
        for (const r of bad) console.log(`      ${r.ratio.toFixed(2)} on ${r.on} (${r.fg} on ${r.bg})`);
      }
    }
    console.log(`\n${rows.length} checks, ${failures.length} failing`);
  }
  process.exit(failures.length ? 1 : 0);
}
