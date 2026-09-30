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

// Q41: off the focus page, block end goes through the bar.
const BLOCK_OUT = 25 * 60_000 + 5_000;

test("at 0:00 off the focus page, no answer in 60 s pauses on a fresh block", async ({ page }) => {
  const bar = await sessionThenPlan(page);
  await page.clock.runFor(BLOCK_OUT);
  await expect(bar).toContainText("BLOCK 1 DONE");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.clock.runFor(61_000);
  await expect(bar.locator(".fb-of")).toHaveText("PAUSED");
  await expect(bar.locator(".fb-clock")).toHaveText("25:00");
});

test("Enter at block end on the bar takes the break", async ({ page }) => {
  const bar = await sessionThenPlan(page);
  await page.clock.runFor(BLOCK_OUT);
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("Enter");
  await expect(bar.locator(".fb-of")).toHaveText("BREAK");
});

// Codex review of #435: an End session question open at 0:00 stays open,
// and holds block end's 60 s wait.
test("End session… open as the block ends stays open, note and all", async ({ page }) => {
  const bar = await sessionThenPlan(page);
  await page.clock.runFor(25 * 60_000 - 3_000);
  await bar.getByRole("button", { name: "End session…" }).click();
  const ask = page.getByRole("dialog", { name: "End this session?" });
  await ask.getByRole("textbox", { name: /Where did you stop/ }).fill("Check the figures");
  await page.clock.runFor(70_000);
  await expect(ask).toBeVisible();
  await expect(ask.getByRole("textbox", { name: /Where did you stop/ })).toHaveValue("Check the figures");
  await expect(bar).toContainText("BLOCK 1 DONE");
});

test("Today's Back to focus row goes through block end in place", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.clock.install({ time: new Date("2024-06-15T10:00:00") });
  await page.goto("/");
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  await page.locator(".today-wall .wall-primary").click();
  const overlay = page.locator(".focus-mode-overlay");
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  await overlay.getByLabel("Leave focus").click();
  await page.clock.runFor(BLOCK_OUT);
  const primary = page.locator(".today-wall .wall-primary");
  await expect(primary).toContainText("BLOCK 1 DONE");
  await page.locator(".today-wall").getByRole("button", { name: "Take a break" }).click();
  await expect(primary).toContainText(/BREAK \d:\d{2}/);
  await page.clock.runFor(5 * 60_000 + 2_000);
  await expect(primary).toContainText("BREAK’S OVER");
  await page.locator(".today-wall").getByRole("button", { name: "Start block 2" }).click();
  await expect(page.locator(".today-wall").getByRole("button", { name: "Pause" })).toBeVisible();
});
