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
// happen to contain a tab's name in their own label (e.g. Mind Box's "N
// notes → Roadmap Inbox" deep-link button).
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
  await openTab(page, "Plan");
  await page.getByRole("button", { name: "HORIZONS" }).click();
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
  await openTab(page, "Plan");
  await page.getByRole("button", { name: "HORIZONS" }).click();
  await expect(page.getByText(title)).toBeVisible({ timeout: 5_000 });

  await openTab(page, "Mind Box");
  await page.getByRole("button", { name: /Bad Day Reset/ }).click();
  await page.getByRole("button", { name: "Yes, restart" }).click();

  await openTab(page, "Plan");
  await page.getByRole("button", { name: "HORIZONS" }).click();
  await expect(page.getByText(title)).not.toBeVisible({ timeout: 5_000 });
});

test("reliability: pinning a task sets Now Focus", async ({ page }) => {
  await enterDemo(page);

  const title = "25-minute deep work block";
  const row = taskRowByTitle(page, title);
  await expect(row).toBeVisible({ timeout: 8_000 });

  await row.locator(".task-row-top").click();
  await row.getByText("Pin to Focus").click();

  // The task becomes the wall's one thing — the overlay does not auto-open on pin
  const pinnedSection = page.locator(".today-wall");
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
  await openTab(page, "Plan");
  await page.getByRole("button", { name: "HORIZONS" }).click();
  await page.getByRole("tab", { name: /Inbox/ }).click();
  await expect(dumpItem).toBeVisible({ timeout: 5_000 });
});

test("reliability: Low energy is a switch that changes how a task starts, not which tasks show", async ({ page }) => {
  await enterDemo(page);

  const tasksList = page.getByTestId("today-tasks-list");
  const lowEnergy = page.getByRole("switch", { name: "Low energy" });
  await expect(tasksList.getByText("25-minute deep work block")).toBeVisible({ timeout: 8_000 });
  await expect(lowEnergy).toHaveAttribute("aria-checked", "false");

  // 37b: "Small starts drop to 5 min". The list is not filtered (Y4: Must-do
  // is the list's only filter), and the wall offers the smaller start.
  await lowEnergy.click();
  await expect(lowEnergy).toHaveAttribute("aria-checked", "true");
  await expect(tasksList.getByText("25-minute deep work block")).toBeVisible();
  await expect(tasksList.getByText("10-minute walk")).toBeVisible();
  await expect(page.locator(".wall-action", { hasText: "Start small — 5 minutes" })).toBeVisible();
  await expect(page.locator(".wall-action", { hasText: "Split it" })).toHaveCount(0);

  await lowEnergy.click();
  await expect(lowEnergy).toHaveAttribute("aria-checked", "false");
  await expect(page.locator(".wall-action", { hasText: "Split it" })).toBeVisible();
});

test("reliability: All · Must-do filters the list to must-dos and back", async ({ page }) => {
  await enterDemo(page);

  const tasksList = page.getByTestId("today-tasks-list");
  const all = page.getByRole("button", { name: /^All · \d+$/ });
  const must = page.getByRole("button", { name: /^Must-do · \d+$/ });
  await expect(all).toHaveAttribute("aria-pressed", "true", { timeout: 8_000 });
  await expect(must).toHaveText("Must-do · 0");

  const title = "10-minute walk";
  const row = taskRowByTitle(page, title);
  await row.locator(".task-row-top").click();
  await page.getByText("Mark as must-do").click();
  await expect(row.locator(".task-tag.is-must")).toHaveText("MUST", { timeout: 5_000 });
  await expect(must).toHaveText("Must-do · 1");

  await must.click();
  await expect(must).toHaveAttribute("aria-pressed", "true");
  await expect(tasksList.getByText(title)).toBeVisible();
  await expect(tasksList.getByText("25-minute deep work block")).not.toBeVisible();

  await all.click();
  await expect(tasksList.getByText("25-minute deep work block")).toBeVisible({ timeout: 5_000 });
});
