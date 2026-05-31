import { test, expect } from "@playwright/test";

// All tests run against demo mode — no Firebase auth required.
// The sign-in screen shows a loading overlay while Firebase Auth initialises,
// then switches to the sign-in card. Tests account for this transition.

test("1. App loads successfully", async ({ page }) => {
  await page.goto("/");
  // The app must render SOMETHING — either the loading overlay or the sign-in card.
  // Both are inside .signin-overlay, so checking that is sufficient.
  await expect(page.locator(".signin-overlay")).toBeVisible({ timeout: 15_000 });
});

test("2. User can enter demo mode", async ({ page }) => {
  await page.goto("/");
  // Wait for Firebase Auth to resolve — demo button only appears after auth loading finishes
  const demoBtn = page.getByTestId("demo-btn");
  await expect(demoBtn).toBeVisible({ timeout: 20_000 });
  await demoBtn.click();
  // Main app container should now be visible
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
});

test("3. User can see today tasks in demo mode", async ({ page }) => {
  await page.goto("/");
  // Wait for auth to resolve, then enter demo
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });

  const tasksList = page.getByTestId("today-tasks-list");
  await expect(tasksList).toBeVisible({ timeout: 8_000 });

  // At least one task-row should be rendered from the demo data
  const taskRows = tasksList.getByTestId("task-row");
  await expect(taskRows.first()).toBeVisible({ timeout: 8_000 });
  const count = await taskRows.count();
  expect(count).toBeGreaterThan(0);
});

test("10. Demo banner is visible and clearly says data is not saved", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });

  const banner = page.getByTestId("demo-banner");
  await expect(banner).toBeVisible({ timeout: 5_000 });
  await expect(banner).toContainText("not saved");
});
