// ED-9 (plan §8.5): interaction states that no still shows, asserted on v2 builds. Q3: FORM never
// invents a capacity or a duration.
//   - "+ Duration" opens the stepper empty ("—"); nothing is written until the first "+", which
//     sets half a day (v0 wrote 1 day on open);
//   - Team's "Add person" adds someone with a visible 5 days a week ("0/5d");
//   - a person added by a command has no capacity until it is given ("Capacity unknown").
// Chromium at 1440×900, reduced motion, on the stepped clock like the stills.
import { expect, test } from "@playwright/test";
import { ENGINE } from "./env";
import { textOf } from "./expected";
import { open } from "./settle";

test.use({ reducedMotion: "reduce" });
test.skip(ENGINE !== "v2", "ED-9 describes v2's behaviour; v0 wrote the values Q3 removes");
test.skip(({ browserName }) => browserName !== "chromium", "Asserted once per run, in Chromium");

test("ED-9: + Duration opens the stepper empty, and the first + sets half a day", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  // Visual Direction's estimate is cleared in this fixture
  const app = await open(page, { doc: "clearedEstimate" });
  const card = page.locator("[data-task-id]").filter({ hasText: "Visual Direction" }).first();
  await card.getByRole("button", { name: "+ Duration" }).click();
  await app.settle();
  const stepper = card.locator("div.group.flex.items-center").filter({ has: page.getByRole("button", { name: "Longer" }) });
  expect(await textOf(stepper), "open and empty: nothing written yet").toBe("—");
  const estimate = () =>
    page.evaluate(() => {
      type Task = { title: string; estimateDays: number | null };
      const s = (window as unknown as { __form: { getState(): { activeProjectId: string; docs: { projects: Record<string, { tasks: Record<string, Task> }> } } } }).__form.getState();
      return Object.values(s.docs.projects[s.activeProjectId].tasks).find((t) => t.title === "Visual Direction")?.estimateDays;
    });
  expect(await estimate(), "the estimate is still unknown in the document").toBeNull();
  await stepper.getByRole("button", { name: "Longer" }).click();
  await app.settle();
  expect(await textOf(stepper), "the first + sets half a day").toBe("0.5d");
});

test("ED-9: Team's Add person gives a visible 5 days a week", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  const app = await open(page, { doc: "docDemo" });
  await app.tab("team");
  const before = await page.locator("[data-team-row]").count();
  await app.click("Add person");
  await expect(page.locator("[data-team-row]")).toHaveCount(before + 1);
  const row = page.locator("[data-team-row]").last();
  expect(await textOf(row.locator("div.flex-col.items-end")), "a new person in a form starts at 5 days a week").toBe("0/5d 5d free");
});

test("ED-9: a person added by a command shows Capacity unknown", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  const app = await open(page, { doc: "docDemo" });
  await app.command("Add Giulia to the team");
  await app.tab("team");
  const row = page.locator("[data-team-row]").filter({ has: page.getByRole("textbox", { name: "Name" }).filter({ hasText: "Giulia" }) });
  await expect(row).toHaveCount(1);
  expect(await textOf(row.locator("div.flex-col.items-end")), "no capacity, no verdict").toBe("0d Capacity unknown");
});
