// Local view state (plan §3.6, Q6): the schema, and the URL query round trip.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ZOOM,
  defaultLocalViewState,
  type LocalViewState,
  LocalViewStateSchema,
  parseViewQuery,
  serializeViewQuery,
  TaskId,
  TimelineZoom,
  ViewKind,
} from "@/lib/domain/schema";
import { activeProject, demoState, taskByTitle } from "../../../../test/fixtures/v2/build";

const project = activeProject(demoState({ views: ["timeline", "cards", "team"] }));
const ui = taskByTitle(project, "UI Design").id;

describe("LocalViewStateSchema", () => {
  it("holds the active view, the selection and the zoom, nothing else", () => {
    expect(LocalViewStateSchema.safeParse({ activeView: "team", selectedTaskId: ui, timelineZoom: "week" }).success).toBe(true);
    expect(LocalViewStateSchema.safeParse({ activeView: "team", selectedTaskId: null, timelineZoom: "day", sort: "manual" }).success).toBe(false);
    expect(LocalViewStateSchema.safeParse({ activeView: "tracker", selectedTaskId: null, timelineZoom: "day" }).success).toBe(false);
  });

  it("defaults to the project's home view, no selection and the day grid", () => {
    expect(defaultLocalViewState(project)).toEqual({ activeView: "timeline", selectedTaskId: null, timelineZoom: "day" });
    expect(defaultLocalViewState(activeProject(demoState({ views: ["team", "board"] }))).activeView).toBe("board");
    expect(defaultLocalViewState(null)).toEqual({ activeView: "cards", selectedTaskId: null, timelineZoom: DEFAULT_ZOOM });
  });
});

describe("parseViewQuery", () => {
  it("reads the view, the task and the zoom", () => {
    expect(parseViewQuery(`?view=team&task=${ui}&zoom=week`, project)).toEqual({ activeView: "team", selectedTaskId: ui, timelineZoom: "week" });
    expect(parseViewQuery("view=cards", project)).toEqual({ activeView: "cards" });
    expect(parseViewQuery("", project)).toEqual({});
  });

  it("drops what it doesn't know", () => {
    // A view the project lacks, a task that isn't in it, a malformed id, an unknown zoom
    expect(parseViewQuery("?view=board&task=tsk_missing00000001&zoom=year", project)).toEqual({});
    expect(parseViewQuery("?view=Timeline&task=t-ui&zoom=", project)).toEqual({});
    expect(parseViewQuery("?view=__proto__&task=constructor", project)).toEqual({});
  });

  it("knows only the zoom without a project", () => {
    expect(parseViewQuery(`?view=team&task=${ui}&zoom=month`, null)).toEqual({ timelineZoom: "month" });
  });

  it("takes the first of repeated keys", () => {
    expect(parseViewQuery("?view=team&view=cards", project)).toEqual({ activeView: "team" });
  });
});

describe("serializeViewQuery", () => {
  it("omits defaults", () => {
    expect(serializeViewQuery(defaultLocalViewState(project), project)).toBe("");
    expect(serializeViewQuery({ activeView: "team", selectedTaskId: null, timelineZoom: "day" }, project)).toBe("?view=team");
    expect(serializeViewQuery({ activeView: "timeline", selectedTaskId: ui, timelineZoom: "month" }, project)).toBe(`?task=${ui}&zoom=month`);
  });

  it("round-trips every local state of the project", () => {
    const stateArb: fc.Arbitrary<LocalViewState> = fc.record({
      activeView: fc.constantFrom(...project.views),
      selectedTaskId: fc.constantFrom(null, ...(Object.keys(project.tasks) as TaskId[])),
      timelineZoom: fc.constantFrom(...TimelineZoom.options),
    });
    fc.assert(
      fc.property(stateArb, (v) => {
        const query = serializeViewQuery(v, project);
        expect({ ...defaultLocalViewState(project), ...parseViewQuery(query, project) }).toEqual(v);
        expect(LocalViewStateSchema.parse(v)).toEqual(v);
      }),
    );
    // Every view kind is a valid value of the query
    for (const view of ViewKind.options) expect(new URLSearchParams(`view=${view}`).get("view")).toBe(view);
  });
});
