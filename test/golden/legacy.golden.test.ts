// Smoke test for the golden project: the frozen v0 modules and fixtures load and behave as v0 did.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAPABILITIES } from "../legacy/v0/components/agent/suggestions";
import { interpretDemo } from "../legacy/v0/lib/interpret/demo";
import { applyOperations } from "../legacy/v0/lib/ops";
import { DocSchema } from "../legacy/v0/lib/schema";
import { emptyDoc } from "../legacy/v0/lib/seed";
import { LEGACY_OP_NAMES } from "../legacy/lower";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/v0/${name}.json`, import.meta.url), "utf8")).state.doc;

describe("frozen v0 code", () => {
  it("lists the 35 v0 operation names", () => {
    expect(LEGACY_OP_NAMES).toHaveLength(35);
    expect(new Set(LEGACY_OP_NAMES).size).toBe(35);
  });

  it.each(["docDemo", "doc60", "doc150"])("accepts the %s audit fixture", (name) => {
    expect(DocSchema.safeParse(fixture(name)).success).toBe(true);
  });

  it("creates the website template from a palette phrase", () => {
    const result = interpretDemo("Create a timeline for my project", { doc: emptyDoc(), selectedId: null });
    const doc = applyOperations(emptyDoc(), result.ops);
    expect(result.tone).toBe("done");
    expect(doc.tool?.views).toEqual(["timeline"]);
    expect(Object.keys(doc.tasks)).toHaveLength(4);
    expect(DocSchema.safeParse(doc).success).toBe(true);
  });

  it("keeps the v0 command palette", () => {
    expect(CAPABILITIES.flatMap((group) => group.items).length).toBeGreaterThan(0);
  });
});
