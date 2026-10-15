// The palette and parser test (plan §10.5): generated from paletteGroups() and from every op's and
// local intent's parser examples. For each phrase, on its named fixture (test/fixtures/v2/named.ts):
// 1. fastParse returns "matched", with confidence 1 for a palette phrase;
// 2. its ops or local intents include the op or intent that owns the phrase;
// 3. runCommand rejects none of them.
// Together with the completeness test (every phrase placed, 42 in all), this covers the v0 palette.
import { describe, expect, it } from "vitest";
import { isExempt, type ParserExample } from "@/lib/ops/registry/_contract";
import { LOCAL_INTENTS } from "@/lib/ops/local-intents";
import { paletteGroups } from "@/lib/ops/palette";
import { OP_NAMES, REGISTRY } from "@/lib/ops/registry";
import { type FastResult, fastParse, toCommand } from "@/lib/interpret/fast";
import type { CommandResult } from "@/lib/ops/command";
import { makeOp } from "@/lib/ops/build";
import { taskByTitle } from "../fixtures/v2/build";
import { namedFixture } from "../fixtures/v2/named";
import { fastContext, run, type V2State } from "./parser-harness";

/** What the store does for a control word (plan §8.1): reset deletes the active project */
const CONTROL_OWNER: Readonly<Record<string, string>> = { reset: "deleteProject" };

/**
 * Examples that talk about something the fixture doesn't hold yet: the commands that make it,
 * run first. "Mark QA pass done" needs the step "Add a step called QA pass" creates.
 */
const GIVEN: Readonly<Record<string, readonly string[]>> = {
  "Mark QA pass done": ["Add a step called QA pass"],
  "Delete the QA pass step": ["Add a step called QA pass"],
};

interface Case {
  say: string;
  owner: string;
  example: ParserExample;
  palette: boolean;
}

function cases(): Case[] {
  const out: Case[] = [];
  for (const g of paletteGroups("demo")) {
    for (const item of g.items) out.push({ say: item.phrase, owner: item.owner, example: { say: item.phrase, fixture: item.fixture }, palette: true });
  }
  for (const name of OP_NAMES) {
    const parser = REGISTRY.get(name)!.parser;
    if (!isExempt(parser)) for (const ex of parser.examples) out.push({ say: ex.say, owner: name, example: ex, palette: false });
  }
  for (const def of Object.values(LOCAL_INTENTS)) {
    if (!isExempt(def.parser)) for (const ex of def.parser.examples) out.push({ say: ex.say, owner: `local:${def.kind}`, example: ex, palette: false });
  }
  return out;
}

/** The fixture as the parser sees it, with the example's selection */
function stateFor(example: ParserExample): V2State {
  const f = namedFixture(example.fixture);
  const project = f.projectId !== null ? f.projects[f.projectId] : null;
  const selected = example.selected && project ? taskByTitle(project, example.selected).id : f.selectedTaskId;
  const local = { activeView: project ? project.views[0] : ("cards" as const), selectedTaskId: selected, timelineZoom: "day" as const };
  return { docs: { workspace: f.workspace, projects: f.projects }, projectId: f.projectId, local };
}

function apply(state: V2State, result: FastResult, say: string): { state: V2State; run: CommandResult | null } {
  if (result.status !== "matched") return { state, run: null };
  if ("control" in result) {
    if (result.control !== "reset" || state.projectId === null) return { state, run: null };
    const r = run(state, { ops: [makeOp({ op: "deleteProject", projectId: state.projectId })], local: [], notes: [], notices: [], source: "direct", text: say });
    return { state: { docs: r.state, projectId: r.projectId, local: r.local }, run: r };
  }
  const cmd = toCommand(result, say);
  if (!cmd) return { state, run: null };
  const r = run(state, cmd);
  return { state: { docs: r.state, projectId: r.projectId, local: r.local }, run: r };
}

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

const ALL = cases();

describe("the palette and the parser examples (plan §10.5)", () => {
  it("are generated from paletteGroups and the registry: the 42 v0 phrases and every parser example", () => {
    expect(ALL.filter((c) => c.palette)).toHaveLength(42);
    expect(ALL.filter((c) => !c.palette).length).toBeGreaterThan(30);
  });

  it.each(ALL.map((c) => [c.palette ? "palette" : "example", c.say, c] as const))("%s: %s", (_kind, say, c) => {
    let state = stateFor(c.example);
    for (const given of GIVEN[say] ?? []) {
      const before = fastParse(given, fastContext(state, 3));
      state = apply(state, before, given).state;
    }
    const result = fastParse(say, fastContext(state, 5));
    expect(result.status, `${say} is understood`).toBe("matched");
    if (c.palette) expect(result.status === "matched" && result.confidence, `${say} is an exact palette phrase`).toBe(1);
    expect(names(result, c.owner, state), `${say} runs ${c.owner}: ${JSON.stringify(result)}`).toBe(true);
    const { run: r } = apply(state, result, say);
    const rejected = r?.outcomes.filter((o) => o.result.kind === "rejected").map((o) => (o.result.kind === "rejected" ? o.result.rejection : null)) ?? [];
    expect(rejected, `${say} applies without a rejection`).toEqual([]);
  });
});
