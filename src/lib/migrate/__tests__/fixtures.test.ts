// The v0 → v2 migration on every v0 fixture (plan §10.6): each result is snapshotted under
// test/fixtures/v2/expected/, passes both strict schemas and every invariant, leaves no reference
// dangling and no v0 id behind, and is the same on a second run. The case-by-case expectations of
// the report (salvaged, repaired, dropped, promoted) are in migrate.test.ts.
import { describe, expect, it } from "vitest";
import { migrateV0 } from "@/lib/migrate";
import { demoOptions, EXPECTED_DIR, MANIFEST, problemsOf, readFixtureInput, v0IdsIn } from "./support";

describe.each(MANIFEST.map((e) => [e.name, e] as const))("v0 fixture %s", (name, entry) => {
  const input = readFixtureInput(entry);

  it("is found by readV0", () => {
    expect(input).not.toBeNull();
  });

  it("migrates to valid documents with no dangling reference", () => {
    const o = demoOptions({ source: input!.source });
    const result = migrateV0(input!.raw, o);
    expect(problemsOf(result, o.workspace)).toEqual([]);
    if (result.project) expect(v0IdsIn(result.project)).toEqual([]);
  });

  it("migrates the same way twice", () => {
    const first = migrateV0(input!.raw, demoOptions({ source: input!.source }));
    const second = migrateV0(structuredClone(input!.raw), demoOptions({ source: input!.source }));
    expect(second).toEqual(first);
  });

  it("matches its snapshot", async () => {
    const result = migrateV0(input!.raw, demoOptions({ source: input!.source }));
    await expect(`${JSON.stringify(result, null, 2)}\n`).toMatchFileSnapshot(`${EXPECTED_DIR}/${name}.json`);
  });
});
