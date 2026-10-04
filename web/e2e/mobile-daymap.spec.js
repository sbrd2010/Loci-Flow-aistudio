import { test, expect } from "@playwright/test";

// Mobile reliability smoke tests run in demo mode so they never mutate Firebase.
// They protect the small-screen Day Map path before v0.1 is shared with 5-10 testers.

const MOBILE_VIEWPORTS = [
  { name: "iPhone 11 Pro", width: 375, height: 812 },
  { name: "Pixel 6a", width: 412, height: 915 },
  { name: "Tablet portrait", width: 768, height: 1024 },
];

async function enterDemo(page, viewport) {
  // Today's list now lives behind the peek, closed by default (screen 1, "the
  // wall"). These specs were written when it was always on screen, and their
  // subject is the list, not the wall — so the precondition is established here
  // rather than by editing each assertion. today-wall.spec.js covers the
  // closed-by-default behaviour itself, without this seed.
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

async function openDayMap(page) {
  const dayMapButton = page.getByRole("button", { name: "Day map →" });
  await expect(dayMapButton).toBeVisible({ timeout: 8_000 });
  await dayMapButton.click();
  await expect(page.getByRole("heading", { name: "Day map" })).toBeVisible({ timeout: 8_000 });
}

// Every open Today task is on the route (Q59): it is laid out on opening.
async function routeReady(page) {
  await expect(page.locator(".dm-stop").first()).toBeVisible({ timeout: 5_000 });
}

async function expectVisibleRouteTimeLabels(page) {
  const routeTimes = page.locator(".dm-stop .dm-time");
  await expect(routeTimes.first()).toBeVisible({ timeout: 5_000 });
  await expect(routeTimes.filter({ hasText: "06:00" })).toHaveCount(0);
}

async function expectNoHorizontalOverflow(page) {
  const widths = await page.evaluate(() => {
    const measured = [
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
    ];
    document.querySelectorAll(".app-container, .screen-content, .day-map-page, .dm-route").forEach((el) => {
      measured.push(el.scrollWidth);
    });
    return {
      innerWidth: window.innerWidth,
      maxScrollWidth: Math.max(...measured),
    };
  });

  expect(widths.maxScrollWidth).toBeLessThanOrEqual(widths.innerWidth + 8);
}

for (const viewport of MOBILE_VIEWPORTS) {
  test(`mobile reliability: Today and Day Map do not overflow on ${viewport.name}`, async ({ page }) => {
    await enterDemo(page, viewport);

    await expect(page.getByTestId("today-tasks-list")).toBeVisible({ timeout: 8_000 });
    await expectNoHorizontalOverflow(page);

    await openDayMap(page);
    await expectNoHorizontalOverflow(page);

    await routeReady(page);
    await expectVisibleRouteTimeLabels(page);
    await expect(page.locator(".dm-dayend")).toContainText("DAY ENDS", { timeout: 5_000 });
    await expectNoHorizontalOverflow(page);
  });
}

test("reliability: Day Map route persists after closing and reopening", async ({ page }) => {
  await enterDemo(page, { width: 412, height: 915 });

  await openDayMap(page);
  await routeReady(page);
  await expectVisibleRouteTimeLabels(page);

  await page.getByRole("button", { name: "Back to Today" }).click();
  await expect(page.getByRole("button", { name: "Day map →" })).toBeVisible({ timeout: 5_000 });

  await openDayMap(page);
  await routeReady(page);
  await expectVisibleRouteTimeLabels(page);
  await expect(page.locator(".dm-dayend")).toContainText("DAY ENDS", { timeout: 5_000 });
  await expectNoHorizontalOverflow(page);
});

test("a Day Map stop opens its task sheet, with its steps", async ({ page }) => {
  await enterDemo(page, { width: 375, height: 812 });

  await openDayMap(page);
  await routeReady(page);

  // demo-t1 ("Reply to the important message...") has a first step and 4
  // sub-steps (2 done), and is the one thing, at the head of the route. 50f's rows
  // are time · task · how long; the stop opens the task sheet (52), steps and
  // all — the first step as step 1.
  const firstCard = page.locator(".dm-main").first();
  await expect(firstCard).toContainText("Reply to the important message");
  await firstCard.click();
  const sheet = page.getByTestId("task-detail");
  await expect(sheet).toBeVisible({ timeout: 3_000 });
  await expect(sheet.locator(".detail-kicker").first()).toHaveText(/^DAY MAP · 1 OF \d+$/);
  await expect(sheet.getByText("STEPS · 2 OF 5")).toBeVisible();
  await expect(sheet.locator(".detail-step")).toHaveCount(5);
  await expect(sheet.locator(".detail-step-check").first()).toHaveAccessibleName("Open the thread, write 3 honest sentences, hit send");
  await expect(sheet.locator(".detail-step.is-done")).toHaveCount(2);
  await expect(sheet.getByRole("checkbox", { name: "Open email / LinkedIn / WhatsApp" })).toBeVisible();
  await expect(sheet.getByRole("checkbox", { name: "Write a short, honest reply (3 sentences is enough)" })).toBeVisible();

  await expectNoHorizontalOverflow(page);
});
