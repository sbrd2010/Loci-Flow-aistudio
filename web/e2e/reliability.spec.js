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

// Scoped to .bottom-nav so this never collides with in-page buttons that
// happen to contain a tab's name in their own label (e.g. Mind Box's "N
// notes → Roadmap Inbox" deep-link button).
async function openTab(page, name) {
  await page.locator(".bottom-nav").getByRole("button", { name }).click();
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

  await row.locator(".task-row-top").click();
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

  await row.locator(".task-row-top").click();
  await row.getByText("Move to roadmap").click();
  await expect(row.getByText("This Week")).toBeVisible({ timeout: 3_000 });
  await row.getByText("This Week").click();

  await expect(tasksList.getByText(title)).not.toBeVisible({ timeout: 5_000 });
  await openTab(page, "Roadmap");
  await expect(page.getByText(title)).toBeVisible({ timeout: 5_000 });
});

test("reliability: parked roadmap tasks are hidden after Bad Day Reset", async ({ page }) => {
  await enterDemo(page);

  const title = "25-minute deep work block";
  const tasksList = page.getByTestId("today-tasks-list");
  const row = taskRowByTitle(page, title);
  await expect(row).toBeVisible({ timeout: 8_000 });

  await row.locator(".task-row-top").click();
  await row.getByText("Move to roadmap").click();
  await expect(row.getByText("This Week")).toBeVisible({ timeout: 3_000 });
  await row.getByText("This Week").click();

  await expect(tasksList.getByText(title)).not.toBeVisible({ timeout: 5_000 });
  await openTab(page, "Roadmap");
  await expect(page.getByText(title)).toBeVisible({ timeout: 5_000 });

  await openTab(page, "Mind Box");
  await page.getByRole("button", { name: /Bad Day Reset/ }).click();
  await page.getByRole("button", { name: "Yes, restart" }).click();

  await openTab(page, "Roadmap");
  await expect(page.getByText(title)).not.toBeVisible({ timeout: 5_000 });
});

test("reliability: pinning a task sets Now Focus", async ({ page }) => {
  await enterDemo(page);

  const title = "25-minute deep work block";
  const row = taskRowByTitle(page, title);
  await expect(row).toBeVisible({ timeout: 8_000 });

  await row.locator(".task-row-top").click();
  await row.getByText("Pin to Focus").click();

  // Task appears in pinned section — overlay does not auto-open on pin
  const pinnedSection = page.locator(".pinned-focus-section");
  await expect(pinnedSection).toBeVisible({ timeout: 5_000 });
  await expect(pinnedSection).toContainText(title);
});

test("reliability: brain dump item survives tab switch and is browsable via Roadmap's Inbox", async ({ page }) => {
  await enterDemo(page);

  // Navigate to Mind Box and add a brain dump item via the inline form
  await openTab(page, "Mind Box");
  await expect(page.locator(".braindump-input").first()).toBeVisible({ timeout: 8_000 });

  const thought = "Test brain dump regression item";
  await page.locator(".braindump-input").first().fill(thought);
  await page.locator(".braindump-submit").first().click();

  // Mind Box's inbox button deep-links straight to Roadmap's Inbox — no
  // browsable list of its own anymore.
  await page.getByTestId("brain-dump-inbox-btn").click();
  await expect(page.getByRole("heading", { name: "Horizon Planning" })).toBeVisible({ timeout: 8_000 });
  const dumpItem = page.locator('[data-testid="dump-item"]').filter({ hasText: thought });
  await expect(dumpItem).toBeVisible({ timeout: 5_000 });

  // Switch away and back — item must survive the tab switch
  await openTab(page, "Mind Box");
  await openTab(page, "Roadmap");
  await page.getByRole("tab", { name: /Inbox/ }).click();
  await expect(dumpItem).toBeVisible({ timeout: 5_000 });
});

test("reliability: low-energy mode filters to low-energy tasks and can be toggled off", async ({ page }) => {
  await enterDemo(page);

  const tasksList = page.getByTestId("today-tasks-list");
  // "25-minute deep work block" is P2 — visible in normal mode
  await expect(tasksList.getByText("25-minute deep work block")).toBeVisible({ timeout: 8_000 });

  await page.locator("button.stuck-btn", { hasText: "Low Energy" }).click();

  // Low energy shows only P4 tasks; P4 "10-minute walk" visible, P2 block hidden
  await expect(tasksList.getByText("10-minute walk")).toBeVisible({ timeout: 5_000 });
  await expect(tasksList.getByText("25-minute deep work block")).not.toBeVisible({ timeout: 5_000 });

  await page.locator("button.stuck-btn", { hasText: "Low Energy ON" }).click();
  await expect(tasksList.getByText("25-minute deep work block")).toBeVisible({ timeout: 5_000 });
});

test("reliability: Today's overflow menu reveals Anchors and Must-Do, closes on outside click", async ({ page }) => {
  await enterDemo(page);

  const chipRow = page.locator(".focus-now-chip-row");
  await expect(chipRow.getByText("One Task", { exact: false })).toBeVisible({ timeout: 8_000 });
  // Anchors and Must-Do are no longer always-visible chips in the row.
  await expect(chipRow.getByRole("button", { name: "Anchors", exact: false })).toHaveCount(0);
  await expect(chipRow.getByRole("button", { name: "Must-Do", exact: false })).toHaveCount(0);

  await page.getByRole("button", { name: "More options" }).click();
  const menu = page.getByTestId("today-more-menu");
  await expect(menu).toBeVisible({ timeout: 5_000 });
  await expect(menu.getByText("Anchors", { exact: false })).toBeVisible();
  await expect(menu.getByText("Must-Do", { exact: false })).toBeVisible();

  // Clicking Must-Do toggles the mode and closes the menu.
  await menu.getByText("Must-Do", { exact: false }).click();
  await expect(menu).not.toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("MUST-DOS")).toBeVisible({ timeout: 5_000 });

  // Reopen, then click outside — menu should close without acting.
  await page.getByRole("button", { name: "More options" }).click();
  await expect(page.getByTestId("today-more-menu")).toBeVisible({ timeout: 5_000 });
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId("today-more-menu")).not.toBeVisible({ timeout: 5_000 });
});
