import { describe, expect, it } from "vitest";
import type { ViewKind } from "@/lib/domain/schema/primitives";
import { addedViews, homeView, isTaskView, nextViews, RELATED, TASK_VIEWS, VIEW_ORDER } from "@/lib/domain/views";

describe("views", () => {
  it("relate every view to three others", () => {
    for (const view of VIEW_ORDER) {
      expect(RELATED[view]).toHaveLength(3);
      expect(RELATED[view]).not.toContain(view);
      expect(new Set(RELATED[view]).size).toBe(3);
    }
  });

  it("know the task views", () => {
    expect(TASK_VIEWS).toEqual(["cards", "board", "timeline"]);
    expect(VIEW_ORDER.filter(isTaskView)).toEqual(TASK_VIEWS);
  });

  it("suggest views not created yet, related to the last one first", () => {
    expect(nextViews(["timeline"])).toEqual(["team", "board", "brief"]);
    expect(nextViews(["timeline", "team"])).toEqual(["brief", "focus", "cards"]);
    expect(nextViews(["cards"], 5)).toEqual(["timeline", "board", "team", "focus", "brief"]);
    expect(nextViews(VIEW_ORDER)).toEqual([]);
    expect(nextViews([])).toEqual([]);
    expect(nextViews(null)).toEqual([]);
  });

  it("go home to the first task view", () => {
    expect(homeView(["team", "board", "cards"])).toBe("board");
    expect(homeView(["timeline"])).toBe("timeline");
  });

  it("go home to a view the project has, even without a task view", () => {
    const views: ViewKind[] = ["team", "brief"];
    expect(homeView(views)).toBe("team");
    expect(homeView(undefined)).toBe("cards");
  });

  it("list the views a change added, in creation order", () => {
    expect(addedViews(["timeline"], ["timeline", "team", "board"])).toEqual(["team", "board"]);
    expect(addedViews(["timeline", "team"], ["timeline"])).toEqual([]);
  });
});
