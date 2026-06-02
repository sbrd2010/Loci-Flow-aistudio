import { test, expect } from "@playwright/test";

// All tests run against demo mode — no Firebase auth required.
// The sign-in screen shows a loading overlay while Firebase Auth initialises,
// then switches to the sign-in card with the demo button.

// Helper: enter demo mode from a fresh page load
async function enterDemo(page) {
  await page.goto("/");
  // Mock time to 10 AM so Evening Guard doesn't block task creation
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

test("1. App loads successfully", async ({ page }) => {
  await page.goto("/");
  // The React app must render — either the loading overlay or the sign-in card.
  await expect(page.locator(".signin-overlay")).toBeVisible({ timeout: 15_000 });
});

test("2. User can enter demo mode", async ({ page }) => {
  await page.goto("/");
  const demoBtn = page.getByTestId("demo-btn");
  await expect(demoBtn).toBeVisible({ timeout: 25_000 });
  await demoBtn.click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
});

test("3. User can see today tasks in demo mode", async ({ page }) => {
  await enterDemo(page);

  const tasksList = page.getByTestId("today-tasks-list");
  await expect(tasksList).toBeVisible({ timeout: 8_000 });

  const taskRows = tasksList.getByTestId("task-row");
  await expect(taskRows.first()).toBeVisible({ timeout: 8_000 });
  expect(await taskRows.count()).toBeGreaterThan(0);
});

test("4. User can complete a task", async ({ page }) => {
  await enterDemo(page);

  const tasksList = page.getByTestId("today-tasks-list");
  // First incomplete task-row (not .completed)
  const incompleteRow = tasksList.locator(".task-row:not(.completed)").first();
  await expect(incompleteRow).toBeVisible({ timeout: 8_000 });

  // Click the checkbox to mark complete
  await incompleteRow.getByTestId("task-checkbox").click();

  // A "Completed" section header should now appear
  await expect(tasksList.locator(".completed-section-title")).toBeVisible({ timeout: 5_000 });
});

test("5. Confetti/completion does not crash the app", async ({ page }) => {
  const jsErrors = [];
  page.on("pageerror", (err) => jsErrors.push(err.message));

  await enterDemo(page);

  const tasksList = page.getByTestId("today-tasks-list");
  const incompleteRow = tasksList.locator(".task-row:not(.completed)").first();
  await expect(incompleteRow).toBeVisible({ timeout: 8_000 });

  // Complete a task — triggers confetti + sound
  await incompleteRow.getByTestId("task-checkbox").click();

  // Wait briefly for confetti animation to fire
  await page.waitForTimeout(600);

  // App container must still be present — no crash
  await expect(page.locator(".app-container")).toBeVisible();

  // No uncaught JS exceptions (Firebase warnings are excluded)
  const criticalErrors = jsErrors.filter(
    (e) => !e.includes("Firebase") && !e.includes("firestore") && !e.includes("network")
  );
  expect(criticalErrors).toHaveLength(0);
});

test("6. User can create a new task", async ({ page }) => {
  await enterDemo(page);

  const tasksList = page.getByTestId("today-tasks-list");
  const beforeCount = await tasksList.locator(".task-row:not(.completed)").count();

  // Open add-task dialog via FAB speed-dial (two-step: expand then select)
  await page.getByTestId("fab-add-task").click();
  await page.getByTestId("fab-add-task-option").click();
  await expect(page.locator(".modal-card")).toBeVisible({ timeout: 5_000 });

  // Fill in the title and submit
  const newTitle = "Playwright test task";
  await page.getByTestId("add-task-title").fill(newTitle);
  await page.getByTestId("add-task-submit").click();

  // Dialog closes (shows success state, then auto-closes after 900ms)
  await expect(page.locator(".modal-card")).not.toBeVisible({ timeout: 5_000 });

  // New task appears in today list
  await expect(tasksList.getByText(newTitle)).toBeVisible({ timeout: 5_000 });
  expect(await tasksList.locator(".task-row:not(.completed)").count()).toBeGreaterThan(beforeCount);
});

test("7. User can edit a task", async ({ page }) => {
  await enterDemo(page);

  const tasksList = page.getByTestId("today-tasks-list");
  const firstRow = tasksList.locator(".task-row:not(.completed)").first();
  await expect(firstRow).toBeVisible({ timeout: 8_000 });

  // Open the ⋮ menu and click Edit
  await firstRow.getByTestId("task-menu-btn").click();
  const editBtn = firstRow.getByTestId("task-menu-edit");
  await expect(editBtn).toBeVisible({ timeout: 3_000 });
  await editBtn.click();

  // Full edit dialog (AddTaskDialog) should open
  await expect(page.locator(".modal-card")).toBeVisible({ timeout: 5_000 });

  // Change the title
  const editedTitle = "Edited by Playwright";
  await page.getByTestId("add-task-title").fill(editedTitle);

  // Save
  await page.getByTestId("add-task-submit").click();

  // Edited title appears in the list
  await expect(tasksList.getByText(editedTitle)).toBeVisible({ timeout: 5_000 });
});

test("8. User can delete a task", async ({ page }) => {
  await enterDemo(page);

  const tasksList = page.getByTestId("today-tasks-list");
  const firstRow = tasksList.locator(".task-row:not(.completed)").first();
  await expect(firstRow).toBeVisible({ timeout: 8_000 });

  // Read task title before deleting
  const taskTitle = await firstRow.locator(".task-title-text").textContent();

  // Open ⋮ menu and click Delete
  await firstRow.getByTestId("task-menu-btn").click();
  const deleteBtn = firstRow.getByTestId("task-menu-delete");
  await expect(deleteBtn).toBeVisible({ timeout: 3_000 });
  await deleteBtn.click();

  // Task immediately disappears (undo toast appears briefly, but task is gone from list)
  await expect(tasksList.getByText(taskTitle)).not.toBeVisible({ timeout: 5_000 });

  // App still functional
  await expect(page.locator(".app-container")).toBeVisible();
});

test("9. Focus timer starts and pauses", async ({ page }) => {
  await enterDemo(page);

  // Demo task demo-t1 has isNowFocus:true, so the focus card is immediately visible
  const focusCard = page.locator(".focus-card");
  await expect(focusCard).toBeVisible({ timeout: 8_000 });

  // Initially stopped — TodayTab play button shows ▶ (only one button at this point)
  const playPauseBtn = page.getByTestId("timer-play-pause");
  await expect(playPauseBtn).toBeVisible({ timeout: 5_000 });
  await expect(playPauseBtn).toContainText("▶");

  // Start the timer — this opens the full-screen Focus Mode overlay
  await playPauseBtn.click();

  // Overlay should now be visible
  const overlay = page.locator(".focus-mode-overlay");
  await expect(overlay).toBeVisible({ timeout: 3_000 });

  // Scope to overlay's play/pause button (avoids strict-mode violation from two matching testids)
  const overlayPlayBtn = overlay.getByTestId("timer-play-pause");
  await expect(overlayPlayBtn).toContainText("⏸", { timeout: 3_000 });

  // Pause the timer from within the overlay
  await overlayPlayBtn.click();
  await expect(overlayPlayBtn).toContainText("▶", { timeout: 3_000 });
});

test("10. Demo banner is visible and clearly says data is not saved", async ({ page }) => {
  await enterDemo(page);

  const banner = page.getByTestId("demo-banner");
  await expect(banner).toBeVisible({ timeout: 5_000 });
  await expect(banner).toContainText("not saved");
});

test("11. User can navigate to Mind Box and add a Brain Dump item", async ({ page }) => {
  await enterDemo(page);

  // Navigate to Mind Box tab
  await page.getByLabel("Mind Box").click();
  await expect(page.locator("h2:has-text('Mind Box')")).toBeVisible({ timeout: 5_000 });

  // Type in the brain dump input and submit
  const rawThought = "Brainstorming Playwright E2E tests";
  const dumpInput = page.locator(".braindump-input");
  await expect(dumpInput).toBeVisible();
  await dumpInput.fill(rawThought);
  await page.locator(".braindump-submit").click();

  // The recent thought list should render it
  await expect(page.locator(".mindbox-card").first()).toBeVisible();
  await expect(page.getByText(rawThought)).toBeVisible({ timeout: 5_000 });
});

test("12. User can execute Bad Day Reset in Mind Box", async ({ page }) => {
  await enterDemo(page);

  // Navigate to Mind Box tab
  await page.getByLabel("Mind Box").click();

  // Click Bad Day Reset button
  const badDayBtn = page.locator(".mindbox-card:has-text('Bad Day Reset')");
  await expect(badDayBtn).toBeVisible();
  await badDayBtn.click();

  // Confirm dialog should appear
  const confirmBtn = page.getByRole("button", { name: "Yes, restart" });
  await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
  await confirmBtn.click();

  // Unfinished tasks on Today tab should now be parked. Go back to Today tab to check.
  await page.getByLabel("Today").click();
  const tasksList = page.getByTestId("today-tasks-list");
  // There should be no active tasks left in the today queue (all moved to parked)
  await expect(tasksList.locator(".task-row:not(.completed)")).toHaveCount(0);
});

test("13. User can change settings in Settings tab", async ({ page }) => {
  await enterDemo(page);

  // Navigate to Settings
  await page.getByLabel("Settings").click();
  await expect(page.locator("h2:has-text('Your Profile')")).toBeVisible({ timeout: 5_000 });

  // Open settings form if closed
  const nameInput = page.locator("#settings-name");
  if (!(await nameInput.isVisible())) {
    await page.getByText("Your Profile").click();
  }
  await expect(nameInput).toBeVisible();

  // Fill in new name
  const newName = "QA Tester";
  await nameInput.fill(newName);

  // Submit profile settings
  await page.locator("form button[type='submit']").click();

  // Page header should update with the new name
  const headerName = page.locator(".user-badge");
  await expect(headerName).toContainText("QA", { timeout: 5_000 });
});
