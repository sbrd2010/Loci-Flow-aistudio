import { test, expect } from "@playwright/test";
import { openDayMapPage } from "./helpers/today";

// Day Map reliability smoke tests run in demo mode so they do not mutate Firebase data.
// They protect the execution route: anchor time, auto-fill, navigation persistence, and reflow.

async function enterDemo(page, viewport = { width: 375, height: 812 }) {
  // Today's list now lives behind the peek, closed by default (screen 1, "the
  // wall"). These specs were written when it was always on screen, and their
  // subject is the list, not the wall — so the precondition is established here
  // rather than by editing each assertion. today-wall.spec.js covers the
  // closed-by-default behaviour itself, without this seed.
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("today-tasks-list")).toBeVisible({ timeout: 8_000 });
}

async function openDayMap(page) {
  await openDayMapPage(page);
  await expect(page.getByRole("heading", { name: "Day map" })).toBeVisible({ timeout: 8_000 });
}

function taskStops(page) {
  return page.locator(".dm-stop");
}

async function expectStopTime(stop, hm) {
  await expect(stop.locator(".dm-time")).toHaveText(hm, { timeout: 5_000 });
}

async function expectNoHorizontalOverflow(page) {
  const widths = await page.evaluate(() => {
    const measured = [
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
    ];
    document.querySelectorAll(
      ".app-container, .screen-content, .day-map-page, .dm-controls, .dm-status, .dm-unscheduled, .dm-route, .dm-stop, .dm-body"
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

  // Try-out 19: From is a small panel — Now, quarter-hours, or a typed time.
  const anchor = page.locator(".dm-from-select");
  await anchor.click();
  const typed = page.getByRole("dialog", { name: "Start the route at" }).getByLabel("Route start, typed");
  await typed.fill("11");
  await typed.press("Enter");
  await expect(anchor).toHaveText(/^11:00/);

  await expect(taskStops(page).first()).toBeVisible({ timeout: 5_000 });
  await expect.poll(() => taskStops(page).count()).toBeGreaterThanOrEqual(2);
  await expectStopTime(taskStops(page).first(), "11:00");
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: /Back/i }).click();
  await expect(page.getByTestId("today-tasks-list")).toBeVisible({ timeout: 8_000 });

  await openDayMap(page);
  await expect(taskStops(page).first()).toBeVisible({ timeout: 5_000 });
  await expect.poll(() => taskStops(page).count()).toBeGreaterThanOrEqual(2);
  await expectStopTime(taskStops(page).first(), "11:00");

  const firstStop = taskStops(page).first();
  // The sheet's estimate is the stop's duration (52).
  await firstStop.locator(".dm-main").click();
  const sheet = page.getByTestId("task-detail");
  await sheet.getByRole("button", { name: /^Estimate/ }).click();
  await sheet.getByRole("radio", { name: "2h" }).click();
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await expect(firstStop.locator(".dm-dur")).toHaveText("2h", { timeout: 5_000 });
  await expectStopTime(taskStops(page).nth(1), "13:05");
  await expectNoHorizontalOverflow(page);
});
