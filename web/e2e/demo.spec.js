import { test, expect } from "@playwright/test";

// All tests run against demo mode — no Firebase auth required.

test("1. App loads successfully", async ({ page }) => {
  await page.goto("/");
  // Sign-in screen or main app must render without a JS crash
  await expect(page.locator("body")).not.toBeEmpty();
  // The sign-in card or app container must appear
  await expect(
    page.locator(".signin-card, .app-container")
  ).toBeVisible({ timeout: 10_000 });
});

test("2. User can enter demo mode", async ({ page }) => {
  await page.goto("/");
  const demoBtn = page.getByTestId("demo-btn");
  await expect(demoBtn).toBeVisible({ timeout: 10_000 });
  await demoBtn.click();
  // Main app container should now be visible
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 8_000 });
});

test("3. User can see today tasks in demo mode", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 8_000 });

  const tasksList = page.getByTestId("today-tasks-list");
  await expect(tasksList).toBeVisible();

  // At least one task-row should be rendered from the demo data
  const taskRows = tasksList.getByTestId("task-row");
  await expect(taskRows.first()).toBeVisible();
  const count = await taskRows.count();
  expect(count).toBeGreaterThan(0);
});

test("10. Demo banner is visible and clearly says data is not saved", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 8_000 });

  const banner = page.getByTestId("demo-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("not saved");
});
