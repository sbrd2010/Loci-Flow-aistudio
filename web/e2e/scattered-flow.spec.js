import { test, expect } from "@playwright/test";

// Screen 14 — "When you're scattered". Runs in demo mode so it never touches
// Firebase data.
//
// The point of this screen is the SHORT session: "Just 5 minutes" is the filled
// primary and "Full 25 instead" the outlined alternative. That only means
// anything if the button actually starts a five-minute session, which is what
// these tests pin down — the duration used to be handed to the timer before the
// session existed, and startFocusSession then reset it from the task's own
// estimate.

async function enterDemo(page) {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

async function openScattered(page) {
  await page.locator(".bottom-nav").getByRole("button", { name: "Roadmap" }).click();
  const entry = page.getByRole("button", { name: /I'm scattered/i });
  await entry.scrollIntoViewIfNeeded();
  await entry.click();
  await expect(page.locator(".scattered-actions")).toBeVisible({ timeout: 10_000 });
}

test("mobile reliability: 'Just 5 minutes' starts a five-minute session, not the task's estimate", async ({ page }) => {
  await enterDemo(page);
  await openScattered(page);

  await page.getByRole("button", { name: "Just 5 minutes" }).click();

  const digits = page.locator(".focus-mode-time-digits");
  await expect(digits).toBeVisible({ timeout: 10_000 });
  // 5:00, or 4:59 if the clock has already ticked once.
  await expect(digits).toHaveText(/^0?[45]:\d{2}$/);
  const [mins] = (await digits.innerText()).split(":").map(Number);
  expect(mins).toBeLessThan(6);
});

test("mobile reliability: 'Full 25 instead' starts a twenty-five-minute session", async ({ page }) => {
  await enterDemo(page);
  await openScattered(page);

  await page.getByRole("button", { name: "Full 25 instead" }).click();

  const digits = page.locator(".focus-mode-time-digits");
  await expect(digits).toBeVisible({ timeout: 10_000 });
  await expect(digits).toHaveText(/^2[45]:\d{2}$/);
});

test("mobile reliability: the scattered screen does not claim to park anything", async ({ page }) => {
  await enterDemo(page);
  await openScattered(page);

  // "Parked" is a real state in this app (isParked / task_parked). This screen
  // writes nothing, so it must not borrow the word.
  await expect(page.locator(".scattered-foot")).not.toContainText(/parked until tomorrow/i);
});
