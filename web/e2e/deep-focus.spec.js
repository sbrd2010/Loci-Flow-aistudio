import { test, expect } from "@playwright/test";

// Deep Focus reliability smoke tests run in demo mode so they do not mutate Firebase data.
// They protect the execution flow Rohan cares about most: pin task, focus, capture stray thought, return.

async function enterDemo(page, viewport = { width: 375, height: 812 }) {
  await page.setViewportSize(viewport);
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
    document.querySelectorAll(
      ".app-container, .screen-content, .focus-card, .focus-mode-overlay, .focus-mode-body, .focus-mode-task-panel, .focus-mode-controls, .focus-mode-dump-row"
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

test("mobile reliability: Deep Focus overlay supports pause, resume, and brain-dump capture", async ({ page }) => {
  await enterDemo(page);

  // Demo task demo-t1 is pinned — pinned section is immediately visible
  const pinnedSection = page.locator(".pinned-focus-section");
  await pinnedSection.scrollIntoViewIfNeeded();
  await expect(pinnedSection).toBeVisible({ timeout: 8_000 });
  await expect(pinnedSection).toContainText("PINNED FOCUS");

  // Open full-screen timer via Focus → button (starts timer immediately)
  await pinnedSection.locator(".pinned-focus-start-btn").click();

  const overlay = page.locator(".focus-mode-overlay");
  await expect(overlay).toBeVisible({ timeout: 5_000 });
  await expect(overlay.getByText("Deep Focus")).toBeVisible();
  await expect(overlay.getByRole("heading", { name: "Reply to the important message sitting in your inbox" })).toBeVisible();
  await expect(overlay.getByLabel("Pause timer")).toBeVisible({ timeout: 5_000 });
  await expectNoHorizontalOverflow(page);

  await overlay.getByLabel("Pause timer").click();
  await expect(overlay.getByText("Paused")).toBeVisible({ timeout: 5_000 });
  await expect(overlay.getByLabel("Start timer")).toBeVisible({ timeout: 5_000 });

  await overlay.getByLabel("Start timer").click();
  await expect(overlay.getByText("In progress")).toBeVisible({ timeout: 5_000 });

  const thought = "Remember to check parking after focus";
  const dumpInput = overlay.getByLabel("Capture a thought to Brain Dump");
  await dumpInput.fill(thought);
  await overlay.getByLabel("Save thought to Brain Dump").click();
  await expect(dumpInput).toHaveValue("");

  await overlay.getByLabel("Exit focus mode").click();
  await expect(overlay).not.toBeVisible({ timeout: 5_000 });

  await page.locator(".bottom-nav").getByRole("button", { name: "Mind Box" }).click();
  await expect(page.getByRole("heading", { name: "Mind Box" })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText(thought)).toBeVisible({ timeout: 5_000 });
  await expectNoHorizontalOverflow(page);
});