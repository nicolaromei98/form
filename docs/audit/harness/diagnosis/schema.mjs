const { createJiti } = await import("/Users/nicolaromei/code/form/node_modules/jiti/lib/jiti.mjs");
const jiti = createJiti(import.meta.url);
const { InterpretationSchema, OperationSchema } = await jiti.import("/Users/nicolaromei/code/form/src/lib/schema.ts");
const { z } = await jiti.import("/Users/nicolaromei/code/form/node_modules/zod/index.js");
const { betaZodOutputFormat } = await jiti.import("/Users/nicolaromei/code/form/node_modules/@anthropic-ai/sdk/helpers/beta/zod.js");
const raw = z.toJSONSchema(InterpretationSchema, { reused: "ref" });
const fmt = betaZodOutputFormat(InterpretationSchema);
const s = fmt.schema;
import fs from "node:fs";
fs.writeFileSync("interpretation.schema.json", JSON.stringify(s, null, 2));
let optional = 0, anyOfNodes = 0, unionProps = 0, props = 0, constraintsInRaw = {}, nullableUnions = 0, enums = 0;
const optList = [];
function walkRaw(n) { if (!n || typeof n !== "object") return; for (const k of ["minimum","maximum","exclusiveMinimum","exclusiveMaximum","minLength","maxLength","pattern","maxItems","minItems","format"]) if (k in n) constraintsInRaw[k] = (constraintsInRaw[k]||0)+1; for (const v of Object.values(n)) if (typeof v === "object") walkRaw(v); }
walkRaw(raw);
function walk(n, path) {
  if (!n || typeof n !== "object") return;
  if (Array.isArray(n)) { n.forEach((x,i)=>walk(x, path+"["+i+"]")); return; }
  if (n.anyOf) { anyOfNodes++; if (n.anyOf.some(v=>v.type==="null")) nullableUnions++; }
  if (n.enum) enums++;
  if (n.type === "object" && n.properties) {
    const req = new Set(n.required || []);
    for (const [k, v] of Object.entries(n.properties)) {
      props++;
      if (!req.has(k)) { optional++; optList.push(path + "." + k); }
      if (v.anyOf) unionProps++;
    }
  }
  for (const [k,v] of Object.entries(n)) if (typeof v === "object") walk(v, path + "." + k);
}
walk(s, "$");
const str = JSON.stringify(s);
console.log("bytes of compiled schema:", str.length);
console.log("operation variants:", OperationSchema.options.length);
console.log("properties total:", props, "| optional properties:", optional, "| properties whose schema is a union (anyOf):", unionProps, "| anyOf nodes total:", anyOfNodes, "(nullable unions:", nullableUnions + ")");
console.log("constraints in raw zod JSON schema:", JSON.stringify(constraintsInRaw));
console.log("constraints moved into descriptions by SDK transform:", (str.match(/\{(minimum|maximum|minLength|maxLength|pattern|maxItems|exclusiveMinimum)/g)||[]).length, "description strings containing '{min/max...'");
console.log("remaining minItems in compiled:", (str.match(/"minItems"/g)||[]).length, "| $ref:", (str.match(/\$ref/g)||[]).length, "| $defs:", Object.keys(s.$defs||{}).length);
console.log("optional list (first 40):\n " + optList.slice(0,60).join("\n "));
