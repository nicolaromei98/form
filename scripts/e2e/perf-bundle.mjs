#!/usr/bin/env node
// Bundles e2e/perf/bench.ts for the browser (plan §11 step 19): rolldown resolves the engine's
// sources (the `@/` alias) into one IIFE that sets `window.__bench`, and Next's own SWC minifier
// compresses and mangles it as the production build does, so the browser runs the engine as
// /demo ships it.
//
//   node scripts/e2e/perf-bundle.mjs [out]      default e2e/.out/perf/bench.js
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(REPO, "package.json"));
const out = resolve(process.argv[2] ?? join(REPO, "e2e/.out/perf/bench.js"));

const bundle = await rolldown({
  input: join(REPO, "e2e/perf/bench.ts"),
  platform: "browser",
  resolve: { alias: { "@": join(REPO, "src") } },
  transform: { define: { "process.env.NODE_ENV": JSON.stringify("production") } },
  logLevel: "warn",
});
const { output } = await bundle.generate({ format: "iife", name: "__bench" });
await bundle.close();

const swc = require("next/dist/build/swc");
await swc.loadBindings();
const min = await swc.minify(output[0].code, { compress: true, mangle: true });

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, min.code);
console.log(`${relative(REPO, out)}: ${(output[0].code.length / 1000).toFixed(1)} KB bundled, ${(min.code.length / 1000).toFixed(1)} KB minified`);
