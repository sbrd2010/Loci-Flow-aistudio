import { test, expect } from "@playwright/test";

// Mobile whole-app smoke tests run in demo mode so they never mutate Firebase data.
// They protect the small-screen navigation path before v0.1 is shared with 5-10 testers.

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

async function expectNoHorizontalOverflow(page) {
  const widths = await page.evaluate(() => {
    const measured = [
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
    ];
    document.querySelectorAll(".app-container, .screen-content, .card, .bottom-nav").forEach((el) => {
      measured.push(el.scrollWidth);
    });
    return {
      innerWidth: window.innerWidth,
      maxScrollWidth: Math.max(...measured),
    };
  });

  expect(widths.maxScrollWidth).toBeLessThanOrEqual(widths.innerWidth + 8);
}

async function openTab(page, name) {
  await page.getByRole("button", { name }).click();
}

for (const viewport of MOBILE_VIEWPORTS) {
  test(`mobile reliability: core tabs load without overflow on ${viewport.name}`, async ({ page }) => {
    await enterDemo(page, viewport);

    await expect(page.getByTestId("today-tasks-list")).toBeVisible({ timeout: 8_000 });
    await expectNoHorizontalOverflow(page);

    await openTab(page, "Roadmap");
    await expect(page.getByRole("heading", { name: "Horizon Planning" })).toBeVisible({ timeout: 8_000 });
    await expectNoHorizontalOverflow(page);

    await openTab(page, "Mind Box");
    await expect(page.getByRole("heading", { name: "Mind Box" })).toBeVisible({ timeout: 8_000 });
    await expect(page.locator(".braindump-input").first()).toBeVisible({ timeout: 8_000 });
    await expectNoHorizontalOverflow(page);

    await openTab(page, "AI Coach");
    await expect(page.getByRole("heading", { name: /Chat with/i })).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole("heading", { name: "AI Focus Brief" })).toBeVisible({ timeout: 8_000 });
    await expectNoHorizontalOverflow(page);

    await openTab(page, "Settings");
    await expect(page.getByRole("heading", { name: "Your Profile" })).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole("heading", { name: "AI Keys" })).toBeVisible({ timeout: 8_000 });
    await expectNoHorizontalOverflow(page);
  });
}

const PHONE_VIEWPORTS = MOBILE_VIEWPORTS.filter((v) => v.name !== "Tablet portrait");

for (const viewport of PHONE_VIEWPORTS) {
  test(`mobile reliability: Today's Focus chip row, more-menu, and Pinned Focus don't overlap on ${viewport.name}`, async ({ page }) => {
    await enterDemo(page, viewport);
    await expect(page.getByTestId("today-tasks-list")).toBeVisible({ timeout: 8_000 });

    // Issue 1: the quick-action chip row must fit without needing to scroll.
    const chipRow = page.locator(".focus-now-chip-row");
    const chipOverflow = await chipRow.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(chipOverflow).toBe(false);

    // Issue 2: the "..." more-menu trigger must sit on the same line as the
    // chip row (not wrapped to its own line), and its dropdown must actually
    // open on tap.
    const chipShellBox = await page.locator(".focus-now-chip-shell").boundingBox();
    const triggerBox = await page.locator(".today-more-menu-trigger").boundingBox();
    expect(Math.abs(chipShellBox.y - triggerBox.y)).toBeLessThan(5);

    await page.locator(".today-more-menu-trigger > button").click();
    await expect(page.getByTestId("today-more-menu")).toBeVisible({ timeout: 5_000 });
    await page.locator(".today-more-menu-trigger > button").click();

    // Issue 3: the pinned task's "Focus →" button must not overlap its title.
    // Asserted unconditionally (not just when a pinned task happens to exist) —
    // demo data always pins one, so a future change that silently stopped
    // rendering it should fail this test, not skip the check.
    const pinnedSection = page.locator(".pinned-focus-section");
    await expect(pinnedSection).toHaveCount(1);
    const focusBtnBox = await page.locator(".pinned-focus-start-btn").boundingBox();
    const titleBox = await page.locator(".pinned-focus-inner .task-title-text").first().boundingBox();
    expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(focusBtnBox.x);

    await expectNoHorizontalOverflow(page);

    // The chip row's "no scroll" budget was tuned against the default chip
    // labels — confirm it still holds once "Low Energy" grows to "Low Energy
    // ON", the longest label variant this row can show.
    await page.locator(".focus-now-chip-row button", { hasText: "Low Energy" }).click();
    await expect(page.locator(".focus-now-chip-row button", { hasText: "Low Energy ON" })).toBeVisible({ timeout: 5_000 });
    const chipOverflowWithLowEnergyOn = await chipRow.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(chipOverflowWithLowEnergyOn).toBe(false);
    await expectNoHorizontalOverflow(page);
  });
}

test("mobile reliability: Settings Privacy Policy opens and closes on iPhone-sized screen", async ({ page }) => {
  await enterDemo(page, { name: "iPhone 11 Pro", width: 375, height: 812 });

  await openTab(page, "Settings");
  await expect(page.getByRole("heading", { name: "Your Profile" })).toBeVisible({ timeout: 8_000 });

  await page.getByRole("button", { name: "Privacy Policy" }).click();
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("What we store")).toBeVisible({ timeout: 5_000 });
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).not.toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "Your Profile" })).toBeVisible({ timeout: 5_000 });
});
