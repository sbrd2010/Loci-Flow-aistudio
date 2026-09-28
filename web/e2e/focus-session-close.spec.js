import { test, expect } from "@playwright/test";

// 59j: a session is one sitting. Start runs one block, not the estimate; a
// pause of more than 15 minutes closes the session, and so does the Loci day
// ending. Demo mode, so nothing reaches Firebase.

async function enterDemo(page, time) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await page.setViewportSize({ width: 375, height: 812 });
  // install(), not setFixedTime(): the timer and the minute tick must advance.
  await page.clock.install({ time: new Date(time) });
  await page.goto("/");
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

async function startFocus(page) {
  await page.locator(".today-wall .wall-primary").click();
  const overlay = page.locator(".focus-mode-overlay");
  await expect(overlay).toBeVisible({ timeout: 5_000 });
  return overlay;
}

test("Start runs one block of the Focus timer, not the task's estimate", async ({ page }) => {
  await enterDemo(page, "2024-06-15T10:00:00");
  const sheet = page.getByTestId("task-detail");
  await page.locator(".wall-title").click();
  await sheet.getByRole("button", { name: /^Estimate/ }).click();
  await sheet.getByRole("radio", { name: "2h" }).click();
  await sheet.getByRole("button", { name: "Close", exact: true }).click();

  await expect(page.locator(".wall-primary-figure")).toHaveText("25:00");
  const overlay = await startFocus(page);
  await expect(overlay.locator(".focus-mode-figures")).toContainText(/^OF 25:00/);
});

test("a pause of 15 minutes keeps the session; a longer one closes it", async ({ page }) => {
  await enterDemo(page, "2024-06-15T10:00:00");
  const overlay = await startFocus(page);
  await page.clock.runFor(5 * 60_000);
  await overlay.getByRole("button", { name: "Pause timer" }).click();

  await page.clock.runFor(14 * 60_000);
  await expect(overlay).toBeVisible();
  await expect(overlay.getByRole("button", { name: "Resume timer" })).toBeVisible();

  await page.clock.runFor(3 * 60_000);
  await expect(overlay).toHaveCount(0);
  // Nothing is left to resume: the wall offers a fresh start.
  await expect(page.locator(".wall-primary")).toContainText("Start focus");
  await expect(page.getByRole("button", { name: /^Return to Focus/ })).toHaveCount(0);
});

test("a session still running when the Loci day ends is closed", async ({ page }) => {
  // The demo's window runs 07:00–02:00: at 01:50 it is still the 15th's day.
  await enterDemo(page, "2024-06-16T01:50:00");
  const overlay = await startFocus(page);
  await page.clock.runFor(8 * 60_000);
  await expect(overlay).toBeVisible();
  await page.clock.runFor(4 * 60_000);
  await expect(overlay).toHaveCount(0);
});
