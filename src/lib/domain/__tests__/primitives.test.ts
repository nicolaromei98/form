import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ESTIMATE_MAX_DAYS,
  LINK_LABEL,
  PERSON_NAME,
  PROJECT_TITLE,
  TAG,
  TASK_TITLE,
  URL_LENGTH,
  WORKSPACE_NAME,
} from "@/lib/domain/limits";
import {
  Allocation,
  Audience,
  BirthView,
  BLOCK_ORDER,
  BlockKind,
  BriefSection,
  halfDays,
  IsoDate,
  Line,
  LinkSchema,
  MoodKind,
  MoodLayout,
  Place,
  Priority,
  ProjectKind,
  ProjectStatus,
  SortKey,
  Status,
  Tag,
  TaskKind,
  Text,
  Timestamp,
  Timezone,
  Url,
  ViewKind,
  Weekday,
  WorkingDays,
} from "@/lib/domain/schema/primitives";

const ok = (schema: z.ZodType, value: unknown) => expect(schema.safeParse(value).success, JSON.stringify(value)).toBe(true);
const bad = (schema: z.ZodType, value: unknown) => expect(schema.safeParse(value).success, JSON.stringify(value)).toBe(false);

describe("IsoDate and Timestamp", () => {
  it("accept real dates in the stored window, leap days included", () => {
    for (const v of ["2026-10-14", "2024-02-29", "2000-02-29", "1970-01-01", "2199-12-31"]) ok(IsoDate, v);
  });

  it("reject impossible, malformed and out-of-window dates", () => {
    for (const v of ["2026-02-30", "2025-02-29", "1900-02-29", "2026-13-01", "2026-1-1", "2026-10-14T00:00:00Z", "1969-12-31", "2200-01-01", "", 20260214]) {
      bad(IsoDate, v);
    }
  });

  it("parse to the same string (parse equals validate)", () => {
    expect(IsoDate.parse("2026-10-14")).toBe("2026-10-14");
  });

  it("accept only UTC timestamps", () => {
    ok(Timestamp, "2026-10-14T09:00:00Z");
    ok(Timestamp, "2026-10-14T09:00:00.123Z");
    bad(Timestamp, "2026-10-14T09:00:00+02:00");
    bad(Timestamp, "2026-10-14");
  });
});

describe("halfDays", () => {
  const estimate = halfDays(0, ESTIMATE_MAX_DAYS);
  it("accepts half-day steps within the bounds", () => {
    for (const v of [0, 0.5, 2.5, 7, 250]) ok(estimate, v);
  });
  it("rejects other fractions and values out of bounds", () => {
    for (const v of [2.7, 0.25, -0.5, 250.5, Number.NaN, "2"]) bad(estimate, v);
  });
  it("starts at half a day for steps", () => {
    bad(halfDays(0.5, ESTIMATE_MAX_DAYS), 0);
    ok(halfDays(0.5, ESTIMATE_MAX_DAYS), 0.5);
  });
});

describe("Line and Text", () => {
  it.each([
    ["task titles", TASK_TITLE],
    ["project titles", PROJECT_TITLE],
    ["person names", PERSON_NAME],
    ["workspace names", WORKSPACE_NAME],
  ])("cap %s at %i characters", (_, max) => {
    ok(Line(max), "x".repeat(max));
    bad(Line(max), "x".repeat(max + 1));
  });

  it("want one trimmed, non-empty line", () => {
    const title = Line(TASK_TITLE);
    ok(title, "UI Design");
    for (const v of ["", " UI", "UI ", "UI\nDesign", "UI\rDesign", "\t"]) bad(title, v);
  });

  it("let text span lines but stay trimmed", () => {
    const text = Text(600);
    ok(text, "First line\nSecond line");
    bad(text, "\nFirst line");
    bad(text, "");
    bad(text, "x".repeat(601));
  });

  it("refuse commas in tags", () => {
    ok(Tag, "brand");
    ok(Tag, "x".repeat(TAG));
    bad(Tag, "x".repeat(TAG + 1));
    bad(Tag, "brand, web");
    bad(Tag, " brand");
  });
});

