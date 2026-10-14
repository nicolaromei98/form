// The caption composer (plan §5.9): keys, announceView, the 280-character cut after every
// suffix, tones, local show captions from the after state, query notes and notices.
import { describe, expect, it } from "vitest";
import type { PersonId, TaskId } from "@/lib/domain/schema/ids";
import { announceView, composeCaption, joinParts, mergeKeys } from "@/lib/ops/caption";
import { type CaptionPlanning, makeCaptionEnv } from "@/lib/ops/caption-env";
import { showCaption } from "@/lib/ops/local-intents";
import { renderNote } from "@/lib/ops/queries";
import { REGISTRY } from "@/lib/ops/registry";
import { captionKey } from "@/lib/ops/registry/_helpers";
import { DEMO_PEOPLE, demoState, emptyState, FIXTURE_TODAY, taskByTitle } from "../../../../test/fixtures/v2/build";
import { namedFixture } from "../../../../test/fixtures/v2/named";
import { deepFreeze, projectOf, run, type TestState } from "../registry/__tests__/support";

const demo = (): TestState => deepFreeze(demoState());

/** A planning stand-in with fixed lanes and a fixed pick */
function planning(o: { over?: Record<string, number>; pick?: TaskId | null; chosenBy?: "form" | "you" } = {}): CaptionPlanning {
  return {
    plan: () => null,
    lanes: (p) =>
      p.memberIds.map((personId) => ({ personId, days: 0, capacity: 5, over: o.over?.[personId] ?? 0, free: o.over?.[personId] ? 0 : 4 })),
    focus: () =>
      o.pick === undefined ? null : { pick: o.pick === null ? null : { taskId: o.pick, chosenBy: o.chosenBy ?? "form", reasons: [{ text: "Urgent priority" }] } },
  };
}

function env(state: TestState, p?: CaptionPlanning) {
  return makeCaptionEnv({ after: state, projectId: state.projectId, today: FIXTURE_TODAY, planning: p });
}

describe("parts", () => {
  it("lets a later part with the same key replace the earlier one in place", () => {
    const merged = mergeKeys([{ text: "Progress 40%", key: "k" }, { text: "Other" }, { text: "UI Design → Done", key: "k" }]);
    expect(merged.map((p) => p.text)).toEqual(["UI Design → Done", "Other"]);
  });

  it("cuts at a part boundary within 280 characters", () => {
    const parts = ["a".repeat(130), "b".repeat(130), "c".repeat(30)];
    expect(joinParts(parts)).toBe(`${"a".repeat(130)} · ${"b".repeat(130)}`);
    expect(joinParts(["x".repeat(300)]).length).toBe(280);
  });

  it("announces an added view through its show part, or on its own", () => {
    const team = { text: "Team · Marta over capacity", key: captionKey.show("team") };
    const added = { text: "Team view added", key: captionKey.viewAdded("team") };
    expect(announceView([added, team], ["team"]).map((p) => p.text)).toEqual(["Team view added · Marta over capacity"]);
    const brief = { text: "Status brief · for the client · composed from the project, nothing invented", key: captionKey.show("brief") };
    expect(announceView([brief], ["brief"])[0].text).toBe("Brief view added · for the client · composed from the project, nothing invented");
    expect(announceView([{ text: "Board", key: captionKey.show("board") }], ["board"])[0].text).toBe("Board view added");
    expect(announceView([], ["timeline"]).map((p) => p.text)).toEqual(["Timeline view added"]);
  });
});

