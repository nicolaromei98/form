// The caption policy over the golden corpus and the palette (DECISIONS, "Wave 5 outcomes and the
// caption policy"): the caption is the agent's only voice, so every caption a corpus command or a
// palette phrase (or parser example) shows is one short line: at most four " · " parts (rule 7,
// enforced by the composer) and at most 120 characters, apart from the reasoned exceptions below.
// The review's concrete targets are asserted word for word at the end.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastResult } from "@/lib/interpret/fast";
import { CAPTION_PARTS } from "@/lib/domain/limits";
import type { CommandResult } from "@/lib/ops/command";
import { CORPUS } from "./corpus";
import { applyParse, compare, type LegacyFixture, paletteCases, parsePaletteCase } from "./parser-harness";

/** One short line */
const LENGTH_MAX = 120;

/**
 * Captions allowed past 120 characters, each with its reason. All three keep v0's own words:
 * - the first palette phrase's caption is v0's, exactly, back with rule 6 (four parts);
 * - two unsupported replies are v0's wording, verbatim (plan §8.4: clarify and unsupported replies
 *   keep it): single sentences that say what the demo can do, not concatenated parts.
 */
const LONG: Readonly<Record<string, string>> = {
  "Timeline created · 4 tasks · sample dates, sequenced from estimates · Demo mode ships one template (website) — rename anything":
    "v0's exact caption for 'Create a timeline for my project' (126 characters, four parts): the sample-dates note is rule 6, and the notice is v0's fixed wording.",
  "I understood you mean UI Design, but not the change. Try 'break this into smaller steps', 'mark it done' or 'make this more prominent'.":
    "v0's unsupported reply for a selected task, verbatim (plan §8.4).",
  "On the moodboard I can add notes and colours, arrange it (masonry, grid, collage), clear or hide it. Images: drop, paste or browse.":
    "v0's unsupported reply for the moodboard, verbatim (plan §8.4).",
};

const parts = (text: string) => text.split(" · ").length;

/** mulberry32: v0's uids come from Math.random, seeded so the legacy fixtures are stable */
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
  vi.useFakeTimers({ now: new Date(2026, 9, 14, 10, 0, 0), toFake: ["Date"] });
  vi.spyOn(Math, "random").mockImplementation(seeded(42));
});
afterAll(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** What a palette case shows: the composed caption, or the reply the parse gives instead */
function shown(result: FastResult, run: CommandResult | null): string {
  if (result.status === "none") return result.reply.text;
  if (run?.caption) return run.caption.text;
  return "control" in result ? "" : (result.reply?.text ?? "");
}

const v2 = (say: string, fixture: LegacyFixture) => compare(say, fixture).v2.caption;

const PALETTE = paletteCases();

function paletteCaption(c: (typeof PALETTE)[number]): string {
  const { state, result } = parsePaletteCase(c);
  return shown(result, applyParse(state, result, c.say).run);
}

function expectOneShortLine(text: string, what: string) {
  expect(parts(text), `${what}: "${text}" has at most ${CAPTION_PARTS} parts`).toBeLessThanOrEqual(CAPTION_PARTS);
  if (text.length > LENGTH_MAX) expect(LONG[text], `${what}: "${text}" (${text.length} characters) is one short line, or a listed exception`).toBeDefined();
}

describe("captions are one short line (caption policy rule 7)", () => {
  it.each(CORPUS.map((c) => [`[${c.fixture}] ${c.say}`, c] as const))("corpus %s", (name, c) => {
    expectOneShortLine(v2(c.say, c.fixture), name);
  });

  it.each(PALETTE.map((c) => [`${c.palette ? "palette" : "example"}: ${c.say}`, c] as const))("%s", (name, c) => {
    const text = paletteCaption(c);
    expect(text, `${name} says something`).not.toBe("");
    expectOneShortLine(text, name);
  });

  it("lists only exceptions that still happen", () => {
    const all = [...CORPUS.map((c) => v2(c.say, c.fixture)), ...PALETTE.map(paletteCaption)];
    const long = new Set(all.filter((t) => t.length > LENGTH_MAX));
    expect([...long].sort()).toEqual(Object.keys(LONG).sort());
  });
});

describe("the review's targets (DECISIONS, caption policy)", () => {
  it("lets the sample team speak as one (rule 3)", () => {
    expect(v2("Add a sample team", "demoNoTeam")).toBe("Sample team added · Marta, Sara and Luca · Marta over capacity");
  });

  it("says people added alike once, without their joining the project (rules 1 and 2), plus at most the view part", () => {
    expect(v2("Add Giulia and Paolo to the team", "demo")).toBe("Giulia and Paolo added to the team · capacity not set · Team view added");
  });

  it("says a no-op first, never behind a view (rule 5)", () => {
    expect(v2("Clear the moodboard", "demo").startsWith("The moodboard is already empty")).toBe(true);
    expect(v2("Reset the brief", "demo")).toBe("The client brief is already FORM's version · Brief view added");
    expect(v2("Assign Development to Luca", "demo")).toBe("Development is already with Luca · Team view added");
  });

  it("keeps the honest sample-dates note on a timeline birth with an unconfirmed start (rule 6)", () => {
    expect(v2("Create a timeline for my project", "empty")).toContain("Timeline created · 4 tasks · sample dates, sequenced from estimates");
  });

  it("says the Team view's status only when opening the Team is the intent (rule 4)", () => {
    for (const say of ["Give UI Design to Sara", "Unassign Visual Direction", "Assign Development to Sara", "Remove Luca from the team", "Sara has 3 days a week"]) {
      expect(v2(say, "demo"), say).not.toMatch(/over capacity$|within capacity$/);
    }
    expect(v2("Give UI Design to Sara", "demo")).toBe("UI Design → Sara · Sara 6/8d · Team view added");
    expect(v2("Show the team workload", "demo")).toBe("Team view added · Marta over capacity");
  });

  it("adds brief lines without the brief's own status (rule 4)", () => {
    expect(v2("Add to the brief: homepage preview on Friday", "demo")).toBe("Added to the client brief · Note · Brief view added");
    expect(v2("Add to the team brief under risks: copy is late", "demo")).toBe("Added to the team brief · Risks · Brief view added");
  });

  it("proposes steps from the brief or the team without '· Tracker' (rule 4)", () => {
    for (const fixture of ["demoTeamView", "demoBrief"] as const) {
      expect(v2("Break UI Design into smaller steps", fixture), fixture).toBe("4 steps proposed for UI Design · fits its 6d estimate. Review them on the task.");
    }
  });
});
