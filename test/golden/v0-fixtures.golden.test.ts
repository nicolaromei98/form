// The v0 fixtures (plan §10.6) are frozen evidence: the committed files must be exactly what the
// generator produces through the frozen v0 code, and every file must be listed with its purpose.
import { readdirSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DocSchema } from "../legacy/v0/lib/schema";
import { buildFixtures, FIXTURE_DIR, V0_BACKUP_KEY, V0_KEY, type FixtureEntry, type StorageMap } from "../../scripts/fixtures/gen-v0.mjs";

const manifest: FixtureEntry[] = JSON.parse(readFileSync(FIXTURE_DIR + "manifest.json", "utf8"));
const read = (file: string): unknown => JSON.parse(readFileSync(FIXTURE_DIR + file, "utf8"));

describe("v0 fixtures", () => {
  // The generator reads dates as v0 does, in local time on the plan's day
  const tz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "Europe/Rome";
  });
  afterAll(() => {
    process.env.TZ = tz;
  });

  it("match the generator byte for byte", () => {
    const { files } = buildFixtures();
    for (const [file, text] of Object.entries(files)) expect(readFileSync(FIXTURE_DIR + file, "utf8"), file).toBe(text);
  });

  it("are all listed, each with a one-line purpose", () => {
    const onDisk = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json") && f !== "manifest.json");
    expect(manifest.map((e) => e.file).sort()).toEqual(onDisk.sort());
    for (const e of manifest) {
      expect(e.purpose.length, e.name).toBeGreaterThan(20);
      expect(e.purpose, e.name).not.toContain("\n");
    }
  });

  it("cover every §10.6 case", () => {
    const covered = new Set(manifest.flatMap((e) => [...e.covers.matchAll(/§10\.6 #(\d+)/g)].map((m) => Number(m[1]))));
    expect([...covered].sort((a, b) => a - b)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
  });

  it.each(manifest.filter((e) => e.kind === "envelope").map((e) => [e.name, e] as const))("%s loads in v0 as recorded", (_, e) => {
    const { state } = read(e.file) as { state: { doc: unknown } };
    expect(DocSchema.safeParse(state.doc).success ? "valid" : "invalid").toBe(e.v0Load);
  });

  it("keep the storage cases in the shapes they describe", () => {
    const storage = (name: string) => read(`${name}.json`) as StorageMap;
    expect(() => JSON.parse(storage("corruptMainWithBackup")[V0_KEY])).toThrow();
    expect(DocSchema.safeParse(JSON.parse(storage("corruptMainWithBackup")[V0_BACKUP_KEY]).doc).success).toBe(true);
    expect(Object.keys(storage("shapeBackup"))).toEqual([V0_BACKUP_KEY]);
    expect(DocSchema.safeParse(JSON.parse(storage("shapeBare")[V0_KEY])).success).toBe(true);
    expect(JSON.parse(storage("shapeEnvelope")[V0_KEY]).version).toBe(1);
  });
});
