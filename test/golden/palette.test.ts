// The palette and parser test (plan §10.5): generated from paletteGroups() and from every op's and
// local intent's parser examples. For each phrase, on its named fixture (test/fixtures/v2/named.ts):
// 1. fastParse returns "matched", with confidence 1 for a palette phrase;
// 2. its ops or local intents include the op or intent that owns the phrase;
// 3. runCommand rejects none of them.
// Together with the completeness test (every phrase placed, 42 in all), this covers the v0 palette.
import { describe, expect, it } from "vitest";
import type { FastResult } from "@/lib/interpret/fast";
import { applyParse, CONTROL_OWNER, paletteCases, parsePaletteCase, type V2State } from "./parser-harness";

/** Whether the parse names the owner: its op, its local intent, or (control) what the store runs */
function names(result: FastResult, owner: string, state: V2State): boolean {
  if (result.status !== "matched") return false;
  if ("control" in result) return CONTROL_OWNER[result.control] === owner;
  if (owner.startsWith("local:")) return result.local.some((l) => `local:${l.kind}` === owner);
  if (result.ops.some((o) => o.op === owner)) return true;
  // A view the project already has is shown, not added (plan §8.4: addView only when it is missing)
  const project = state.projectId !== null ? state.docs.projects[state.projectId] : null;
  return owner === "addView" && result.local.some((l) => l.kind === "show" && project?.views.includes(l.view) === true);
}

const ALL = paletteCases();

describe("the palette and the parser examples (plan §10.5)", () => {
  it("are generated from paletteGroups and the registry: the 42 v0 phrases and every parser example", () => {
    expect(ALL.filter((c) => c.palette)).toHaveLength(42);
    expect(ALL.filter((c) => !c.palette).length).toBeGreaterThan(30);
  });

  it.each(ALL.map((c) => [c.palette ? "palette" : "example", c.say, c] as const))("%s: %s", (_kind, say, c) => {
    const { state, result } = parsePaletteCase(c);
    expect(result.status, `${say} is understood`).toBe("matched");
    if (c.palette) expect(result.status === "matched" && result.confidence, `${say} is an exact palette phrase`).toBe(1);
    expect(names(result, c.owner, state), `${say} runs ${c.owner}: ${JSON.stringify(result)}`).toBe(true);
    const { run: r } = applyParse(state, result, say);
    const rejected = r?.outcomes.filter((o) => o.result.kind === "rejected").map((o) => (o.result.kind === "rejected" ? o.result.rejection : null)) ?? [];
    expect(rejected, `${say} applies without a rejection`).toEqual([]);
  });
});
