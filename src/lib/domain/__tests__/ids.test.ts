import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  deriveId,
  fnv1a64Hex,
  ID_ALPHABET,
  ID_KINDS,
  ID_LENGTH,
  ID_PREFIX,
  idKindOf,
  idPattern,
  isId,
  nanoMinter,
  seededMinter,
  type IdKind,
} from "@/lib/domain/ids";
import { ID_SCHEMAS, PersonId, ProjectId, TaskId, WorkspaceId } from "@/lib/domain/schema/ids";

// FNV-1a 64-bit with BigInt: the plan's reference formulation (§3.1), used as an oracle
const FNV_OFFSET = BigInt("0xcbf29ce484222325");
const FNV_PRIME = BigInt("0x100000001b3");
const MASK_64 = (BigInt(1) << BigInt(64)) - BigInt(1);
function fnvReference(text: string): bigint {
  let h = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(text)) h = ((h ^ BigInt(byte)) * FNV_PRIME) & MASK_64;
  return h;
}

const BODY = /^[0-9a-z]{16}$/;
const bodyOf = (id: string) => id.slice(4);

describe("ID_PREFIX", () => {
  it("has 15 kinds with unique three-letter prefixes", () => {
    expect(ID_KINDS).toHaveLength(15);
    const prefixes = ID_KINDS.map((k) => ID_PREFIX[k]);
    expect(new Set(prefixes).size).toBe(15);
    for (const p of prefixes) expect(p).toMatch(/^[a-z]{3}$/);
  });

  it("has a schema for every kind", () => {
    expect(Object.keys(ID_SCHEMAS).sort()).toEqual([...ID_KINDS].sort());
  });
});

describe("id schemas", () => {
  it.each(ID_KINDS)("accept a minted %s id and reject other kinds", (kind) => {
    const id = nanoMinter(kind);
    expect(ID_SCHEMAS[kind].safeParse(id).success).toBe(true);
    for (const other of ID_KINDS) {
      if (other !== kind) expect(ID_SCHEMAS[other].safeParse(id).success).toBe(false);
    }
  });

  it("accept the demo's readable fixed ids", () => {
    expect(WorkspaceId.safeParse("wsp_demoworkspace").success).toBe(true);
    for (const id of ["per_demomarta", "per_demosara", "per_demoluca"]) expect(PersonId.safeParse(id).success).toBe(true);
  });

  it.each([
    ["no underscore", "tsk0123456789abcdef"],
    ["wrong prefix", "tks_0123456789abcdef"],
    ["uppercase body", "tsk_0123456789ABCDEF"],
    ["seven characters", "tsk_0123456"],
    ["thirty-three characters", `tsk_${"a".repeat(33)}`],
    ["a dash", "tsk_0123-56789abcdef"],
    ["a trailing newline", "tsk_0123456789abcdef\n"],
    ["empty", ""],
  ])("reject an id with %s", (_, id) => {
    expect(TaskId.safeParse(id).success).toBe(false);
    expect(isId("task", id)).toBe(false);
    expect(idKindOf(id)).toBeNull();
  });

  it("accept bodies of 8 and 32 characters", () => {
    expect(TaskId.safeParse(`tsk_${"a".repeat(8)}`).success).toBe(true);
    expect(TaskId.safeParse(`tsk_${"a".repeat(32)}`).success).toBe(true);
  });

  it("brand record keys: a record keyed by the wrong kind fails", () => {
    const byTask = z.record(TaskId, z.number());
    expect(byTask.safeParse({ tsk_0123456789abcdef: 1 }).success).toBe(true);
    expect(byTask.safeParse({ prj_0123456789abcdef: 1 }).success).toBe(false);
  });
});

describe("isId and idKindOf", () => {
  it.each(ID_KINDS)("agree with the %s schema", (kind) => {
    const id = seededMinter(7)(kind);
    expect(isId(kind, id)).toBe(true);
    expect(idKindOf(id)).toBe(kind);
    expect(idPattern(kind).test(id)).toBe(true);
  });

  it("agree with the schemas on arbitrary strings", () => {
    const candidate = fc.oneof(
      fc.string(),
      fc.tuple(fc.constantFrom(...ID_KINDS.map((k) => ID_PREFIX[k]), "xyz"), fc.string({ unit: fc.constantFrom(..."0123456789abcdefXY_-"), maxLength: 34 })).map(
        ([p, b]) => `${p}_${b}`,
      ),
    );
    fc.assert(
      fc.property(candidate, (s) => {
        for (const kind of ID_KINDS) expect(isId(kind, s)).toBe(ID_SCHEMAS[kind].safeParse(s).success);
        const kind = idKindOf(s);
        expect(kind === null ? ID_KINDS.every((k) => !isId(k, s)) : isId(kind, s)).toBe(true);
      }),
    );
  });

  it("reject non-strings", () => {
    expect(isId("task", 42)).toBe(false);
    expect(isId("task", null)).toBe(false);
  });
});

