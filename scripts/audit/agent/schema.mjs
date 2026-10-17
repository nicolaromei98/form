// Phase 0 audit: compute the JSON Schema the Claude route actually sends, and count complexity features.
// Writes schema.raw.json and schema.sent.json next to this script (recount.mjs reads the latter).
import { writeFileSync } from "node:fs";
import { createJiti } from "jiti";
import { LIB, ROOT, SRC } from "../paths.mjs";
const jiti = createJiti(ROOT, { alias: { "@": SRC } });
const schemaMod = await jiti.import(LIB + "schema.ts");
const z = await jiti.import("zod/v4");
const { betaZodOutputFormat } = await jiti.import("@anthropic-ai/sdk/helpers/beta/zod");

const raw = z.toJSONSchema(schemaMod.InterpretationSchema, { reused: "ref" });
const sent = betaZodOutputFormat(schemaMod.InterpretationSchema).schema;
writeFileSync(new URL("./schema.raw.json", import.meta.url), JSON.stringify(raw, null, 2));
writeFileSync(new URL("./schema.sent.json", import.meta.url), JSON.stringify(sent, null, 2));

function count(root) {
  const c = { objects: 0, properties: 0, optionalProps: 0, optionalPaths: [], anyOf: 0, anyOfBranches: 0, oneOf: 0, allOf: 0, nullableUnions: 0,
    enum: 0, const: 0, minimum: 0, maximum: 0, exclusiveMinimum: 0, exclusiveMaximum: 0, minLength: 0, maxLength: 0, pattern: 0,
    minItems: 0, maxItems: 0, minItemsGt1: 0, format: 0, refs: 0, defs: 0, descWithConstraint: 0, additionalPropsFalse: 0, default: 0, unionParamPaths: [] };
  const walk = (n, path) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    if (n.$ref) c.refs++;
    if (n.$defs) c.defs += Object.keys(n.$defs).length;
    if (n.type === "object" || n.properties) {
      c.objects++;
      const props = Object.keys(n.properties ?? {});
      c.properties += props.length;
      const req = new Set(n.required ?? []);
      for (const p of props) if (!req.has(p)) { c.optionalProps++; c.optionalPaths.push(`${path}.${p}`); }
      for (const p of props) { const ps = n.properties[p]; if (ps && (ps.anyOf || ps.oneOf || Array.isArray(ps.type))) c.unionParamPaths.push(`${path}.${p}`); }
      if (n.additionalProperties === false) c.additionalPropsFalse++;
    }
    if (n.anyOf) { c.anyOf++; c.anyOfBranches += n.anyOf.length; if (n.anyOf.some((b) => b.type === "null")) c.nullableUnions++; }
    if (n.oneOf) c.oneOf++;
    if (n.allOf) c.allOf++;
    for (const k of ["enum","const","minimum","maximum","exclusiveMinimum","exclusiveMaximum","minLength","maxLength","pattern","minItems","maxItems","format","default"]) if (k in n) c[k]++;
    if ("minItems" in n && n.minItems > 1) c.minItemsGt1++;
    if (typeof n.description === "string" && /^\{|\n\n\{/.test(n.description)) c.descWithConstraint++;
    for (const [k, v] of Object.entries(n)) if (typeof v === "object") walk(v, k === "properties" ? path : `${path}.${k}`);
  };
  walk(root, "$");
  return c;
}
const summarize = (c) => ({ ...c, optionalPaths: c.optionalPaths.length, unionParamPaths: c.unionParamPaths.length });
const rc = count(raw), sc = count(sent);
console.log("RAW z.toJSONSchema:", JSON.stringify(summarize(rc)));
console.log("SENT (betaZodOutputFormat):", JSON.stringify(summarize(sc)));
console.log("sent bytes:", JSON.stringify(sent).length, " ~tokens:", Math.round(JSON.stringify(sent).length / 4));
console.log("optional paths (sent):\n  " + sc.optionalPaths.join("\n  "));
console.log("union-typed params (sent):\n  " + sc.unionParamPaths.join("\n  "));
// discriminator check
const opsItems = sent.properties.ops.items;
console.log("ops.items keys:", Object.keys(opsItems), " branches:", (opsItems.anyOf ?? []).length);
console.log("first branch:", JSON.stringify(opsItems.anyOf?.[0]));
console.log("top-level props:", JSON.stringify(sent.properties.tone), JSON.stringify(sent.properties.control), JSON.stringify(sent.properties.message));
// recursion check: any $ref pointing at an ancestor?
console.log("$defs keys:", Object.keys(sent.$defs ?? {}), "refs:", JSON.stringify(sent).match(/"\$ref":"[^"]+"/g));
