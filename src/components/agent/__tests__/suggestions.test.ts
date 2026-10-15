// The agent's own wording (plan §8.2) stays in step with the store and the registry: a node runs the
// same phrase as the store's chip for that view (which a store test runs through the parser), and
// the palette says what a group needs in the registry's words.
import { describe, expect, it } from "vitest";
import { NEEDS_HINT } from "@/lib/ops/palette";
import { VIEW_OFFER as STORE_VIEW_OFFER } from "@/lib/store/suggestions";
import { REQUIREMENT_HINT, VIEW_OFFER } from "../suggestions";

describe("agent wording", () => {
  it("offers each view with the store's phrase", () => {
    expect(VIEW_OFFER).toEqual(STORE_VIEW_OFFER);
  });

  it("names what a palette group needs as the registry does", () => {
    expect(REQUIREMENT_HINT).toEqual(NEEDS_HINT);
  });
});