describe("Url and LinkSchema", () => {
  it("allow http and https only", () => {
    ok(Url, "https://example.com/brief");
    ok(Url, "http://localhost:3000");
    for (const v of ["javascript:alert(1)", "ftp://example.com", "mailto:a@b.co", "example.com", ""]) bad(Url, v);
  });

  it("cap urls at 2048 characters", () => {
    const base = "https://example.com/";
    ok(Url, base + "a".repeat(URL_LENGTH - base.length));
    bad(Url, base + "a".repeat(URL_LENGTH - base.length + 1));
  });

  it("check links strictly", () => {
    const link = { id: "lnk_0123456789abcdef", label: "Figma", url: "https://figma.com/file/x" };
    ok(LinkSchema, link);
    bad(LinkSchema, { ...link, extra: true });
    bad(LinkSchema, { ...link, id: "tsk_0123456789abcdef" });
    bad(LinkSchema, { ...link, label: "x".repeat(LINK_LABEL + 1) });
  });
});

describe("calendar primitives", () => {
  it("number weekdays 1 (Monday) to 7", () => {
    ok(Weekday, 1);
    ok(Weekday, 7);
    for (const v of [0, 8, 1.5]) bad(Weekday, v);
  });

  it("keep one to seven working days", () => {
    ok(WorkingDays, [1, 2, 3, 4, 5]);
    bad(WorkingDays, []);
    bad(WorkingDays, [1, 2, 3, 4, 5, 6, 7, 1]);
  });

  it("accept IANA time zones only", () => {
    ok(Timezone, "Europe/Rome");
    ok(Timezone, "UTC");
    for (const v of ["", "europe/rome", "+01:00", "Mars/Base"]) bad(Timezone, v);
  });
});

describe("enums", () => {
  it("list the plan's values in the plan's order", () => {
    expect(Status.options).toEqual(["todo", "active", "review", "done"]);
    expect(Priority.options).toEqual(["low", "medium", "high", "urgent"]);
    expect(TaskKind.options).toEqual(["task", "milestone"]);
    expect(ViewKind.options).toEqual(["cards", "board", "timeline", "team", "focus", "brief"]);
    expect(BirthView.options).toEqual(["cards", "board", "timeline"]);
    expect(BlockKind.options).toEqual(["header", "metrics", "progress", "collection", "moodboard", "budget", "activity"]);
    expect(BLOCK_ORDER).toEqual(BlockKind.options);
    expect(ProjectKind.options).toEqual(["website", "brand-identity", "campaign", "product", "other"]);
    expect(ProjectStatus.options).toEqual(["planning", "active", "on-hold", "done"]);
    expect(Audience.options).toEqual(["client", "team"]);
    expect(BriefSection.options).toEqual(["note", "done", "moving", "next", "risks", "questions"]);
    expect(SortKey.options).toEqual(["manual", "priority", "progress", "status", "title", "estimate", "due"]);
    expect(MoodKind.options).toEqual(["image", "color", "note"]);
    expect(MoodLayout.options).toEqual(["masonry", "grid", "collage"]);
  });

  it("have no archived project status (Q9: archiving lives in the index)", () => {
    bad(ProjectStatus, "archived");
  });

  it("allow the four allocations", () => {
    for (const v of [0.25, 0.5, 0.75, 1]) ok(Allocation, v);
    for (const v of [0, 0.3, 1.5]) bad(Allocation, v);
  });
});

describe("Place", () => {
  it("is start, end or after an existing task id", () => {
    ok(Place, "start");
    ok(Place, "end");
    ok(Place, { after: "tsk_0123456789abcdef" });
  });

  it("rejects other anchors", () => {
    for (const v of ["middle", { after: "stp_0123456789abcdef" }, { after: "tsk_0123456789abcdef", before: "x" }, { before: "tsk_0123456789abcdef" }, 0]) {
      bad(Place, v);
    }
  });
});
