// `migrateV0` is total (plan §10.3, §7.2 step 12): arbitrary perturbations of the v0 fixtures —
// fields deleted, retyped or oversized, unknown enums, parentId cycles and orphans, duplicate order
// entries, extra keys — in any of the three stored shapes and either mode never throw, and every
// result passes both strict schemas, the invariants and the reference checks. The same input gives
// the same result twice, and `readV0` never throws or writes, whatever the stored strings hold.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { seededMinter } from "@/lib/domain/ids";
import { migrateV0, readV0, V0_BACKUP_KEY, V0_KEY } from "@/lib/migrate";
import { demoOptions, MANIFEST, problemsOf, readFixtureInput, spyStorage, storageOf } from "@/lib/migrate/__tests__/support";
import { unwrapV0 } from "@/lib/migrate/v0/schema";

type Path = (string | number)[];
type Json = unknown;

/** Every fixture's v0 document, as readV0 finds it */
const BASES = MANIFEST.map((e) => ({ name: e.name, doc: unwrapV0(readFixtureInput(e)!.raw).doc, log: unwrapV0(readFixtureInput(e)!.raw).log }));

function pathsOf(value: Json, path: Path = [], out: Path[] = []): Path[] {
  out.push(path);
  if (Array.isArray(value)) value.forEach((v, i) => pathsOf(v, [...path, i], out));
  else if (value !== null && typeof value === "object") for (const [k, v] of Object.entries(value)) pathsOf(v, [...path, k], out);
  return out;
}

function parentOf(root: { doc: Json }, path: Path): { holder: Record<string | number, Json>; key: string | number } {
  let holder = root as unknown as Record<string | number, Json>;
  let key: string | number = "doc";
  for (const step of path) {
    holder = holder[key] as Record<string | number, Json>;
    key = step;
  }
  return { holder, key };
}

const getAt = (root: { doc: Json }, path: Path): Json => {
  const { holder, key } = parentOf(root, path);
  return holder[key];
};
const setAt = (root: { doc: Json }, path: Path, value: Json) => {
  const { holder, key } = parentOf(root, path);
  holder[key] = value;
};

const isObj = (v: Json): v is Record<string, Json> => typeof v === "object" && v !== null && !Array.isArray(v);

type Mutation =
  | { kind: "delete"; at: number }
  | { kind: "retype"; at: number; value: Json }
  | { kind: "oversize"; at: number; size: number }
  | { kind: "enum"; at: number; text: string }
  | { kind: "cycle"; a: number; b: number }
  | { kind: "reparent"; a: number; b: number; missing: boolean }
  | { kind: "dupOrder"; a: number; times: number }
  | { kind: "addKey"; at: number; key: string; value: Json };

const oddValue = fc.oneof(
  fc.jsonValue({ maxDepth: 2 }),
  fc.anything({ maxDepth: 1 }),
  fc.constantFrom<Json>(null, undefined, Number.NaN, -0, Infinity, -1, 0.25, 1e12, "", "  ", "x".repeat(200), [], {}, true),
);

const mutationArb: fc.Arbitrary<Mutation> = fc.oneof(
  fc.record({ kind: fc.constant("delete" as const), at: fc.nat() }),
  fc.record({ kind: fc.constant("retype" as const), at: fc.nat(), value: oddValue }),
  fc.record({ kind: fc.constant("oversize" as const), at: fc.nat(), size: fc.integer({ min: 81, max: 3000 }) }),
  fc.record({ kind: fc.constant("enum" as const), at: fc.nat(), text: fc.string({ maxLength: 12 }) }),
  fc.record({ kind: fc.constant("cycle" as const), a: fc.nat(), b: fc.nat() }),
  fc.record({ kind: fc.constant("reparent" as const), a: fc.nat(), b: fc.nat(), missing: fc.boolean() }),
  fc.record({ kind: fc.constant("dupOrder" as const), a: fc.nat(), times: fc.integer({ min: 1, max: 3 }) }),
  fc.record({ kind: fc.constant("addKey" as const), at: fc.nat(), key: fc.string({ maxLength: 8 }), value: fc.jsonValue({ maxDepth: 1 }) }),
);

function taskKeys(doc: Json): string[] {
  return isObj(doc) && isObj(doc.tasks) ? Object.keys(doc.tasks) : [];
}

