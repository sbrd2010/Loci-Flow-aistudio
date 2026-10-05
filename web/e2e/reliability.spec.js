import { test, expect } from "@playwright/test";

// Reliability smoke tests run in demo mode so they do not mutate Firebase data.
// These cover important task actions that should remain stable before v0.1 sharing.

async function enterDemo(page) {
  // Today's list now lives behind the peek, closed by default (screen 1, "the
  // wall"). These specs were written when it was always on screen, and their
  // subject is the list, not the wall — so the precondition is established here
  // rather than by editing each assertion. today-wall.spec.js covers the
  // closed-by-default behaviour itself, without this seed.
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

// Scoped to the main navigation so this never collides with in-page buttons that
// happen to contain a tab's name in their own label.
async function openTab(page, name) {
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name, exact: true }).click();
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

  await row.locator(".task-title-text").click();
  await page.getByTestId("task-detail").getByRole("button", { name: /^Delete/ }).click();

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

  // Opened, its Horizon picker moves it (50a).
  await row.locator(".task-title-text").click();
  const detail = page.getByTestId("task-detail");
  await detail.getByRole("button", { name: /^Horizon/ }).click();
  await detail.getByRole("radiogroup", { name: "Horizon" }).getByRole("radio", { name: "This Week" }).click();

  await expect(tasksList.getByText(title)).not.toBeVisible({ timeout: 5_000 });
  await openTab(page, "Plan");
  await page.getByRole("tab", { name: "Horizons" }).click();
  await expect(page.getByText(title)).toBeVisible({ timeout: 5_000 });
});

test("reliability: Clear my day → Park takes Today's open tasks off the list, into Parked (Q52)", async ({ page }) => {
  await enterDemo(page);

  const title = "25-minute deep work block";
  const tasksList = page.getByTestId("today-tasks-list");
  await expect(taskRowByTitle(page, title)).toBeVisible({ timeout: 8_000 });

  const hide = page.locator(".today-list-hide");
  if (await hide.isVisible()) await hide.click();
  await page.getByRole("button", { name: "I’m stuck" }).click();
  const rescue = page.getByRole("dialog", { name: "Rescue" });
  await rescue.getByRole("button", { name: /^Too much going on/ }).click();
  await rescue.getByRole("button", { name: "Skip", exact: true }).click();
  await rescue.getByRole("button", { name: /^Clear my day/ }).click();
  await rescue.getByRole("radio", { name: "Park" }).click();
  await rescue.getByRole("button", { name: /^Move \d+ to Park$/ }).click();
  await rescue.getByRole("button", { name: /^Leave/ }).click();

  await expect(tasksList.getByText(title)).not.toBeVisible({ timeout: 5_000 });
  await expect(page.locator(".today-parked-kicker")).toContainText(/Parked · \d+/);
});

test("reliability: pinning a task sets Now Focus", async ({ page }) => {
  await enterDemo(page);

  const title = "25-minute deep work block";
  const row = taskRowByTitle(page, title);
  await expect(row).toBeVisible({ timeout: 8_000 });

  await row.locator(".task-title-text").click();
  await page.getByTestId("task-detail").getByRole("button", { name: /^Make this the one thing/ }).click();

  // The task becomes the wall's one thing — the overlay does not auto-open on pin
  const pinnedSection = page.locator(".today-wall");
  await expect(pinnedSection).toBeVisible({ timeout: 5_000 });
  await expect(pinnedSection).toContainText(title);
});

test("reliability: a thought survives a tab switch and stays in Mind Box", async ({ page }) => {
  await enterDemo(page);
  await openTab(page, "Mind Box");
  const field = page.locator(".mbx-field").getByRole("textbox", { name: "Thought" });
  await expect(field).toBeVisible({ timeout: 8_000 });

  const thought = "Test brain dump regression item";
  await field.fill(thought);
  await field.press("Enter");
  const row = page.getByTestId("thought-row").filter({ hasText: thought });
  await expect(row).toBeVisible({ timeout: 5_000 });

  // Switch away and back — the thought must survive the tab switch.
  await openTab(page, "Plan");
  await openTab(page, "Mind Box");
  await expect(row).toBeVisible({ timeout: 5_000 });
});

