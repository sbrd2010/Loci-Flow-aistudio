import { test, expect } from "@playwright/test";

// 50e–f: the Day map is Today's own page — Back (Esc), the title, and a day
// clock; Today stays current in the nav, which stays on screen.

async function enterDemo(page, viewport) {
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T11:35:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

async function openDayMapByKey(page) {
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("m");
  await expect(page.locator(".day-map-page")).toBeVisible();
}

test("phone: the Day map keeps the bottom nav with Today current, and its own header takes the app header's place (50e)", async ({ page }) => {
  await enterDemo(page, { width: 412, height: 892 });
  await openDayMapByKey(page);
  const nav = page.locator(".tab-bar");
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("button", { name: "Today" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".shell-header")).toBeHidden();

  // The clock: time left, and a bar of how much of the day has passed.
  await expect(page.locator(".dm-dayclock-left")).toHaveText(/^\d+h\d{2}m left$/);
  const bar = page.getByRole("progressbar", { name: "The day so far" });
  const passed = Number(await bar.getAttribute("aria-valuenow"));
  expect(passed).toBeGreaterThan(0);
  expect(passed).toBeLessThan(100);
  await expect(page.locator(".dm-dayclock-labels")).toContainText("11:35 NOW");

  // Today in the nav takes you back.
  await nav.getByRole("button", { name: "Today" }).click();
  await expect(page.locator(".day-map-page")).toHaveCount(0);
});

test("laptop: the app header stays with Today current; ‹ Today and Esc go back (50f)", async ({ page }) => {
  await enterDemo(page, { width: 1280, height: 800 });
  await openDayMapByKey(page);
  const header = page.locator(".shell-header");
  await expect(header).toBeVisible();
  await expect(header.getByRole("button", { name: "Today", exact: true })).toHaveAttribute("aria-current", "page");
  const back = page.getByRole("button", { name: "Back to Today" });
  await expect(back).toContainText("Today");
  await expect(page.locator(".dm-dayclock")).toContainText(/ends \d{2}:\d{2}/);

  // Esc in the From picker is the picker's own; on the page it goes back.
  const from = page.locator(".dm-from-select");
  await expect(from).toBeVisible();
  await from.focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(".day-map-page")).toBeVisible();
  await page.locator(".dm-heading").click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".day-map-page")).toHaveCount(0);
  await expect(page.locator(".wall-title")).toBeVisible();

  // And back in by the key, out by the link.
  await openDayMapByKey(page);
  await back.click();
  await expect(page.locator(".day-map-page")).toHaveCount(0);
});

test("the Day map's Back names where it goes: Plan when Plan opened it", async ({ page }) => {
  await enterDemo(page, { width: 1280, height: 800 });
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("button", { name: "DAY MAP" }).click();
  await expect(page.locator(".day-map-page")).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to Plan" })).toContainText("Plan");
});
