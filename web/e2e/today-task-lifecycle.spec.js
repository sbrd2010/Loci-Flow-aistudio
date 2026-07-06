import { test, expect } from "@playwright/test";

// Today task lifecycle smoke tests run in demo mode so they do not mutate Firebase data.
// They protect the daily execution loop: add, edit, focus, complete, undo, delete, undo.

async function enterDemo(page, viewport = { width: 375, height: 812 }) {
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("today-tasks-list")).toBeVisible({ timeout: 8_000 });
}

function todayRow(page, title) {
  return page.getByTestId("today-tasks-list").locator("[data-testid='task-row']", { hasText: title }).first();
}

async function openAddTask(page) {
  await page.getByTestId("fab-add-task").click();
  await expect(page.getByTestId("fab-add-task-option")).toBeVisible({ timeout: 5_000 });
  await page.getByTestId("fab-add-task-option").click();
  await expect(page.getByRole("heading", { name: "Add Task" })).toBeVisible({ timeout: 5_000 });
}

async function openTaskMenu(page, title) {
  const row = todayRow(page, title);
  await row.scrollIntoViewIfNeeded();
  await expect(row).toBeVisible({ timeout: 5_000 });
  await row.locator(".task-row-top").click();
}

async function expectNoHorizontalOverflow(page) {
  const widths = await page.evaluate(() => {
    const measured = [
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
    ];
    document.querySelectorAll(
      ".app-container, .screen-content, .tasks-section, .tasks-list, .task-row, .modal-card, .focus-mode-overlay"
    ).forEach((el) => {
      measured.push(el.scrollWidth);
    });
    return {
      innerWidth: window.innerWidth,
      maxScrollWidth: Math.max(...measured),
    };
  });

  expect(widths.maxScrollWidth).toBeLessThanOrEqual(widths.innerWidth + 8);
}

test("mobile reliability: Today task can be added, edited, focused, completed, restored, deleted, and undone", async ({ page }) => {
  await enterDemo(page);

  const originalTitle = "Today lifecycle seed task";
  const editedTitle = "Edited daily smoke item";

  await openAddTask(page);
  await page.getByTestId("add-task-title").fill(originalTitle);
  await page.getByTestId("add-task-submit").click();

  await expect(page.locator(".modal-card")).not.toBeVisible({ timeout: 5_000 });
  await expect(todayRow(page, originalTitle)).toBeVisible({ timeout: 5_000 });
  await expectNoHorizontalOverflow(page);

  await openTaskMenu(page, originalTitle);
  await page.getByTestId("task-menu-edit").click();
  await expect(page.getByRole("heading", { name: "Edit Task" })).toBeVisible({ timeout: 5_000 });
  await page.getByTestId("add-task-title").fill(editedTitle);
  await page.getByTestId("add-task-submit").click();

  await expect(page.locator(".modal-card")).not.toBeVisible({ timeout: 5_000 });
  await expect(todayRow(page, editedTitle)).toBeVisible({ timeout: 5_000 });
  await expect(todayRow(page, originalTitle)).not.toBeVisible({ timeout: 5_000 });

  await openTaskMenu(page, editedTitle);
  await page.getByText("Pin to Focus", { exact: true }).click();
  // Task moves to pinned section — overlay does not auto-open on pin
  const pinnedSection = page.locator(".pinned-focus-section");
  await expect(pinnedSection).toBeVisible({ timeout: 5_000 });
  // Open full-screen timer via the Focus → button
  await page.locator(".pinned-focus-start-btn").click();
  const focusOverlay = page.locator(".focus-mode-overlay");
  await expect(focusOverlay).toBeVisible({ timeout: 5_000 });
  await expect(focusOverlay.getByRole("heading", { name: editedTitle })).toBeVisible({ timeout: 5_000 });
  await expectNoHorizontalOverflow(page);
  await focusOverlay.getByLabel("Exit focus mode").click();
  await expect(focusOverlay).not.toBeVisible({ timeout: 5_000 });
  // Task stays in pinned section with its FOCUS badge
  await expect(pinnedSection).toContainText("FOCUS");

  // After pinning the task lives in the pinned section, not today-tasks-list;
  // use a page-wide row locator for all subsequent interactions
  const editedRow = page.locator("[data-testid='task-row']", { hasText: editedTitle }).first();

  await editedRow.getByTestId("task-checkbox").click();
  await expect(editedRow).toHaveClass(/completed/, { timeout: 5_000 });

  await editedRow.getByTestId("task-checkbox").click();
  await expect(editedRow).not.toHaveClass(/completed/, { timeout: 5_000 });

  await editedRow.locator(".task-row-top").click();
  await page.getByTestId("task-menu-delete").click();
  await expect(editedRow).not.toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/deleted/i)).toBeVisible({ timeout: 5_000 });

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(editedRow).toBeVisible({ timeout: 5_000 });
  await expectNoHorizontalOverflow(page);
});

test("mobile reliability: Today task can be parked from its row menu and disappears from Today", async ({ page }) => {
  await enterDemo(page);

  const title = "Park lifecycle seed task";
  await openAddTask(page);
  await page.getByTestId("add-task-title").fill(title);
  await page.getByTestId("add-task-submit").click();
  await expect(page.locator(".modal-card")).not.toBeVisible({ timeout: 5_000 });
  await expect(todayRow(page, title)).toBeVisible({ timeout: 5_000 });

  await openTaskMenu(page, title);
  await page.getByTestId("task-menu-park").click();
  await expect(todayRow(page, title)).not.toBeVisible({ timeout: 5_000 });
});

test("mobile reliability: Add Task accepts manual sub-steps from pasted bullets", async ({ page }) => {
  await enterDemo(page);

  const title = "Manual checklist seed task";
  await openAddTask(page);
  await page.getByTestId("add-task-title").fill(title);
  await page.getByRole("button", { name: /Advanced options/i }).click();
  await page.getByTestId("add-task-substeps-draft").fill("- Check visa rules\n2. Compare flight prices\nc) Book refundable hotel");
  await page.getByTestId("add-task-substeps-add").click();

  const subStepsList = page.getByTestId("add-task-substeps-list");
  await expect(subStepsList).toContainText("Check visa rules");
  await expect(subStepsList).toContainText("Compare flight prices");
  await expect(subStepsList).toContainText("Book refundable hotel");

  // Editing a step in place (the pencil icon) rewrites its text without removing it.
  await page.getByRole("button", { name: "Edit step Compare flight prices" }).click();
  await subStepsList.locator("input").fill("Compare flight and train prices");
  await subStepsList.locator("input").press("Enter");
  await expect(subStepsList).toContainText("Compare flight and train prices");
  await expect(subStepsList).not.toContainText("Compare flight prices");

  await page.getByRole("button", { name: "Remove step Compare flight and train prices" }).click();
  await expect(subStepsList).not.toContainText("Compare flight and train prices");

  await page.getByTestId("add-task-submit").click();
  await expect(page.locator(".modal-card")).not.toBeVisible({ timeout: 5_000 });
  const row = todayRow(page, title);
  await expect(row).toBeVisible({ timeout: 5_000 });
  await expect(row).toContainText("Check visa rules");
  await expect(row).toContainText("Book refundable hotel");
  await expect(row).not.toContainText("Compare flight prices");
});
