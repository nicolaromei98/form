import { describe, expect, it } from "vitest";
import * as limits from "@/lib/domain/limits";

describe("limits", () => {
  it("match the plan's table (§3.9)", () => {
    expect({
      TASK_TITLE: limits.TASK_TITLE,
      PROJECT_TITLE: limits.PROJECT_TITLE,
      PERSON_NAME: limits.PERSON_NAME,
      WORKSPACE_NAME: limits.WORKSPACE_NAME,
      TASKS_MAX: limits.TASKS_MAX,
      STEPS_MAX: limits.STEPS_MAX,
      DEPS_MAX: limits.DEPS_MAX,
      PEOPLE_MAX: limits.PEOPLE_MAX,
      MOOD_MAX: limits.MOOD_MAX,
      MOOD_ADD_MAX: limits.MOOD_ADD_MAX,
      BRIEF_LINES_MAX: limits.BRIEF_LINES_MAX,
      BRIEF_TEXT_MAX: limits.BRIEF_TEXT_MAX,
      OPS_PER_COMMAND: limits.OPS_PER_COMMAND,
      DOC_BYTES_MAX: limits.DOC_BYTES_MAX,
      ORDER_KEY_REBALANCE: limits.ORDER_KEY_REBALANCE,
      HISTORY_LIMIT: limits.HISTORY_LIMIT,
    }).toEqual({
      TASK_TITLE: 140,
      PROJECT_TITLE: 80,
      PERSON_NAME: 40,
      WORKSPACE_NAME: 60,
      TASKS_MAX: 500,
      STEPS_MAX: 40,
      DEPS_MAX: 50,
      PEOPLE_MAX: 100,
      MOOD_MAX: 200,
      MOOD_ADD_MAX: 24,
      BRIEF_LINES_MAX: 80,
      BRIEF_TEXT_MAX: 600,
      OPS_PER_COMMAND: 12,
      DOC_BYTES_MAX: 1_000_000,
      ORDER_KEY_REBALANCE: 48,
      HISTORY_LIMIT: 60,
    });
  });

  it("keep step titles as long as task titles, so promoting a step never truncates it", () => {
    expect(limits.STEP_TITLE).toBe(limits.TASK_TITLE);
  });

  it("leave room for the runner's rebalanceOrder in a commit", () => {
    expect(limits.COMMIT_OPS_MAX).toBe(limits.OPS_PER_COMMAND + 1);
    expect(limits.ORDER_KEY_REBALANCE).toBeLessThan(limits.ORDER_KEY_MAX);
  });

  it("are positive integers, apart from the bounds and the date window", () => {
    for (const [name, value] of Object.entries(limits)) {
      if (name === "MOOD_BOUNDS" || name === "DATE_MIN" || name === "DATE_MAX") continue;
      expect(Number.isSafeInteger(value) && (value as number) > 0, name).toBe(true);
    }
  });

  it("keep the date window inside the years an IsoDate can hold", () => {
    expect(limits.DATE_MIN < limits.DATE_MAX).toBe(true);
    expect(limits.DATE_MIN).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(limits.DATE_MAX).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
