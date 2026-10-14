// Recount union-typed and optional params with $ref resolution (expanding every reference site).
import { readFileSync } from "node:fs";
const s = JSON.parse(readFileSync(new URL("./schema.sent.json", import.meta.url)));
const resolve = (n) => (n && n.$ref ? s.$defs[n.$ref.split("/").pop()] : n);
let optional = 0, unionParams = [], visits = 0, maxDepth = 0;
const isUnion = (n) => !!(n && (n.anyOf || Array.isArray(n.type)));
const walk = (n, path, depth, stack) => {
  n = resolve(n); if (!n) return; visits++; maxDepth = Math.max(maxDepth, depth);
  if (n.anyOf) n.anyOf.forEach((b, i) => walk(b, `${path}|${i}`, depth + 1, stack));
  if (n.items) walk(n.items, `${path}[]`, depth + 1, stack);
  if (n.properties) {
    const req = new Set(n.required ?? []);
    for (const [k, v] of Object.entries(n.properties)) {
      if (!req.has(k)) optional++;
      const r = resolve(v);
      if (isUnion(r) || (r.items && isUnion(resolve(r.items)))) unionParams.push(`${path}.${k}`);
      walk(v, `${path}.${k}`, depth + 1, stack);
    }
  }
};
walk(s, "$", 0, []);
console.log("optional params (ref-expanded):", optional);
console.log("union-typed params (ref-expanded, incl. arrays of unions):", unionParams.length);
console.log(unionParams.join("\n"));
console.log("ops branches:", s.$defs.__schema0.anyOf.length);
