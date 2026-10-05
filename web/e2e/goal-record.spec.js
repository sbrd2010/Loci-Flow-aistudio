import { test, expect } from "@playwright/test";

// The goal record (Q57.2, frames 63a–l): Today's gold band opens it — a 400px
// popover at 840 and wider, a bottom sheet under — with the recent days, one
// sentence, the next goal task (Make it the one thing, which brings a Plan
// task to Today, with Undo) and Edit goal as a link.

async function enterDemo(page, viewport) {
  await page.emulateMedia({ reducedMotion: "reduce" }); // measure the sheet at rest
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}
const nav = (page) => page.getByRole("navigation", { name: "Main navigation" });
const band = (page) => page.getByRole("button", { name: /^Your goal: Project launch.*Open goal record$/ });
const record = (page) => page.getByRole("dialog", { name: "Goal record: Project launch" });

test("laptop: the band opens a 400px popover under its right edge; Esc and the band close it", async ({ page }) => {
  await enterDemo(page, { width: 1600, height: 900 });
  await expect(band(page)).toHaveAttribute("aria-expanded", "false");
  await band(page).click();
  await expect(record(page)).toBeVisible();
  await expect(band(page)).toHaveAttribute("aria-expanded", "true");
  await expect(record(page)).toContainText("LAST 7 DAYS");
  // The demo's goal started today: no dots for days before it.
  await expect(record(page).locator(".gr-day")).toHaveCount(1);
  await expect(record(page).locator(".gr-sentence")).toHaveText("Today: not yet.");
  const b = await band(page).boundingBox();
  const r = await record(page).boundingBox();
  // Boxes are screen px, so sizes divide by the page's zoom (1 today).
  const z = await page.evaluate(() => document.documentElement.currentCSSZoom);
  expect(Math.round(r.width / z)).toBe(400);
  expect(Math.abs((r.x + r.width) - (b.x + b.width))).toBeLessThanOrEqual(1);
  expect(Math.round((r.y - (b.y + b.height)) / z)).toBe(8);

  await page.keyboard.press("Escape");
  await expect(record(page)).toHaveCount(0);
  await expect(band(page)).toBeFocused();
  await band(page).click();
  await expect(record(page)).toBeVisible();
  await page.mouse.click(b.x + 20, b.y + 10); // the band again
  await expect(record(page)).toHaveCount(0);

  await band(page).click();
  await record(page).getByRole("button", { name: "Edit goal" }).click();
  await expect(page.getByRole("heading", { name: "Key deadline", level: 2 })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Count days" })).toBeVisible();
});

test("a Plan goal task becomes the one thing from the record, and Undo sends it back", async ({ page }) => {
  await enterDemo(page, { width: 1280, height: 800 });
  // Put a This week task on the goal (its front).
  await nav(page).getByRole("button", { name: "Plan", exact: true }).click();
  await page.locator(".plan-row", { hasText: "Push the project" }).click();
  const detail = page.getByTestId("task-detail");
  await detail.getByRole("button", { name: /^Front/ }).click();
  await detail.getByRole("radio", { name: "Project launch" }).click();
  await expect(detail.locator(".task-tag.is-goal")).toBeVisible();
  await page.keyboard.press("Escape");

  await nav(page).getByRole("button", { name: "Today", exact: true }).click();
  await band(page).click();
  await expect(record(page).locator(".gr-next-title")).toContainText("Push the project");
  await record(page).getByRole("button", { name: "Make it the one thing" }).click();
  await expect(record(page)).toHaveCount(0);
  await expect(page.locator(".wall-title")).toContainText("Push the project");

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".wall-title")).not.toContainText("Push the project");
  await nav(page).getByRole("button", { name: "Plan", exact: true }).click();
  await expect(page.locator(".plan-row", { hasText: "Push the project" })).toBeVisible();
});

test("phone: a bottom sheet with the goal on top, Edit goal at the bottom; the scrim closes it", async ({ page }) => {
  await enterDemo(page, { width: 390, height: 844 });
  await band(page).click();
  await expect(record(page)).toBeVisible();
  await expect(record(page)).toHaveClass(/is-sheet/);
  await expect(record(page).locator(".gr-goal-name")).toHaveText("Project launch");
  const r = await record(page).boundingBox();
  expect(Math.round(r.y + r.height)).toBe(844);
  expect(Math.round(r.width)).toBe(390);
  await expect(record(page).locator(".gr-foot").getByRole("button", { name: "Edit goal" })).toBeVisible();
  await page.mouse.click(195, 300); // the scrim, above the sheet
  await expect(record(page)).toHaveCount(0);
});

test("small tablet 820: the sheet is 640 wide, centred, 16px off the bottom", async ({ page }) => {
  await enterDemo(page, { width: 820, height: 1180 });
  await band(page).click();
  const r = await record(page).boundingBox();
  expect(Math.round(r.width)).toBe(640);
  expect(Math.round(r.x)).toBe(90);
  expect(Math.round(1180 - (r.y + r.height))).toBe(16);
});