/** Applies one perturbation in place */
function mutate(root: { doc: Json }, m: Mutation): void {
  const doc = root.doc;
  switch (m.kind) {
    case "delete": {
      const paths = pathsOf(doc).filter((p) => p.length > 0);
      if (paths.length === 0) return;
      const path = paths[m.at % paths.length];
      const { holder, key } = parentOf(root, path);
      if (Array.isArray(holder)) holder.splice(Number(key), 1);
      else delete holder[key];
      return;
    }
    case "retype": {
      const paths = pathsOf(doc);
      setAt(root, paths[m.at % paths.length], m.value);
      return;
    }
    case "oversize": {
      const paths = pathsOf(doc);
      const path = paths[m.at % paths.length];
      const value = getAt(root, path);
      if (typeof value === "string") setAt(root, path, (value || "x").repeat(Math.ceil(m.size / Math.max(1, value.length))).slice(0, m.size));
      else if (typeof value === "number") setAt(root, path, value * 1e6 + m.size);
      else if (Array.isArray(value) && value.length > 0) {
        for (let i = 0; i < m.size % 300; i++) value.push(structuredClone(value[i % value.length]));
      } else if (isObj(value)) {
        const entries = Object.entries(value);
        for (let i = 0; i < m.size % 60 && entries.length > 0; i++) value[`x-${i}`] = structuredClone(entries[i % entries.length][1]);
      }
      return;
    }
    case "enum": {
      const paths = pathsOf(doc).filter((p) => typeof getAt(root, p) === "string");
      if (paths.length > 0) setAt(root, paths[m.at % paths.length], m.text);
      return;
    }
    case "cycle": {
      const keys = taskKeys(doc);
      if (keys.length === 0) return;
      const tasks = (doc as Record<string, Record<string, Json>>).tasks as Record<string, Record<string, Json>>;
      const a = keys[m.a % keys.length];
      const b = keys[m.b % keys.length];
      if (isObj(tasks[a])) tasks[a].parentId = b;
      if (isObj(tasks[b])) tasks[b].parentId = a;
      return;
    }
    case "reparent": {
      const keys = taskKeys(doc);
      if (keys.length === 0) return;
      const tasks = (doc as Record<string, Record<string, Json>>).tasks as Record<string, Record<string, Json>>;
      const a = keys[m.a % keys.length];
      if (isObj(tasks[a])) tasks[a].parentId = m.missing ? "t-missing" : keys[m.b % keys.length];
      return;
    }
    case "dupOrder": {
      if (!isObj(doc) || !Array.isArray(doc.order)) return;
      const order = doc.order as Json[];
      for (let i = 0; i < m.times; i++) order.push(order.length > 0 ? order[(m.a + i) % order.length] : "t-unknown");
      order.push("t-unknown");
      return;
    }
    case "addKey": {
      const paths = pathsOf(doc).filter((p) => isObj(getAt(root, p)));
      if (paths.length === 0) return;
      const target = getAt(root, paths[m.at % paths.length]) as Record<string, Json>;
      target[m.key] = m.value;
      return;
    }
  }
}

const SHAPES = ["envelope", "backup", "bare"] as const;

function wrap(shape: (typeof SHAPES)[number], doc: Json, log: Json): Json {
  if (shape === "envelope") return { state: { doc, log }, version: 1 };
  if (shape === "backup") return { doc, log };
  return doc;
}

const caseArb = fc.record({
  base: fc.nat({ max: BASES.length - 1 }),
  mutations: fc.array(mutationArb, { maxLength: 8 }),
  shape: fc.constantFrom(...SHAPES),
  mode: fc.constantFrom("demo" as const, "import" as const),
  includeSampleTeam: fc.boolean(),
  seed: fc.nat(),
});

describe("migrateV0 is total", () => {
  it("turns every perturbed v0 fixture into valid documents, the same way twice", () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const base = BASES[c.base];
        const root = { doc: structuredClone(base.doc) };
        for (const m of c.mutations) mutate(root, m);
        const raw = wrap(c.shape, root.doc, base.log);
        const options = () => demoOptions({ mode: c.mode, includeSampleTeam: c.includeSampleTeam, mint: seededMinter(c.seed) });

        const o = options();
        const result = migrateV0(raw, o);
        expect(problemsOf(result, o.workspace)).toEqual([]);
        expect(migrateV0(structuredClone(raw), options())).toEqual(result);
      }),
    );
  });
});

describe("readV0 is total and read-only", () => {
  const maps = MANIFEST.map((e) => storageOf(e));

  it("never throws or writes, whatever the stored strings hold, and what it finds migrates", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: maps.length - 1 }),
        fc.constantFrom(V0_KEY, V0_BACKUP_KEY),
        fc.oneof(
          fc.record({ kind: fc.constant("cut" as const), at: fc.nat() }),
          fc.record({ kind: fc.constant("junk" as const), text: fc.oneof(fc.string(), fc.json()) }),
          fc.record({ kind: fc.constant("remove" as const) }),
        ),
        (i, key, change) => {
          const initial = { ...maps[i] };
          const stored = initial[key];
          if (change.kind === "remove") delete initial[key];
          else if (change.kind === "junk") initial[key] = change.text;
          else if (stored !== undefined) initial[key] = stored.slice(0, change.at % (stored.length + 1));
          const storage = spyStorage(initial);

          const read = readV0(storage);
          if (read !== null) {
            const o = demoOptions({ source: read.source });
            expect(problemsOf(migrateV0(read.raw, o), o.workspace)).toEqual([]);
          }
          expect(storage.calls.every((c) => c.method === "getItem")).toBe(true);
          expect(Object.fromEntries(storage.values)).toEqual(initial);
        },
      ),
    );
  });
});
