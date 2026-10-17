// migrateV0 on the audit's 150-task document within 20 ms, validation included (plan §10.6,
// §10.7), with the growth guard t(300) / t(150) < 3 on a 300-task document built the same way.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { seededMinter } from "@/lib/domain/ids";
import { sampleForMigration } from "@/lib/demo/sample";
import { migrateV0, type MigrateV0Options } from "@/lib/migrate";
import { emptyWorkspace, FIXTURE_NOW } from "../fixtures/v2/build";
import { budget, time } from "./timing";

interface Envelope {
  state: { doc: { tasks: Record<string, Record<string, unknown>>; order: string[] }; log: unknown[] };
  version: number;
}

const doc150: Envelope = JSON.parse(readFileSync(new URL("../fixtures/v0/doc150.json", import.meta.url), "utf8"));

/** doc150 with its tasks repeated under new ids, so the chain and the owners scale with it */
function doubled(e: Envelope): Envelope {
  const copy = structuredClone(e);
  const { tasks, order } = copy.state.doc;
  for (const id of [...order]) {
    const twin = `${id}-2`;
    tasks[twin] = { ...tasks[id], id: twin };
    order.push(twin);
  }
  return copy;
}

const doc300 = doubled(doc150);

const options = (): MigrateV0Options => ({
  now: FIXTURE_NOW,
  mint: seededMinter(150),
  mode: "demo",
  workspace: emptyWorkspace(),
  sample: sampleForMigration(),
  includeSampleTeam: false,
});

describe("migrateV0", () => {
  it("migrates the 150-task document in at most 20 ms", () => {
    expect(Object.keys(migrateV0(doc150, options()).project!.tasks)).toHaveLength(150);
    expect(Object.keys(migrateV0(doc300, options()).project!.tasks)).toHaveLength(300);
    const t150 = time(() => migrateV0(doc150, options()), { runs: 30 });
    const t300 = time(() => migrateV0(doc300, options()), { runs: 30 });
    expect(t150.median).toBeLessThan(budget(20));
    expect(t300.median / t150.median).toBeLessThan(3);
  });
});
