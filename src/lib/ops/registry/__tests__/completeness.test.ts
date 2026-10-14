// The registry completeness test (plan §4.3). It fails when an op file, the registry, the TS
// union, the samples, the exemptions, the transport list, the palette, the spawners, the v0
// names, the property generators or the unit tests drift apart.
//
// Stubs (step 9 ships all 66 files; `registry/README.md`) skip the full-op checks while
// FORM_PHASE ≤ their `until`, so Phase 1 must fill them all; codes and names whose only producer
// is still a stub are exempt for the same reason, and stop being exempt as soon as it's filled.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { seededMinter } from "@/lib/domain/ids";
import { FORM_PHASE } from "@/lib/phase";
import { composeCaption } from "@/lib/ops/caption";
import { makeCaptionEnv } from "@/lib/ops/caption-env";
import { LOCAL_INTENTS } from "@/lib/ops/local-intents";
import { paletteEntries } from "@/lib/ops/palette";
import { applyOp } from "@/lib/ops/reduce";
import { type AnyOpDef, OP_NAMES, type OpName, REGISTRY } from "@/lib/ops/registry";
import {
  type Exempt,
  FIXTURE_NAMES,
  isExempt,
  PALETTE_GROUPS,
  REJECT_CODES,
  type RejectCode,
  V0_OP_NAMES,
  type V0OpName,
} from "@/lib/ops/registry/_contract";
import { TRANSPORT_TOOLS, type TransportTool, UNCLAIMED_TOOLS } from "@/lib/ops/transport";
import { FIXTURE_TODAY } from "../../../../../test/fixtures/v2/build";
import { docsOf, namedFixture } from "../../../../../test/fixtures/v2/named";
import { LEGACY_OP_NAMES } from "../../../../../test/legacy/lower";
import { GENERATORS } from "../../../../../test/property/gen";
import { reduceCtx } from "./support";

const ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const REGISTRY_DIR = join(ROOT, "src/lib/ops/registry");
const GEN_DIR = join(ROOT, "test/property/gen");
const PALETTE_TEST = join(ROOT, "test/golden/palette.test.ts");

const defs: AnyOpDef[] = OP_NAMES.map((n) => REGISTRY.get(n)!);
const isStub = (d: AnyOpDef) => d.stub !== undefined;
const stubAllowed = (d: AnyOpDef) => d.stub !== undefined && FORM_PHASE <= d.stub.until;
const complete = defs.filter((d) => !isStub(d));

/**
 * Item 2: the registry keys equal the TS union `Op["op"]`. `satisfies` fails to compile on a
 * missing or an extra name; the runtime check below compares it with the registry.
 */
const NAMES = {
  updateWorkspace: true,
  setWorkspaceCalendar: true,
  addClosure: true,
  removeClosure: true,
  addPerson: true,
  updatePerson: true,
  archivePerson: true,
  restorePerson: true,
  deletePerson: true,
  linkPersonToMe: true,
  addTimeOff: true,
  removeTimeOff: true,
  saveTemplate: true,
  updateTemplate: true,
  deleteTemplate: true,
  createProject: true,
  duplicateProject: true,
  archiveProject: true,
  restoreProject: true,
  deleteProject: true,
  updateProject: true,
  addMember: true,
  removeMember: true,
  addLink: true,
  removeLink: true,
  addTask: true,
  updateTask: true,
  removeTask: true,
  moveTask: true,
  addDependency: true,
  removeDependency: true,
  pinStart: true,
  unpinStart: true,
  assignTask: true,
  unassignTask: true,
  addStep: true,
  updateStep: true,
  removeStep: true,
  reorderStep: true,
  proposeSubtasks: true,
  proposeReassign: true,
  proposeLeveling: true,
  proposeEstimates: true,
  proposePlan: true,
  acceptProposal: true,
  discardProposal: true,
  addView: true,
  removeView: true,
  setView: true,
  setFocus: true,
  addBlock: true,
  removeBlock: true,
  editBriefLine: true,
  resetBriefLine: true,
  addBriefLine: true,
  updateBriefLine: true,
  removeBriefLine: true,
  resetBrief: true,
  markBriefSent: true,
  setBriefSharing: true,
  addMoodItems: true,
  updateMoodItem: true,
  removeMoodItem: true,
  arrangeMood: true,
  clearMood: true,
  rebalanceOrder: true,
} satisfies Record<OpName, true>;

