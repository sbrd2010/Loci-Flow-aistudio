import { test, expect } from "@playwright/test";

// Mind Box / Brain Dump reliability smoke tests run in demo mode so they do not mutate Firebase data.
// They protect the "capture it, don't lose it, don't resurrect it" flow before v0.1 reaches testers.

async function enterDemo(page, viewport = { width: 375, height: 812 }) {
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

async function openTab(page, name) {
  await page.locator(".bottom-nav").getByRole("button", { name }).click();
}

async function expectNoHorizontalOverflow(page) {
  const widths = await page.evaluate(() => {
    const measured = [
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
    ];
    document.querySelectorAll(
      ".app-container, .screen-content, .mindbox-grid, .mindbox-card, .braindump-form, .mindbox-subview-header"
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

test("mobile reliability: Brain Dump item is addable from Mind Box, browsable only from Roadmap Inbox (via a deep link), survives navigation, and can be deleted intentionally", async ({ page }) => {
  await enterDemo(page);
  await openTab(page, "Mind Box");
  await expect(page.getByRole("heading", { name: "Mind Box" })).toBeVisible({ timeout: 8_000 });

  const thought = "Call the pharmacy after lunch";
  const input = page.locator(".braindump-input").first();
  await input.fill(thought);
  await page.locator(".braindump-submit").first().click();
  await expect(input).toHaveValue("");

  // Mind Box no longer has its own browsable list — its "N notes" button
  // jumps straight to Roadmap's Horizon Planning Inbox instead.
  await expect(page.getByTestId("brain-dump-inbox-btn")).toContainText("Roadmap Inbox");
  await expectNoHorizontalOverflow(page);
  await page.getByTestId("brain-dump-inbox-btn").click();

  await expect(page.getByRole("heading", { name: "Horizon Planning" })).toBeVisible({ timeout: 8_000 });
  const dumpItem = page.locator('[data-testid="dump-item"]').filter({ hasText: thought });
  await expect(dumpItem).toBeVisible({ timeout: 5_000 });
  await expectNoHorizontalOverflow(page);

  // Survives navigation away and back.
  await openTab(page, "Today");
  await expect(page.getByTestId("today-tasks-list")).toBeVisible({ timeout: 8_000 });
  await openTab(page, "Roadmap");
  await page.getByRole("tab", { name: /Inbox/ }).click();
  await expect(dumpItem).toBeVisible({ timeout: 5_000 });

  await dumpItem.getByText("🗑").click();
  await expect(page.getByText("Delete this brain dump item?")).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "Keep it", exact: true }).click();
  await expect(dumpItem).toBeVisible({ timeout: 5_000 });

  await dumpItem.getByText("🗑").click();
  await expect(page.getByText("Delete this brain dump item?")).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(dumpItem).not.toBeVisible({ timeout: 5_000 });

  // Back in Mind Box, the count is back down to the demo seed's 4 items
  // (bd1-bd4 in demoData.js) now that the one we added has been deleted.
  await openTab(page, "Mind Box");
  await expect(page.getByTestId("brain-dump-inbox-btn")).toContainText("4 notes");
  await expectNoHorizontalOverflow(page);
});