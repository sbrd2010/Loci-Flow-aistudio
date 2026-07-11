import { test, expect } from "@playwright/test";

// Insights (Mind Box) reliability smoke tests run in demo mode so they never
// mutate Firebase data. They protect the panel's range selector, range-
// specific section visibility, and mobile layout before v0.1 reaches testers.

async function enterDemo(page, viewport = { width: 375, height: 812 }) {
  await page.setViewportSize(viewport);
  // Fix the clock BEFORE navigating — demoData.js computes `today`/`d1..d6`
  // as module-load-time `new Date()` calls, evaluated once when the bundle
  // first runs. Setting the clock after goto() would leave those constants
  // anchored to the real wall-clock date instead of the mocked one, so the
  // app's mocked "today" (from useTodayStr) and the demo payload's actual
  // dates would only agree by coincidence on days matching the mock.
  await page.clock.setFixedTime(new Date("2026-07-11T10:00:00"));
  await page.goto("/");
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

async function openInsights(page) {
  await page.locator(".bottom-nav").getByRole("button", { name: "Mind Box" }).click();
  await expect(page.getByRole("heading", { name: "Mind Box" })).toBeVisible({ timeout: 8_000 });
  await page.getByText("Insights", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Insights" })).toBeVisible({ timeout: 5_000 });
}

function rangeButton(page, label) {
  return page.locator(".insights-range-row").getByRole("button", { name: label });
}

async function expectNoHorizontalOverflow(page) {
  const widths = await page.evaluate(() => {
    const measured = [
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
    ];
    document.querySelectorAll(
      ".app-container, .screen-content, .insights-range-row, .insights-stat-grid, .insights-bars, .insights-category-list"
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

test("mobile reliability: Insights opens from Mind Box's grid, defaults to 7 Days, and Back returns to the grid", async ({ page }) => {
  await enterDemo(page);
  await openInsights(page);

  await expect(rangeButton(page, "7 Days")).toHaveAttribute("aria-pressed", "true");
  await expect(rangeButton(page, "Today")).toHaveAttribute("aria-pressed", "false");
  await expect(rangeButton(page, "30 Days")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText("Daily Completions")).toBeVisible();

  await page.getByText("← Back").click();
  await expect(page.getByRole("heading", { name: "Mind Box" })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("Insights", { exact: true })).toBeVisible();
});

test("mobile reliability: switching Today/7 Days/30 Days changes the selected range and its range-specific sections", async ({ page }) => {
  await enterDemo(page);
  await openInsights(page);

  // 7 Days (default): daily bars present, no 30-day trend.
  await expect(page.getByText("Daily Completions")).toBeVisible();
  await expect(page.getByText("30-Day Trend")).not.toBeVisible();

  // Today: no daily-bars/weekday-pattern chart from a single day's data —
  // just stat tiles, category details if available, and Current Load.
  await rangeButton(page, "Today").click();
  await expect(rangeButton(page, "Today")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Daily Completions")).not.toBeVisible();
  await expect(page.getByText("30-Day Trend")).not.toBeVisible();
  await expect(page.getByText("Completion Pattern")).not.toBeVisible();
  await expect(page.getByText("Current Load")).toBeVisible();

  // 30 Days: the slim daily trend, not the 7-day chart.
  await rangeButton(page, "30 Days").click();
  await expect(rangeButton(page, "30 Days")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("30-Day Trend")).toBeVisible();
  await expect(page.getByText("Daily Completions")).not.toBeVisible();
});

test("mobile reliability: Current Load stays the same across every range selection", async ({ page }) => {
  await enterDemo(page);
  await openInsights(page);

  const currentLoad = page.locator(".insights-section--current");
  await expect(currentLoad).toBeVisible();
  const sevenDayText = await currentLoad.textContent();

  await rangeButton(page, "Today").click();
  await expect(currentLoad).toHaveText(sevenDayText);

  await rangeButton(page, "30 Days").click();
  await expect(currentLoad).toHaveText(sevenDayText);
});

test("mobile reliability: category coverage disclosure is neutral, no exact ratio claim", async ({ page }) => {
  await enterDemo(page);
  await openInsights(page);

  await expect(page.getByText("Category details are based on available task records and may not exactly match the completion total above.")).toBeVisible();
  await expect(page.getByText(/Category details are available for \d+ of \d+/)).not.toBeVisible();
});

test("regression: Today/7 Days/30 Days advance across a midnight rollover while the panel stays open", async ({ page }) => {
  // A fake-timers clock (not setFixedTime) so useTodayStr's 60s poll can
  // actually fire when we fast-forward, instead of a permanently frozen Date.
  await page.clock.install({ time: new Date("2026-07-10T23:58:00") });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  await openInsights(page);

  const subtitleBefore = await page.locator(".insights-section-subtitle").first().textContent();

  // Past midnight, well past useTodayStr's 60s poll interval.
  await page.clock.fastForward(5 * 60 * 1000);
  await page.waitForTimeout(200);

  const subtitleAfter = await page.locator(".insights-section-subtitle").first().textContent();
  expect(subtitleAfter).not.toBe(subtitleBefore);
});

const PHONE_VIEWPORTS = [
  { name: "iPhone 11 Pro", width: 375, height: 812 },
  { name: "Pixel 6a", width: 412, height: 915 },
];

for (const viewport of PHONE_VIEWPORTS) {
  test(`mobile reliability: Insights has no horizontal overflow on ${viewport.name} across every range`, async ({ page }) => {
    await enterDemo(page, viewport);
    await openInsights(page);
    await expectNoHorizontalOverflow(page);

    await rangeButton(page, "Today").click();
    await expectNoHorizontalOverflow(page);

    await rangeButton(page, "30 Days").click();
    await expectNoHorizontalOverflow(page);
  });
}