/** v0 names no registry op folds in: the demo action addSampleTeam, lowered by test/legacy/lower.ts (plan §4.5) */
const LOWERED_ONLY: readonly V0OpName[] = ["addSampleTeam"];

/** Reject codes only one op produces: exempt from item 9 while that op is a stub */
const ONLY_PRODUCER: Partial<Record<RejectCode, OpName>> = {
  last_view: "removeView",
  protected_block: "removeBlock",
  stale_proposal: "acceptProposal",
  owns_tasks: "deletePerson",
};

const EXEMPT_MIN = 10;

function checkExempt(e: Exempt, where: string): void {
  expect(e.exempt.length, `${where}: the reason needs ${EXEMPT_MIN}+ characters`).toBeGreaterThanOrEqual(EXEMPT_MIN);
  if (e.until !== undefined) expect(e.until, `${where}: the exemption expired in phase ${e.until}`).toBeGreaterThan(FORM_PHASE);
}

/* ------------------------------------------------------------------
   1–2. Files, registry and the TS union
   ------------------------------------------------------------------ */

describe("files and the registry", () => {
  it("has one file per op, named after it, in the folder of its scope", async () => {
    const seen = new Set<string>();
    for (const scope of ["workspace", "project"] as const) {
      const files = readdirSync(join(REGISTRY_DIR, scope)).filter((f) => f.endsWith(".ts"));
      for (const file of files) {
        const name = basename(file, ".ts");
        const mod = (await import(/* @vite-ignore */ join(REGISTRY_DIR, scope, file))) as { default: AnyOpDef };
        expect(mod.default.name, file).toBe(name);
        expect(mod.default.scope, file).toBe(scope);
        expect(REGISTRY.get(name), `${name} is in the registry`).toBe(mod.default);
        seen.add(name);
      }
    }
    expect([...seen].sort()).toEqual([...REGISTRY.keys()].sort());
    expect(REGISTRY.size).toBe(66);
    expect(defs.filter((d) => d.scope === "workspace")).toHaveLength(20);
  });

  it("has the TS union's names, no more and no fewer", () => {
    expect(Object.keys(NAMES).sort()).toEqual([...REGISTRY.keys()].sort());
  });
});

/* ------------------------------------------------------------------
   3. Every complete op: strict schema, sample, caption, flags
   ------------------------------------------------------------------ */

describe.each(complete.map((d) => [d.name, d] as const))("%s", (name, def) => {
  const fixture = namedFixture(def.sampleOn ?? "demo");
  const sample = def.sample(docsOf(fixture), seededMinter(1));

  it("has a strict schema", () => {
    expect(def.schema.safeParse(sample).success, "the sample parses").toBe(true);
    expect(def.schema.safeParse({ ...sample, unexpected: true }).success, "an extra key fails").toBe(false);
    expect(def.schema.safeParse({ op: name }).success, "{ op } alone fails").toBe(false);
  });

  it("applies its sample on its fixture, with a 1–280 character caption", () => {
    const before = def.scope === "workspace" ? fixture.workspace : fixture.projects[fixture.projectId!];
    const result = applyOp(before, sample, reduceCtx(fixture));
    expect(result.kind, JSON.stringify(result.kind === "rejected" ? result.rejection : null)).toBe("applied");
    const after = result.kind === "applied" ? result.doc : before;
    const state = def.scope === "workspace" ? { ...fixture, workspace: after } : { ...fixture, projects: { ...fixture.projects, [after.id]: after } };
    const env = makeCaptionEnv({ after: state as typeof fixture, before: fixture, projectId: fixture.projectId, today: FIXTURE_TODAY });
    const caption = composeCaption({ outcomes: [{ def, before, result }], local: [], addedViews: [], notes: [], notices: [], env, historyEntry: true });
    // rebalanceOrder is a system op: it folds into its commit and never speaks
    if (name === "rebalanceOrder") return;
    expect(caption?.text.length ?? 0).toBeGreaterThan(0);
    expect(caption!.text.length).toBeLessThanOrEqual(280);
  });

  it("sets noopCaption, undoable, activity and idempotent", () => {
    expect(typeof def.noopCaption).toBe("function");
    expect(def.undoable).toBe(true);
    expect(["show", "hide"]).toContain(def.activity);
    expect(typeof def.idempotent).toBe("boolean");
    expect(def.activity === "hide").toBe(["setView", "setFocus", "rebalanceOrder"].includes(name));
  });
});

