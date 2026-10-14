// The domain primitives moved out of v0 (plan §2, step 6) say and do exactly what v0 did.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { NAMED_COLOURS, normaliseHex } from "@/lib/domain/colours";
import { PRIORITY_LABEL, PRIORITY_ORDER, PRIORITY_RANK, SECTION_LABEL, SORT_LABEL, SORT_ORDER, STATUS_LABEL, STATUS_ORDER, VIEW_LABEL } from "@/lib/domain/labels";
import { formatMoney } from "@/lib/domain/money";
import { homeView, nextViews, TASK_VIEWS, VIEW_ORDER } from "@/lib/domain/views";
import type { ViewKind } from "@/lib/domain/schema/primitives";
import { SECTION_LABEL as V0_SECTION_LABEL } from "../legacy/v0/lib/brief";
import { interpretDemo } from "../legacy/v0/lib/interpret/demo";
import { normaliseHex as v0NormaliseHex } from "../legacy/v0/lib/mood";
import { applyOperations } from "../legacy/v0/lib/ops";
import {
  ALL_VIEWS,
  PRIORITY_LABEL as V0_PRIORITY_LABEL,
  PRIORITY_ORDER as V0_PRIORITY_ORDER,
  PRIORITY_RANK as V0_PRIORITY_RANK,
  REPRESENTATION_LABEL,
  SORT_LABEL as V0_SORT_LABEL,
  STATUS_LABEL as V0_STATUS_LABEL,
  STATUS_ORDER as V0_STATUS_ORDER,
  type Doc,
} from "../legacy/v0/lib/schema";
import { emptyDoc } from "../legacy/v0/lib/seed";
import { fmtEuro } from "../legacy/v0/lib/selectors";
import { homeView as v0HomeView, nextViews as v0NextViews, TASK_VIEWS as V0_TASK_VIEWS } from "../legacy/v0/lib/views";

/** Every ordered selection of distinct views: all the `views` lists a project can have */
function viewLists(): ViewKind[][] {
  const out: ViewKind[][] = [];
  const grow = (list: ViewKind[]) => {
    if (list.length) out.push(list);
    for (const v of VIEW_ORDER) if (!list.includes(v)) grow([...list, v]);
  };
  grow([]);
  return out;
}

const docWithViews = (views: ViewKind[]): Doc => {
  const doc = applyOperations(emptyDoc(), [{ op: "createProject", title: "Website", template: "website", representation: "cards" }]);
  return { ...doc, tool: { ...doc.tool!, views } };
};

describe("labels", () => {
  it("are v0's", () => {
    expect(STATUS_LABEL).toEqual(V0_STATUS_LABEL);
    expect(STATUS_ORDER).toEqual(V0_STATUS_ORDER);
    expect(PRIORITY_LABEL).toEqual(V0_PRIORITY_LABEL);
    expect(PRIORITY_ORDER).toEqual(V0_PRIORITY_ORDER);
    expect(PRIORITY_RANK).toEqual(V0_PRIORITY_RANK);
    expect(VIEW_LABEL).toEqual(REPRESENTATION_LABEL);
    expect(SECTION_LABEL).toEqual(V0_SECTION_LABEL);
  });

  it("add only the due-date sort to v0's sorts", () => {
    const { due, ...rest } = SORT_LABEL;
    expect(rest).toEqual(V0_SORT_LABEL);
    expect(due).toBe("Due date");
    expect(SORT_ORDER.filter((s) => s !== "due")).toEqual(["manual", "priority", "progress", "status", "title", "estimate"]);
  });
});

describe("views", () => {
  it("keep v0's task views and view order", () => {
    expect(TASK_VIEWS).toEqual(V0_TASK_VIEWS);
    expect(VIEW_ORDER).toEqual(ALL_VIEWS);
  });

  it("suggest what v0 suggested, for every possible views list", () => {
    const lists = viewLists();
    expect(lists).toHaveLength(1956);
    for (const views of lists) {
      for (const max of [1, 3, 6]) expect(nextViews(views, max)).toEqual(v0NextViews(views, max));
    }
    expect(nextViews(undefined)).toEqual(v0NextViews(undefined));
  });

  it("go home where v0 went, whenever the project has a task view", () => {
    for (const views of viewLists()) {
      if (views.some((v) => TASK_VIEWS.includes(v))) expect(homeView(views)).toBe(v0HomeView(docWithViews(views)));
    }
    expect(homeView(null)).toBe(v0HomeView(emptyDoc()));
  });
});

describe("colours", () => {
  it("normalise hex codes exactly as v0 did", () => {
    const hexish = fc.string({ unit: fc.constantFrom(..."#0123456789abcdefABCDEFgx "), maxLength: 9 });
    fc.assert(
      fc.property(fc.oneof(hexish, fc.string()), (s) => {
        expect(normaliseHex(s)).toBe(v0NormaliseHex(s));
      }),
    );
  });

  it.each(NAMED_COLOURS.map(([name, hex]) => [name, hex]))("give %s the swatch v0's parser gave it (%s)", (name, hex) => {
    const doc = applyOperations(emptyDoc(), [{ op: "createProject", title: "Website", template: "website" }]);
    const result = interpretDemo(`Add the colour ${name} to the moodboard`, { doc, selectedId: null });
    const add = result.ops.find((o) => o.op === "addMoodItems");
    expect(add && add.op === "addMoodItems" ? add.items.map((i) => i.hex) : null).toEqual([hex]);
  });
});

describe("money", () => {
  it("formats whole euro amounts as v0 did", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000_000 }), (euros) => {
        expect(formatMoney(euros * 100, "EUR")).toBe(fmtEuro(euros));
      }),
    );
    expect(formatMoney(null, "EUR")).toBe(fmtEuro(null));
  });
});