describe("nanoMinter", () => {
  it("mints a prefix and 16 characters of [0-9a-z]", () => {
    const id = nanoMinter("task");
    expect(id.startsWith("tsk_")).toBe(true);
    expect(bodyOf(id)).toMatch(BODY);
    expect(ID_LENGTH).toBe(16);
    expect(ID_ALPHABET).toBe("0123456789abcdefghijklmnopqrstuvwxyz");
  });

  it("mints 10,000 distinct ids that use the whole alphabet", () => {
    const ids = Array.from({ length: 10_000 }, () => nanoMinter("step"));
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids.flatMap((id) => [...bodyOf(id)])).size).toBe(36);
  });
});

describe("seededMinter", () => {
  it("mints the same sequence for the same seed", () => {
    const a = seededMinter(42);
    const b = seededMinter(42);
    const kinds: IdKind[] = ["task", "step", "person", "task", "moodItem"];
    expect(kinds.map((k) => a(k))).toEqual(kinds.map((k) => b(k)));
  });

  it("is stable across releases (fixtures and snapshots depend on it)", () => {
    const mint = seededMinter(1);
    expect([mint("task"), mint("task"), mint("project")]).toEqual(SEEDED_1);
  });

  it("mints different sequences for different seeds", () => {
    expect(seededMinter(1)("task")).not.toBe(seededMinter(2)("task"));
  });

  it("mints valid, distinct ids", () => {
    const mint = seededMinter(9);
    const ids = Array.from({ length: 5_000 }, () => mint("task"));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(TaskId.safeParse(id).success).toBe(true);
    expect(new Set(ids.flatMap((id) => [...bodyOf(id)])).size).toBe(36);
  });
});

// Pinned outputs: a change here changes every seeded fixture and every derived id
const SEEDED_1 = ["tsk_m0izyampfzgh5e85", "tsk_h2era61flsa7njr6", "prj_pgrz8r5be85qk491"];
const DERIVED = "tsk_00010b21dip7lwuv";

describe("fnv1a64Hex", () => {
  it.each([
    ["", "cbf29ce484222325"],
    ["a", "af63dc4c8601ec8c"],
    ["foobar", "85944171f73967e8"],
  ])("matches the published FNV-1a 64-bit vector for %j", (text, hex) => {
    expect(fnv1a64Hex(text)).toBe(hex);
  });

  it("matches a BigInt implementation on any text, including non-ASCII", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme", maxLength: 80 }), (text) => {
        expect(fnv1a64Hex(text)).toBe(fnvReference(text).toString(16).padStart(16, "0"));
      }),
    );
  });
});

describe("deriveId", () => {
  it("hashes `${salt}|${key}` into base 36, left-padded to 16", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), fc.string({ maxLength: 40 }), (salt, key) => {
        const id = deriveId("task", salt, key);
        expect(id).toBe(`tsk_${fnvReference(`${salt}|${key}`).toString(36).padStart(16, "0")}`);
        expect(TaskId.safeParse(id).success).toBe(true);
      }),
    );
  });

  it("is stable: the same inputs always derive the same id", () => {
    const salt = ProjectId.parse("prj_0123456789abcdef");
    expect(deriveId("task", salt, "tsk_fedcba9876543210")).toBe(deriveId("task", salt, "tsk_fedcba9876543210"));
    expect(deriveId("task", salt, "tsk_fedcba9876543210")).toBe(DERIVED);
  });

  it("depends on the kind's prefix only for the prefix", () => {
    const task = deriveId("task", "prj_a", "x");
    const step = deriveId("step", "prj_a", "x");
    expect(bodyOf(task)).toBe(bodyOf(step));
    expect(step.startsWith("stp_")).toBe(true);
  });

  it("separates salt and key", () => {
    expect(deriveId("task", "ab", "c")).not.toBe(deriveId("task", "a", "bc"));
    expect(deriveId("task", "prj_1", "tsk_a")).not.toBe(deriveId("task", "prj_2", "tsk_a"));
  });

  it("derives distinct ids for every task of a large project", () => {
    const mint = seededMinter(3);
    const salt = mint("project");
    const old = Array.from({ length: 2_000 }, () => mint("task"));
    expect(new Set(old.map((id) => deriveId("task", salt, id))).size).toBe(old.length);
  });
});