/* ------------------------------------------------------------------
   4. Parser, palette and transport: filled or exempt
   ------------------------------------------------------------------ */

describe("parser, palette and transport", () => {
  it("are filled or exempt with a reason, and no exemption has expired", () => {
    for (const def of complete) {
      for (const key of ["parser", "palette", "transport"] as const) {
        const value = def[key];
        if (isExempt(value)) checkExempt(value, `${def.name}.${key}`);
        else if (key === "parser") {
          const parser = value as Exclude<AnyOpDef["parser"], Exempt>;
          expect(parser.examples.length, `${def.name} has parser examples`).toBeGreaterThan(0);
          for (const ex of parser.examples) expect(FIXTURE_NAMES).toContain(ex.fixture);
        } else if (key === "palette") expect((value as unknown[]).length, `${def.name} has palette entries`).toBeGreaterThan(0);
      }
    }
    for (const local of Object.values(LOCAL_INTENTS)) {
      for (const key of ["parser", "palette", "transport"] as const) {
        const value = local[key];
        if (isExempt(value)) checkExempt(value, `local ${local.kind}.${key}`);
      }
    }
  });

  it("leaves stubs only to Phase 1, each owned by a step 10 family", () => {
    for (const def of defs.filter(isStub)) {
      expect(["10a", "10b", "10c", "10d", "10e"]).toContain(def.stub!.family);
      expect(stubAllowed(def), `${def.name} is still a stub after phase ${def.stub!.until}`).toBe(true);
    }
  });

  it("names only §9.4 tools, and every tool has an owner or a reason", () => {
    const claimed = new Set<TransportTool>();
    const specs = [...defs.map((d) => [d.name, d.transport] as const), ...Object.values(LOCAL_INTENTS).map((l) => [`local ${l.kind}`, l.transport] as const)];
    for (const [owner, spec] of specs) {
      if (isExempt(spec)) {
        checkExempt(spec, `${owner}.transport`);
        continue;
      }
      expect(TRANSPORT_TOOLS, owner).toContain(spec.tool);
      claimed.add(spec.tool);
    }
    for (const tool of TRANSPORT_TOOLS) {
      const allowed = UNCLAIMED_TOOLS[tool];
      if (allowed) {
        expect(claimed.has(tool), `${tool} is claimed: drop it from UNCLAIMED_TOOLS`).toBe(false);
        expect(allowed.reason.length).toBeGreaterThanOrEqual(EXEMPT_MIN);
        if (allowed.until !== undefined) expect(allowed.until).toBeGreaterThan(FORM_PHASE);
      } else expect(claimed.has(tool), `${tool} has no op or local intent`).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------
   6. Palette phrases
   ------------------------------------------------------------------ */

describe("palette phrases", () => {
  const entries = paletteEntries();

  it("are unique, at most 80 characters, in a known group, on a known fixture", () => {
    const phrases = entries.map((e) => e.phrase);
    expect(new Set(phrases).size).toBe(phrases.length);
    for (const e of entries) {
      expect(e.phrase.length, e.phrase).toBeLessThanOrEqual(80);
      expect(PALETTE_GROUPS).toContain(e.group);
      expect(FIXTURE_NAMES).toContain(e.fixture);
      expect(e.surfaces.length).toBeGreaterThan(0);
      expect(Number.isFinite(e.rank)).toBe(true);
    }
  });

  it("total the 42 v0 phrases once every op is filled", () => {
    if (defs.some(isStub)) expect(entries.length).toBeLessThan(42);
    else expect(entries.length).toBe(42);
  });

  it.skipIf(!existsSync(PALETTE_TEST))("are each exercised by the palette test (§10.5), generated from paletteGroups", () => {
    expect(readFileSync(PALETTE_TEST, "utf8")).toContain("paletteGroups(");
  });
});

/* ------------------------------------------------------------------
   7–8. Spawners and v0 names
   ------------------------------------------------------------------ */

describe("spawn and deprecations", () => {
  it("spawns only from createProject and duplicateProject", () => {
    const SPAWNERS = ["createProject", "duplicateProject"];
    for (const def of defs) {
      if (def.spawn) expect(SPAWNERS, `${def.name} spawns`).toContain(def.name);
      else if (SPAWNERS.includes(def.name)) expect(isStub(def), `${def.name} must spawn`).toBe(true);
    }
  });

  it("covers exactly the 35 v0 op names, with the test-only lowering", () => {
    expect([...V0_OP_NAMES].sort()).toEqual([...LEGACY_OP_NAMES].sort());
    const covered = new Set<V0OpName>([...defs.flatMap((d) => d.deprecates), ...LOWERED_ONLY]);
    expect([...covered].sort()).toEqual([...V0_OP_NAMES].sort());
  });
});

/* ------------------------------------------------------------------
   9. Generators and unit tests
   ------------------------------------------------------------------ */

/** The text of every ops unit test file except this one */
function unitTestSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (dir.endsWith("__tests__") && entry.name.endsWith(".test.ts") && entry.name !== "completeness.test.ts") {
        out.push(readFileSync(path, "utf8"));
      }
    }
  };
  walk(join(ROOT, "src/lib/ops"));
  return out;
}

/** The codes passed to `expectRejection(result, "code")`, read with balanced parentheses */
function rejectionCodes(source: string): Set<string> {
  const codes = new Set<string>();
  const marker = "expectRejection(";
  for (let at = source.indexOf(marker); at >= 0; at = source.indexOf(marker, at + 1)) {
    let depth = 0;
    let quote: string | null = null;
    let end = at + marker.length - 1;
    for (; end < source.length; end++) {
      const c = source[end];
      if (quote) {
        if (c === "\\") end++;
        else if (c === quote) quote = null;
      } else if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "(") depth++;
      else if (c === ")" && --depth === 0) break;
    }
    const code = /"([a-z_]+)"\s*,?\s*$/.exec(source.slice(at, end))?.[1];
    if (code) codes.add(code);
  }
  return codes;
}

describe("generators and unit tests", () => {
  const sources = unitTestSources();

  it("has a property generator for every op", () => {
    for (const name of OP_NAMES) {
      expect(existsSync(join(GEN_DIR, `${name}.ts`)), `test/property/gen/${name}.ts`).toBe(true);
      expect(typeof GENERATORS[name]).toBe("function");
    }
  });

  it("names every complete op in a unit test", () => {
    for (const def of complete) expect(sources.some((s) => s.includes(`"${def.name}"`)), `a unit test names ${def.name}`).toBe(true);
  });

  it("produces every reject code in some unit test", () => {
    const produced = new Set(sources.flatMap((s) => [...rejectionCodes(s)]));
    for (const code of REJECT_CODES) {
      const producer = ONLY_PRODUCER[code];
      if (producer && isStub(REGISTRY.get(producer)!)) continue;
      expect(produced.has(code), `no unit test produces ${code}`).toBe(true);
    }
  });
});