describe("composeCaption", () => {
  it("ignores system ops and tones proposals, changes, notes and refusals", () => {
    const s = demo();
    const e = env(s);
    const rebalance = REGISTRY.get("rebalanceOrder")!;
    const sys = { def: rebalance, before: projectOf(s), result: { kind: "rejected" as const, doc: projectOf(s), op: {}, rejection: { code: "unknown_op" as const, message: "x" } } };
    expect(composeCaption({ outcomes: [sys], local: [], addedViews: [], notes: [], notices: [], env: e, historyEntry: false })).toBeNull();
    const notes = composeCaption({ outcomes: [], local: [], addedViews: [], notes: [{ kind: "alreadyVisible", what: "progress" }], notices: [], env: e, historyEntry: false });
    expect(notes).toEqual({ text: "Progress is already visible", tone: "info", undoable: false });
    const notice = composeCaption({ outcomes: [], local: [], addedViews: [], notes: [], notices: ["weekendsNow"], env: e, historyEntry: false });
    expect(notice?.text).toBe("Schedule now skips weekends.");
  });

  it("appends refusals after the applied parts and keeps the whole within 280", () => {
    const s = demo();
    const ui = taskByTitle(projectOf(s), "UI Design").id;
    const long = "x".repeat(140);
    const r = run(s, [
      { op: "updateTask", taskId: ui, field: "title", value: long },
      { op: "updateTask", taskId: ui, field: "priority", value: "low" },
      { op: "removeTask", taskId: "tsk_missing00000000" },
      { op: "removeTask", taskId: "tsk_missing00000001" },
    ]);
    expect(r.caption!.text.length).toBeLessThanOrEqual(280);
    expect(r.caption!.text.startsWith(`Renamed to ${"x".repeat(59)}…`)).toBe(true);
    expect(r.caption!.text).toContain("Couldn't apply 2 changes: That task isn't in this project anymore.");
    expect(r.caption!.tone).toBe("done");
  });
});

describe("show captions", () => {
  it("speak about the after state", () => {
    const s = demo();
    expect(showCaption("cards", env(s)).text).toBe("Tracker");
    expect(showCaption("board", env(s)).text).toBe("Board");
    expect(showCaption("timeline", env(s)).text).toBe("Timeline · sample dates, sequenced from estimates");
    expect(showCaption("timeline", env(deepFreeze(namedFixture("demoUnestimated")))).text).toBe(
      "Timeline · sample dates, sequenced from estimates · 1 task needs a duration",
    );
    expect(showCaption("brief", env(s)).text).toBe("Status brief · for the client · composed from the project, nothing invented");
  });

  it("read the team and focus from the planning engine when there is one", () => {
    const s = demo();
    expect(showCaption("team", env(s)).text).toBe("Team · everyone within capacity");
    expect(showCaption("team", env(s, planning({ over: { [DEMO_PEOPLE.marta]: 4 } }))).text).toBe("Team · Marta over capacity");
    expect(showCaption("team", env(deepFreeze(namedFixture("demoNoTeam")))).text).toBe(
      "Team · no one yet. Use the sample team, or say 'add Giulia to the team'",
    );
    const ui = taskByTitle(projectOf(s), "UI Design").id;
    expect(showCaption("focus", env(s)).text).toBe("Focus");
    expect(showCaption("focus", env(s, planning({ pick: ui }))).text).toBe("Focus · UI Design — urgent priority");
    expect(showCaption("focus", env(s, planning({ pick: ui, chosenBy: "you" }))).text).toBe("Focus · UI Design");
    expect(showCaption("focus", env(s, planning({ pick: null }))).text).toBe("Focus · everything is done");
  });

  it("render the overload notes", () => {
    const s = demo();
    const e = env(s, planning({ over: { [DEMO_PEOPLE.marta]: 4 } }));
    expect(renderNote({ kind: "overloaded" }, e).map((p) => p.text)).toEqual(["Marta is 4d over", "most room: Luca (4d free)"]);
    expect(renderNote({ kind: "nothingToBalance" }, e)[0].text).toBe("Marta is 4d over, but no handover fits anyone's capacity");
    expect(renderNote({ kind: "nothingToBalance" }, env(s))[0].text).toBe("Nobody is over capacity · nothing to move");
    expect(e.openTasksOwnedBy(DEMO_PEOPLE.marta as PersonId)).toBe(2);
  });

  it("work without a project", () => {
    const s = deepFreeze(emptyState());
    expect(showCaption("team", env(s)).text).toBe("Team · no one yet. Use the sample team, or say 'add Giulia to the team'");
    expect(env(s).taskTitle("tsk_missing00000000" as TaskId)).toBe("that task");
  });
});
