// The golden parser test (plan §10.4): every command of the corpus runs through the frozen v0
// parser (lowered to v2 ops) and through fastParse, on the same v2 twin of a v0 fixture state.
// The two after-states must be equal in canonical form, and the v2 caption must equal what v0
// showed. Every difference is listed in expected-diffs.ts with its reason, or the test fails; a
// listed difference that no longer happens fails too.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CORPUS } from "./corpus";
import { EXPECTED_DIFFS, type ObservedDiff } from "./expected-diffs";
import { compare, stateDiffs } from "./parser-harness";

/** mulberry32: v0's uids come from Math.random, seeded here so every run builds the same fixtures */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

beforeAll(() => {
  // v0's focus reads the clock: 14 Oct 2026, the frozen clock of the fixtures and the e2e suite
  vi.useFakeTimers({ now: new Date(2026, 9, 14, 10, 0, 0), toFake: ["Date"] });
  vi.spyOn(Math, "random").mockImplementation(seeded(42));
});
afterAll(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const key = (fixture: string, say: string) => `[${fixture}] ${say}`;

function observed(say: string, fixture: (typeof CORPUS)[number]["fixture"]): ObservedDiff | null {
  const c = compare(say, fixture);
  const state = stateDiffs(c);
  const caption = c.legacy.caption === c.v2.caption ? undefined : { v0: c.legacy.caption, v2: c.v2.caption };
  if (!caption && state.length === 0) return null;
  return { ...(caption ? { caption } : {}), ...(state.length ? { state } : {}) };
}

describe("the golden parser corpus (plan §10.4)", () => {
  it("holds about 130 commands, each once per fixture", () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(130);
    const keys = CORPUS.map((c) => key(c.fixture, c.say));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("lists only differences of corpus commands, each once", () => {
    const corpus = new Set(CORPUS.map((c) => key(c.fixture, c.say)));
    const listed = EXPECTED_DIFFS.map((d) => key(d.fixture, d.say));
    expect(listed.filter((k) => !corpus.has(k))).toEqual([]);
    expect(new Set(listed).size).toBe(listed.length);
  });

  const expected = new Map(EXPECTED_DIFFS.map((d) => [key(d.fixture, d.say), d]));

  it.each(CORPUS.map((c) => [key(c.fixture, c.say), c] as const))("%s", (_name, c) => {
    const actual = observed(c.say, c.fixture);
    const listed = expected.get(key(c.fixture, c.say));
    const want = listed ? { ...(listed.caption ? { caption: listed.caption } : {}), ...(listed.state ? { state: [...listed.state] } : {}) } : null;
    expect(actual, listed ? `listed: ${listed.why}` : "an unlisted difference from v0 (add it to expected-diffs.ts with its reason, or fix the parser)").toEqual(want);
  });
});
