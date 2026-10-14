import { describe, expect, it } from "vitest";
import { FORM_PHASE } from "@/lib/phase";

describe("FORM_PHASE", () => {
  it("is Phase 1", () => {
    expect(FORM_PHASE).toBe(1);
  });
});
