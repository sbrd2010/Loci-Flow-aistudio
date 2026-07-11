import { test, expect } from "@playwright/test";

// Mobile reliability smoke tests run in demo mode so they never mutate Firebase.
// They protect the small-screen Day Map path before v0.1 is shared with 5-10 testers.

const MOBILE_VIEWPORTS = [
  { name: "iPhone 11 Pro", width: 375, height: 812 },
  { name: "Pixel 6a", width: 412, height: 915 },
  { name: "Tablet portrait", width: 768, height: 1024 },
];

async function enterDemo(page, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

async function openDayMap(page) {
  const dayMapButton = page.locator("button.stuck-btn", { hasText: "Day Map" });
  await expect(dayMapButton).toBeVisible({ timeout: 8_000 });
  await dayMapButton.click();
  await expect(page.getByRole("heading", { name: "Day Map" })).toBeVisible({ timeout: 8_000 });
}

async function autoFillDayMap(page) {
  const autoFill = page.getByRole("button", { name: "Auto-fill" });
  await expect(autoFill).toBeEnabled({ timeout: 5_000 });
  await autoFill.click();
  await expect(page.getByText("3 / 3")).toBeVisible({ timeout: 5_000 });
}

async function expectVisibleRouteTimeLabels(page) {
  const routeTimes = page.locator(".dm-stop-time");
  await expect(routeTimes.first()).toBeVisible({ timeout: 5_000 });
  await expect(routeTimes.filter({ hasText: "6:00 AM" })).toHaveCount(0);
}

async function expectNoHorizontalOverflow(page) {
  const widths = await page.evaluate(() => {
    const measured = [
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
    ];
    document.querySelectorAll(".app-container, .screen-content, .day-map-page, .dm-timeline").forEach((el) => {
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

    await autoFillDayMap(page);
    await expectVisibleRouteTimeLabels(page);
    await expect(page.getByText("End of route")).toBeVisible({ timeout: 5_000 });
    await expectNoHorizontalOverflow(page);
  });
}

test("reliability: Day Map route persists after closing and reopening", async ({ page }) => {
  await enterDemo(page, { width: 412, height: 915 });

  await openDayMap(page);
  await autoFillDayMap(page);
  await expectVisibleRouteTimeLabels(page);

  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.locator("button.stuck-btn", { hasText: "Day Map" })).toBeVisible({ timeout: 5_000 });

  await openDayMap(page);
  await expect(page.getByText("3 / 3")).toBeVisible({ timeout: 5_000 });
  await expectVisibleRouteTimeLabels(page);
  await expect(page.getByText("End of route")).toBeVisible({ timeout: 5_000 });
  await expectNoHorizontalOverflow(page);
});

test("Day Map cards show sub-step progress and reveal the full sub-step list when expanded", async ({ page }) => {
  await enterDemo(page, { width: 375, height: 812 });

  await openDayMap(page);
  await autoFillDayMap(page);

  // demo-t1 ("Reply to the important message...") is P1 with 4 sub-steps (2 done)
  // and sorts first into the auto-filled route.
  const firstCard = page.locator(".dm-card-main").first();
  await expect(firstCard.getByText("2/4 steps done")).toBeVisible({ timeout: 5_000 });

  await page.locator(".dm-btn-menu").first().click();
  const substepsList = page.locator(".dm-substeps-list").first();
  await expect(substepsList).toBeVisible({ timeout: 3_000 });
  await expect(substepsList.getByText("Open email / LinkedIn / WhatsApp")).toBeVisible();
  await expect(substepsList.getByText("Write a short, honest reply (3 sentences is enough)")).toBeVisible();

  // Not-done steps render first, done steps last (matches TaskRow.jsx's ordering),
  // and each row's done/not-done state is reflected in both class and checkmark glyph.
  await expect(substepsList.locator(".dm-substep")).toHaveCount(4);
  await expect(substepsList.locator(".dm-substep.is-done")).toHaveCount(2);
  const rows = substepsList.locator(".dm-substep");
  await expect(rows.nth(0)).not.toHaveClass(/is-done/);
  await expect(rows.nth(0).getByText("Write a short, honest reply (3 sentences is enough)")).toBeVisible();
  await expect(rows.nth(0).locator(".dm-substep-check")).toHaveText("");
  await expect(rows.nth(0)).toHaveAttribute(
    "aria-label",
    "Not completed: Write a short, honest reply (3 sentences is enough)"
  );
  await expect(rows.nth(3)).toHaveClass(/is-done/);
  await expect(rows.nth(3).locator(".dm-substep-check")).toHaveText("✓");
  await expect(rows.nth(3)).toHaveAttribute("aria-label", "Completed: Read the message properly");

  await expectNoHorizontalOverflow(page);
});

test("reliability: removing a Day Map task reflows the remaining route", async ({ page }) => {
  await enterDemo(page, { width: 375, height: 812 });

  await openDayMap(page);
  await autoFillDayMap(page);

  // Open ⋯ menu on first card to reveal the remove button
  await page.locator(".dm-btn-menu").first().click();
  const removeButton = page.getByRole("button", { name: "Remove from route" });
  await expect(removeButton).toBeVisible({ timeout: 3_000 });
  await removeButton.click();

  await expect(page.getByText("2 / 3")).toBeVisible({ timeout: 5_000 });
  await expectVisibleRouteTimeLabels(page);
  await expectNoHorizontalOverflow(page);
});
