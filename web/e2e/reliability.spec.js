import { test, expect } from "@playwright/test";

// Reliability smoke tests run in demo mode so they do not mutate Firebase data.
// These cover important task actions that should remain stable before v0.1 sharing.

async function enterDemo(page) {
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

function taskRowByTitle(page, title) {
  return page
    .getByTestId("today-tasks-list")
    .locator('[data-testid="task-row"]', { hasText: title })
    .first();
}

test("reliability: deleted today task can be undone", async ({ page }) => {
  await enterDemo(page);

  const title = "25-minute deep work block";
  const tasksList = page.getByTestId("today-tasks-list");
  const row = taskRowByTitle(page, title);
  await expect(row).toBeVisible({ timeout: 8_000 });

  await row.getByTestId("task-menu-btn").click();
  await row.getByTestId("task-menu-delete").click();

  await expect(tasksList.getByText(title)).not.toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(tasksList.getByText(title)).toBeVisible({ timeout: 5_000 });
});

test("reliability: today task can be moved to the roadmap", async ({ page }) => {
  await enterDemo(page);

  const title = "25-minute deep work block";
  const tasksList = page.getByTestId("today-tasks-list");
  const row = taskRowByTitle(page, title);
  await expect(row).toBeVisible({ timeout: 8_000 });

  await row.getByTestId("task-menu-btn").click();
  await row.getByText("Move to roadmap").click();
  await row.getByText("This Week").click();

  await expect(tasksList.getByText(title)).not.toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "Roadmap" }).click();
  await expect(page.getByText(title)).toBeVisible({ timeout: 5_000 });
});

test("reliability: pinning a task sets Now Focus", async ({ page }) => {
  await enterDemo(page);

  const title = "25-minute deep work block";
  const row = taskRowByTitle(page, title);
  await expect(row).toBeVisible({ timeout: 8_000 });

  await row.getByTestId("task-menu-btn").click();
  await row.getByText("Pin to Focus").click();

  const focusCard = page.locator(".focus-card");
  await expect(focusCard).toBeVisible({ timeout: 5_000 });
  await expect(focusCard).toContainText(title);
});

test("reliability: low-energy mode filters to low-energy tasks and can be toggled off", async ({ page }) => {
  await enterDemo(page);

  const tasksList = page.getByTestId("today-tasks-list");
  await expect(tasksList.getByText("Reply to the important message")).toBeVisible({ timeout: 8_000 });

  await page.locator("button.stuck-btn", { hasText: "Low Energy" }).click();

  await expect(tasksList.getByText("10-minute walk")).toBeVisible({ timeout: 5_000 });
  await expect(tasksList.getByText("Reply to the important message")).not.toBeVisible({ timeout: 5_000 });

  await page.locator("button.stuck-btn", { hasText: "Low Energy ON" }).click();
  await expect(tasksList.getByText("Reply to the important message")).toBeVisible({ timeout: 5_000 });
});
