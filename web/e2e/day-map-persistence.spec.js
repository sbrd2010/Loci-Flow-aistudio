import { test, expect } from "@playwright/test";

// Day Map reliability smoke tests run in demo mode so they do not mutate Firebase data.
// They protect the execution route: anchor time, auto-fill, navigation persistence, and reflow.

async function enterDemo(page, viewport = { width: 375, height: 812 }) {
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("today-tasks-list")).toBeVisible({ timeout: 8_000 });
}

async function openDayMap(page) {
  await page.getByRole("button", { name: /Day Map/i }).click();
  await expect(page.getByRole("heading", { name: "Day Map" })).toBeVisible({ timeout: 8_000 });
}

function taskStops(page) {
  return page.locator(".dm-stop").filter({ has: page.locator(".dm-card") });
}

async function expectStopTime(stop, hm, ampm) {
  await expect(stop.locator(".dm-time-hm")).toHaveText(hm, { timeout: 5_000 });
  await expect(stop.locator(".dm-time-ampm")).toHaveText(ampm, { timeout: 5_000 });
}

async function expectNoHorizontalOverflow(page) {
  const widths = await page.evaluate(() => {
    const measured = [
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
    ];
    document.querySelectorAll(
      ".app-container, .screen-content, .day-map-page, .dm-summary-card, .day-map-anchor-bar, .day-map-available-strip, .dm-timeline, .dm-stop, .dm-card"
    ).forEach((el) => {
      measured.push(el.scrollWidth);
    });
    return {
      innerWidth: window.innerWidth,
      maxScrollWidth: Math.max(...measured),
    };
  });

  expect(widths.maxScrollWidth).toBeLessThanOrEqual(widths.innerWidth + 8);
}

test("mobile reliability: Day Map auto-fill persists route anchor and reflows duration changes", async ({ page }) => {
  await enterDemo(page);
  await openDayMap(page);

  const anchorSelect = page.getByLabel("Route start time");
  await anchorSelect.selectOption("660");
  await expect(anchorSelect).toHaveValue("660");

  await page.getByRole("button", { name: "Auto-fill" }).click();
  await expect(taskStops(page).first()).toBeVisible({ timeout: 5_000 });
  await expect.poll(() => taskStops(page).count()).toBeGreaterThanOrEqual(2);
  await expectStopTime(taskStops(page).first(), "11:00", "AM");
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: /Back/i }).click();
  await expect(page.getByTestId("today-tasks-list")).toBeVisible({ timeout: 8_000 });

  await openDayMap(page);
  await expect(taskStops(page).first()).toBeVisible({ timeout: 5_000 });
  await expect.poll(() => taskStops(page).count()).toBeGreaterThanOrEqual(2);
  await expectStopTime(taskStops(page).first(), "11:00", "AM");

  const firstStop = taskStops(page).first();
  await firstStop.getByLabel("Card options").click();
  await firstStop.locator("select").selectOption("90");
  await expect(firstStop.locator(".dm-card-dur")).toHaveText("1h 30m", { timeout: 5_000 });
  await expectStopTime(taskStops(page).nth(1), "12:35", "PM");
  await expectNoHorizontalOverflow(page);
});
