import { test, expect } from "@playwright/test";

// All tests run against demo mode — no Firebase auth required.
// The sign-in screen shows a loading overlay while Firebase Auth initialises,
// then switches to the sign-in card with the demo button.

test("1. App loads successfully", async ({ page }) => {
  await page.goto("/");
  // The React app must render — either the loading overlay or the sign-in card.
  // Both live inside .signin-overlay, so that selector covers both states.
  await expect(page.locator(".signin-overlay")).toBeVisible({ timeout: 15_000 });
});

test("2. User can enter demo mode", async ({ page }) => {
  await page.goto("/");
  // Wait for Firebase Auth to resolve — demo button appears only after auth loading finishes.
  const demoBtn = page.getByTestId("demo-btn");
  await expect(demoBtn).toBeVisible({ timeout: 25_000 });
  await demoBtn.click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
});

test("3. User can see today tasks in demo mode", async ({ page }) => {
  await page.goto("/");
  const demoBtn = page.getByTestId("demo-btn");
  await expect(demoBtn).toBeVisible({ timeout: 25_000 });
  await demoBtn.click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });

  const tasksList = page.getByTestId("today-tasks-list");
  await expect(tasksList).toBeVisible({ timeout: 8_000 });

  const taskRows = tasksList.getByTestId("task-row");
  await expect(taskRows.first()).toBeVisible({ timeout: 8_000 });
  expect(await taskRows.count()).toBeGreaterThan(0);
});

test("10. Demo banner is visible and clearly says data is not saved", async ({ page }) => {
  await page.goto("/");
  const demoBtn = page.getByTestId("demo-btn");
  await expect(demoBtn).toBeVisible({ timeout: 25_000 });
  await demoBtn.click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });

  const banner = page.getByTestId("demo-banner");
  await expect(banner).toBeVisible({ timeout: 5_000 });
  await expect(banner).toContainText("not saved");
});
