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
