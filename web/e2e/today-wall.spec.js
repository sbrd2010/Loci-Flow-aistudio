import { test, expect } from "@playwright/test";

// Screen 1 — the wall and the desk.
//
// Deliberately does NOT seed loci_today_peek_open, unlike every other spec:
// this one is about the default, and the default is the wall. If it ever seeds
// the peek open, it stops testing the thing it exists for.

async function enterDemo(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

test("mobile reliability: Today opens on the wall, with the list put away", async ({ page }) => {
  await enterDemo(page);

  // The commitment is the dominant element and IS the start control.
  await expect(page.locator(".wall-hero")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".wall-title.is-wall")).toBeVisible();
  await expect(page.getByText("tap anywhere to begin")).toBeVisible();

  // No second filled primary competing with it.
  await expect(page.locator(".wall-primary")).toHaveCount(0);

  // The list is genuinely gone, not merely scrolled past. This asserts the
  // computed style because the section carries an INLINE display, and a class
  // rule cannot override one — an earlier attempt toggled a class, looked
  // correct, and hid nothing.
  const display = await page.locator(".tasks-section").evaluate(el => getComputedStyle(el).display);
  expect(display).toBe("none");
});

test("mobile reliability: the peek opens the desk and closes back to the wall", async ({ page }) => {
  await enterDemo(page);

  await page.locator(".wall-peek").click();

  // The hero stops being a button; an explicit primary appears instead.
  await expect(page.locator(".wall-hero")).toHaveCount(0);
  await expect(page.locator(".wall-title.is-desk")).toBeVisible();
  await expect(page.locator(".wall-primary")).toBeVisible();
  await expect(page.locator(".tasks-section")).toBeVisible();
  await expect(page.locator(".wall-peek-label")).toContainText(/AFTER THAT/);

  // Two-way: the toggle is a button in both states, so you can always get back.
  await page.locator(".wall-peek").click();
  await expect(page.locator(".wall-hero")).toBeVisible();
  const display = await page.locator(".tasks-section").evaluate(el => getComputedStyle(el).display);
  expect(display).toBe("none");
});

test("mobile reliability: the peek state survives a reload", async ({ page }) => {
  await enterDemo(page);
  await page.locator(".wall-peek").click();
  await expect(page.locator(".wall-title.is-desk")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });

  // peekOpen is persisted to localStorage, per the handoff.
  await expect(page.locator(".wall-title.is-desk")).toBeVisible({ timeout: 10_000 });
});

test("mobile reliability: tapping the wall starts a focus session on the commitment", async ({ page }) => {
  await enterDemo(page);

  const title = (await page.locator(".wall-title.is-wall").innerText()).trim();
  await page.locator(".wall-hero").click();

  const overlay = page.locator(".focus-mode-overlay");
  await expect(overlay).toBeVisible({ timeout: 10_000 });
  await expect(overlay.getByRole("heading", { name: title })).toBeVisible();
});

test("mobile reliability: a deadline a year out is not painted as time pressure", async ({ page }) => {
  await enterDemo(page);

  // Clay is the one alert colour and the design reserves it for real pressure.
  // The demo's deadline is ~365 days away, so the figure shows but stays quiet.
  const days = page.locator(".wall-head-days");
  await expect(days).toBeVisible();
  await expect(days).not.toHaveClass(/is-pressing/);
});
