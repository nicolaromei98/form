import { describe, expect, it } from "vitest";
import {
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  PRIORITY_RANK,
  PROJECT_KIND_LABEL,
  PROJECT_KIND_ORDER,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_ORDER,
  SECTION_LABEL,
  SECTION_ORDER,
  SORT_LABEL,
  SORT_ORDER,
  STATUS_LABEL,
  STATUS_ORDER,
  VIEW_LABEL,
} from "@/lib/domain/labels";
import { BriefSection, Priority, ProjectKind, ProjectStatus, SortKey, Status, ViewKind } from "@/lib/domain/schema/primitives";

const sorted = (xs: readonly string[]) => [...xs].sort();

describe("labels", () => {
  it.each([
    ["status", STATUS_LABEL, Status.options],
    ["priority", PRIORITY_LABEL, Priority.options],
    ["view", VIEW_LABEL, ViewKind.options],
    ["sort", SORT_LABEL, SortKey.options],
    ["brief section", SECTION_LABEL, BriefSection.options],
    ["project kind", PROJECT_KIND_LABEL, ProjectKind.options],
    ["project status", PROJECT_STATUS_LABEL, ProjectStatus.options],
  ] as const)("name every %s, with distinct, trimmed labels", (_, labels, values) => {
    expect(sorted(Object.keys(labels))).toEqual(sorted(values));
    const texts = Object.values(labels);
    expect(new Set(texts).size).toBe(texts.length);
    for (const t of texts) expect(t).toBe(t.trim());
  });

  it.each([
    ["status", STATUS_ORDER, Status.options],
    ["priority", PRIORITY_ORDER, Priority.options],
    ["sort", SORT_ORDER, SortKey.options],
    ["brief section", SECTION_ORDER, BriefSection.options],
    ["project kind", PROJECT_KIND_ORDER, ProjectKind.options],
    ["project status", PROJECT_STATUS_ORDER, ProjectStatus.options],
  ] as const)("order every %s exactly once", (_, order, values) => {
    expect(sorted(order)).toEqual(sorted(values));
  });

  it("keep the wording users know", () => {
    expect(VIEW_LABEL.cards).toBe("Tracker");
    expect(STATUS_ORDER.map((s) => STATUS_LABEL[s])).toEqual(["To do", "In progress", "In review", "Done"]);
    expect(SORT_LABEL.manual).toBe("Workflow");
    expect(SORT_LABEL.estimate).toBe("Duration");
    expect(SECTION_LABEL.moving).toBe("In progress");
    expect(PROJECT_KIND_ORDER.map((k) => PROJECT_KIND_LABEL[k]).join(" · ")).toBe("Website · Brand identity · Campaign · Product · Other");
  });

  it("rank urgent first", () => {
    expect([...PRIORITY_ORDER].sort((a, b) => PRIORITY_RANK[a] - PRIORITY_RANK[b])).toEqual(["urgent", "high", "medium", "low"]);
  });
});
