// The agent's own wording (plan §8.2) stays in step with the store and the registry: a node runs the
// same phrase as the store's chip for that view (which a store test runs through the parser), the
// palette says what a group needs in the registry's words, and the palette the sheet shows is v0's
// CAPABILITIES apart from the one expected difference (ED-8).
import { describe, expect, it } from "vitest";
import { NEEDS_HINT, paletteGroups } from "@/lib/ops/palette";
import { VIEW_OFFER as STORE_VIEW_OFFER } from "@/lib/store/suggestions";
import { CAPABILITIES } from "../../../../test/legacy/v0/components/agent/suggestions";
import { REQUIREMENT_HINT, VIEW_OFFER } from "../suggestions";

/** ED-8: capacity is days per week (Q3), so the Team example names a weekly figure */
const ED8: Readonly<Record<string, string>> = { "Set Marta's capacity to 10 days": "Set Marta's capacity to 4 days a week" };
/** v0 called a project a "tool" */
const NEEDS: Readonly<Record<string, string>> = { none: "none", tool: "project", selection: "selection" };

describe("agent wording", () => {
  it("offers each view with the store's phrase", () => {
    expect(VIEW_OFFER).toEqual(STORE_VIEW_OFFER);
  });

  it("names what a palette group needs as the registry does", () => {
    expect(REQUIREMENT_HINT).toEqual(NEEDS_HINT);
  });

  it("shows v0's palette: the same groups, needs and phrases in the same order, apart from ED-8", () => {
    const v2 = paletteGroups("demo").map((g) => ({ group: g.group, needs: g.needs, items: g.items.map((it) => it.phrase) }));
    const v0 = CAPABILITIES.map((g) => ({ group: g.group, needs: NEEDS[g.needs], items: g.items.map((it) => ED8[it] ?? it) }));
    expect(v2).toEqual(v0);
  });
});
