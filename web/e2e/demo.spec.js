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
  await firstRow.locator(".task-row-top").click();
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
  await firstRow.locator(".task-row-top").click();
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

test("13. Brain dump long-note gate — move as-is lands in horizon", async ({ page }) => {
  await enterDemo(page);

  // Navigate to Roadmap and open Brain Dump Inbox
  await page.getByRole("button", { name: "Roadmap" }).click();
  await page.getByRole("tab", { name: /Inbox/ }).click();

  // Demo item bd4 is > 20 words — it should be in the inbox
  const longItemText = "I need to figure out if I should change";
  const dumpItem = page.locator('[data-testid="dump-item"]').filter({ hasText: longItemText });
  await expect(dumpItem).toBeVisible({ timeout: 5_000 });

  // Clicking "→ Week" should trigger the long-note gate, not move immediately
  await dumpItem.getByRole("button", { name: "→ Week" }).click();
  await expect(dumpItem.getByText("This note is long")).toBeVisible({ timeout: 3_000 });

  // Item still in inbox (not yet moved — waiting for user decision)
  await expect(dumpItem).toBeVisible();

  // Choose "Move as-is" — task should land in Week, item should leave inbox
  await dumpItem.getByRole("button", { name: "Move as-is" }).click();
  await expect(dumpItem).not.toBeVisible({ timeout: 5_000 });

  // Switch to Week horizon and verify the task is there
  await page.getByRole("tab", { name: /^Week/ }).click();
  await expect(page.getByText(longItemText)).toBeVisible({ timeout: 5_000 });
});

// Helper: open Day Map, auto-fill, and return it ready for toggle tests
async function openDayMapWithTasks(page) {
  await enterDemo(page);
  await page.getByTitle("Open Day Map").click();
  await expect(page.locator(".day-map-page")).toBeVisible({ timeout: 8_000 });
  const autoFill = page.getByRole("button", { name: "Auto-fill" });
  const autoFillVisible = await autoFill.isVisible();
  if (autoFillVisible) {
    const disabled = await autoFill.isDisabled();
    if (!disabled) await autoFill.click();
  }
}

test("11. Day Map route timeline — always visible, no view toggle", async ({ page }) => {
  await openDayMapWithTasks(page);

  // Route timeline is the only view — no toggle present
  await expect(page.locator(".dm-timeline")).toBeVisible({ timeout: 5_000 });
  await expect(page.locator(".dm-view-toggle")).not.toBeVisible();
  await expect(page.locator(".dmb-grid")).not.toBeVisible();
});

test("12. Deadline card shows redesigned compact layout in demo mode", async ({ page }) => {
  await enterDemo(page);

  const card = page.getByTestId("deadline-card");
  await expect(card).toBeVisible({ timeout: 5_000 });

  // Row 1: deadline countdown (days + "left")
  await expect(card).toContainText("d");
  await expect(card).toContainText("left");

  // Row 2: TODAY'S MOVE is visible as the primary action anchor
  await expect(card).toContainText("TODAY'S MOVE");
  await expect(card).toContainText("Apply to one job today");

  // Demo config sets deadlineTodayExpiresAt (6h from load) so live countdown appears
  await expect(card).toContainText("left today");

  // OPEN/STILL OPEN/DONE button present (demo config has no done date)
  const btn = page.getByTestId("deadline-done-btn");
  await expect(btn).toBeVisible();
  const btnText = await btn.textContent();
  expect(["OPEN", "STILL OPEN"].includes(btnText.trim())).toBe(true);

  // Card label shown
  await expect(card).toContainText("Visa & career deadline");
});

test("14. Settings hours sync to Today card live countdown", async ({ page }) => {
  await enterDemo(page);

  // Navigate to Settings and set 2h for today
  await page.getByRole("button", { name: "Settings" }).click();
  const twoHourBtn = page.locator('button').filter({ hasText: /^2h$/ }).first();
  await expect(twoHourBtn).toBeVisible({ timeout: 5_000 });
  await twoHourBtn.click();

  // Navigate back to Today tab
  await page.getByRole("button", { name: "Today" }).click();

  // Deadline card should now show a live countdown ("left today"), not the fallback
  const card = page.getByTestId("deadline-card");
  await expect(card).toBeVisible({ timeout: 5_000 });
  await expect(card).toContainText("left today", { timeout: 5_000 });
});
