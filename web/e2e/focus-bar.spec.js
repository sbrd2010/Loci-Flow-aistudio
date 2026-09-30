import { test, expect } from "@playwright/test";

// 59e: the focus bar — while a session runs and you are off the focus page,
// on Plan (and Mind Box, Coach, the Day map), never on Today. Back to focus
// (F), and End session… asks first (59h). Demo mode; nothing reaches Firebase.

async function sessionThenPlan(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.clock.install({ time: new Date("2024-06-15T10:00:00") });
  await page.goto("/");
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  await page.locator(".today-wall .wall-primary").click();
  const overlay = page.locator(".focus-mode-overlay");
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  await overlay.getByLabel("Leave focus").click();
  await expect(page.getByRole("region", { name: "Focus session" })).toHaveCount(0);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
  return page.getByRole("region", { name: "Focus session" });
}

test("on Plan the bar shows the session; F goes back to focus", async ({ page }) => {
  const bar = await sessionThenPlan(page);
  await expect(bar).toBeVisible();
  await expect(bar.locator(".fb-of")).toHaveText("OF 25:00");
  await bar.getByRole("button", { name: "Pause focus timer" }).click();
  await expect(bar.locator(".fb-of")).toHaveText("PAUSED");
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("f");
  await expect(page.locator(".focus-mode-overlay")).toBeVisible();
});

test("End session… from the bar asks, then ends the session", async ({ page }) => {
  const bar = await sessionThenPlan(page);
  await bar.getByRole("button", { name: "End session…" }).click();
  const ask = page.getByRole("dialog", { name: "End this session?" });
  await expect(ask).toContainText("The task stays open.");
  await ask.getByRole("button", { name: /^End session/ }).click();
  await expect(bar).toHaveCount(0);
});
