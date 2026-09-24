import { test, expect } from "@playwright/test";

// Add task (45a phone sheet, 45k laptop dialog). Demo mode: nothing reaches
// Firebase. The horizon defaults to where + was tapped, and the sheet says so.

async function enterDemo(page, viewport = { width: 412, height: 892 }) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

async function openFromToday(page) {
  await page.locator(".today-list-add").click();
  await expect(page.getByRole("dialog", { name: "New task" })).toBeVisible({ timeout: 5_000 });
}

test("opened from Today: it says so, rings the horizon block, and the button names the horizon", async ({ page }) => {
  await enterDemo(page);
  await openFromToday(page);
  const dialog = page.getByRole("dialog", { name: "New task" });
  await expect(dialog.locator(".add-note")).toHaveText("Adding to Today because you opened it from Today. Change below.");
  await expect(dialog.getByRole("button", { name: "Today", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.locator(".add-block")).toHaveClass(/is-ringed/);
  await expect(dialog.locator(".add-block")).not.toHaveClass(/is-ringed/, { timeout: 4_000 });
  await expect(dialog.getByTestId("add-task-submit")).toHaveText("Add to Today");

  // Changing the horizon changes the button, and the task lands there.
  await dialog.getByRole("button", { name: "Week", exact: true }).click();
  await expect(dialog.getByTestId("add-task-submit")).toHaveText("Add to This week");
  await dialog.getByTestId("add-task-title").fill("Book the Lisbon train");
  await dialog.getByRole("button", { name: "1h", exact: true }).click();
  await dialog.getByTestId("add-task-submit").click();
  await expect(page.locator(".add-card")).toHaveCount(0, { timeout: 5_000 });
  await expect(page.getByTestId("today-tasks-list").getByText("Book the Lisbon train")).toHaveCount(0);
});

test("opened from Plan: the note names the column it came from", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("button", { name: "HORIZONS" }).click();
  await page.locator(".horizon-panel .column-add-btn").first().click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  await expect(dialog.locator(".add-note")).toContainText(/because you opened it from Plan · /);
  const pressed = (await dialog.locator(".add-block [aria-pressed='true']").first().innerText()).trim();
  expect(["Today", "Week", "Month", "Quarter", "6 mo", "Work"]).toContain(pressed);
});

test("a phone gets a bottom sheet; Escape closes it and Tab stays inside", async ({ page }) => {
  await enterDemo(page);
  await openFromToday(page);
  const card = page.locator(".add-card");
  const box = await card.boundingBox();
  expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(891);
  expect(Math.round(box.width)).toBe(412);
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    await expect(card.locator(":focus")).toHaveCount(1);
  }
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
});

test("a laptop gets a 520px dialog, and ⌘↵ adds the task", async ({ page }) => {
  await enterDemo(page, { width: 1280, height: 800 });
  await page.keyboard.press("n");
  const dialog = page.getByRole("dialog", { name: "New task" });
  await expect(dialog).toBeVisible();
  const box = await page.locator(".add-card").boundingBox();
  expect(Math.round(box.width)).toBe(520);
  expect(Math.round(box.x)).toBe((1280 - 520) / 2);
  await expect(dialog.locator(".add-kbd")).toBeVisible();
  await dialog.getByTestId("add-task-title").fill("Reply to Prof. Hale about the draft");
  await page.keyboard.press("Control+Enter");
  await expect(page.locator(".add-card")).toHaveCount(0, { timeout: 5_000 });
  await expect(page.getByTestId("today-tasks-list").getByText("Reply to Prof. Hale about the draft")).toBeVisible();
});

test("editing: no note, no ring, Save changes, and the extras sit under More details", async ({ page }) => {
  await enterDemo(page);
  const row = page.getByTestId("today-tasks-list").locator("[data-testid='task-row']").first();
  await row.locator(".task-row-top").click();
  await row.getByTestId("task-menu-edit").click();
  const dialog = page.getByRole("dialog", { name: "Edit task" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".add-note")).toHaveCount(0);
  await expect(dialog.locator(".add-block")).not.toHaveClass(/is-ringed/);
  await expect(dialog.getByTestId("add-task-submit")).toHaveText("Save changes");
  await expect(dialog.getByRole("button", { name: /More details/ })).toHaveAttribute("aria-expanded", "true");
  await expect(dialog.getByText("First step", { exact: true })).toBeVisible();
});
