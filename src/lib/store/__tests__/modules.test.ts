// The store's small modules: the motion signal (fx.ts, v0 fxFor), today and its midnight ticker
// (today.ts), and the view in the URL (view-url.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultLocalViewState } from "@/lib/domain/schema/local";
import type { ProjectId } from "@/lib/domain/schema/ids";
import { addedView, fxFor, restoreFx, shiftFx } from "@/lib/store/fx";
import { msUntilNextDay, startMidnightTicker, todayFor } from "@/lib/store/today";
import { initialView, urlWithView, viewFromSearch, writeViewToUrl } from "@/lib/store/view-url";
import type { CommandResult } from "@/lib/ops/command";

const P = "prj_aaaaaaaaaaaaaaaa" as ProjectId;
const local = (activeView: "cards" | "board" | "timeline") => ({ ...defaultLocalViewState(null), activeView });

function result(applied: string[], o: Partial<Pick<CommandResult, "addedViews" | "projectId" | "local">> = {}) {
  return {
    outcomes: applied.map((name) => ({ def: { name } as never, before: null, result: { kind: "applied" } as never })),
    addedViews: o.addedViews ?? [],
    projectId: o.projectId === undefined ? P : o.projectId,
    local: o.local ?? local("cards"),
  };
}

describe("fx", () => {
  const before = { projectId: P, local: local("cards") };

  it("follows v0 fxFor", () => {
    expect(fxFor(result(["createProject"]), before, 4)).toEqual({ kind: "create", seq: 4, from: null, added: null });
    expect(fxFor(result(["addView"], { addedViews: ["timeline"], local: local("timeline") }), before, 5)).toEqual({
      kind: "shift",
      seq: 5,
      from: "cards",
      added: "timeline",
    });
    expect(fxFor(result(["setView"]), before, 6).kind).toBe("reflow");
    expect(fxFor(result(["addBlock"]), before, 6).kind).toBe("reflow");
    expect(fxFor(result(["updateTask"]), before, 7)).toEqual({ kind: "edit", seq: 7, from: "cards", added: null });
    // A view added but not shown still grows its tab
    expect(fxFor(result(["addView"], { addedViews: ["board"] }), before, 8)).toEqual({ kind: "edit", seq: 8, from: "cards", added: "board" });
  });

  it("restores, with the view a step brings back", () => {
    const fx = restoreFx({ projectId: P, local: local("cards"), views: ["cards"] }, { projectId: P, local: local("timeline"), views: ["cards", "timeline"] }, 9);
    expect(fx).toEqual({ kind: "restore", seq: 9, from: "cards", added: "timeline" });
    expect(shiftFx("board", 2)).toEqual({ kind: "shift", seq: 2, from: "board", added: null });
    expect(addedView(["board", "team"], "team")).toBe("team");
    expect(addedView(["board", "team"], null)).toBe("board");
  });
});

describe("today", () => {
  afterEach(() => vi.useRealTimers());

  it("is the civil date in the workspace zone, and UTC for an unknown zone", () => {
    const at = Date.parse("2026-10-14T23:30:00Z");
    expect(todayFor("Europe/Rome", at)).toBe("2026-10-15");
    expect(todayFor("Pacific/Auckland", at)).toBe("2026-10-15");
    expect(todayFor("America/New_York", at)).toBe("2026-10-14");
    expect(todayFor("Not/AZone", at)).toBe("2026-10-14");
  });

  it("finds the next local midnight to the second, on DST days too", () => {
    // 22:00 in Rome (UTC+2): two hours to go
    expect(msUntilNextDay("Europe/Rome", Date.parse("2026-10-14T20:00:00Z"))).toBe(2 * 3_600_000);
    // 25 October 2026 has 25 hours in Rome: 00:00 CEST to the next 00:00 CET
    expect(msUntilNextDay("Europe/Rome", Date.parse("2026-10-24T22:00:00Z"))).toBe(25 * 3_600_000);
    // 29 March 2026 has 23 hours
    expect(msUntilNextDay("Europe/Rome", Date.parse("2026-03-28T23:00:00Z"))).toBe(23 * 3_600_000);
  });

  it("ticks with the new date at midnight, and stops", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-14T21:59:00Z"));
    const ticks: string[] = [];
    const stop = startMidnightTicker({ timezone: () => "Europe/Rome", now: () => Date.now(), onTick: (d) => ticks.push(d) });
    vi.advanceTimersByTime(59_000);
    expect(ticks).toEqual([]);
    vi.advanceTimersByTime(2_000);
    expect(ticks).toEqual(["2026-10-15"]);
    vi.advanceTimersByTime(86_400_000);
    expect(ticks).toEqual(["2026-10-15", "2026-10-16"]);
    stop();
    vi.advanceTimersByTime(3 * 86_400_000);
    expect(ticks).toHaveLength(2);
  });
});

describe("the view in the URL", () => {
  const project = { views: ["cards", "timeline", "team"] as ("cards" | "timeline" | "team")[], tasks: {} };

  it("reads ?view= only when the project has the view", () => {
    expect(viewFromSearch("?view=timeline", project)).toBe("timeline");
    expect(viewFromSearch("?view=board", project)).toBeNull();
    expect(viewFromSearch("?view=team", null)).toBeNull();
  });

  it("opens the URL's view, else the saved one, else home", () => {
    expect(initialView("?view=team", project, "timeline")).toBe("team");
    expect(initialView("", project, "timeline")).toBe("timeline");
    expect(initialView("?view=nope", project, "board")).toBe("cards");
    expect(initialView("", null, "board")).toBe("cards");
  });

  it("writes the view, omitting home and keeping the rest of the URL", () => {
    expect(urlWithView("http://x.test/demo", "timeline", project)).toBe("/demo?view=timeline");
    expect(urlWithView("http://x.test/demo?view=timeline&a=1#top", "cards", project)).toBe("/demo?a=1#top");
    expect(urlWithView("http://x.test/demo?view=timeline", "team", null)).toBe("/demo");
  });

  it("replaces the history entry only when the URL changes", () => {
    const calls: unknown[] = [];
    const win = { location: { href: "http://x.test/demo" }, history: { replaceState: (...args: unknown[]) => calls.push(args) } };
    writeViewToUrl(win, "cards", project);
    expect(calls).toEqual([]);
    writeViewToUrl(win, "team", project);
    expect(calls).toEqual([[null, "", "/demo?view=team"]]);
  });
});
