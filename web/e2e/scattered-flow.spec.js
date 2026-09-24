import { test, expect } from "@playwright/test";

// Feeling scattered (45c). Runs in demo mode so it never touches Firebase.
//
// The point of this screen is the SHORT session: "Start 5 minutes on the
// first". That only means anything if it actually starts a five-minute
// session — the duration used to be handed to the timer before the session
// existed, and startFocusSession then reset it from the task's own estimate.

async function enterDemo(page) {
  // Today's list now lives behind the peek, closed by default (screen 1, "the
  // wall"). These specs were written when it was always on screen, and their
  // subject is the list, not the wall — so the precondition is established here
  // rather than by editing each assertion. today-wall.spec.js covers the
  // closed-by-default behaviour itself, without this seed.
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

async function openScattered(page) {
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
  const entry = page.getByRole("button", { name: /I'm scattered/i });
  await entry.scrollIntoViewIfNeeded();
  await entry.click();
  await expect(page.locator(".scattered-actions")).toBeVisible({ timeout: 10_000 });
}

test("mobile reliability: 'Start 5 minutes on the first' starts a five-minute session, not the task's estimate", async ({ page }) => {
  await enterDemo(page);
  await openScattered(page);

  await page.getByRole("button", { name: "Start 5 minutes on the first" }).click();

  const digits = page.locator(".focus-mode-time-digits");
  await expect(digits).toBeVisible({ timeout: 10_000 });
  // 5:00, or 4:59 if the clock has already ticked once.
  await expect(digits).toHaveText(/^0?[45]:\d{2}$/);
  const [mins] = (await digits.innerText()).split(":").map(Number);
  expect(mins).toBeLessThan(6);
});

test("at most three picks; the first is ringed and shows its smallest start; tapping another makes it the first", async ({ page }) => {
  await enterDemo(page);
  await openScattered(page);

  await expect(page.getByRole("heading", { name: "Feeling scattered?" })).toBeVisible();
  // Plan's floating + would sit on top of this screen's own buttons.
  await expect(page.getByTestId("fab-add-task")).toHaveCount(0);
  const picks = page.locator(".scattered-pick");
  const n = await picks.count();
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThanOrEqual(3);
  await expect(picks.first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".scattered-pick[aria-pressed='true']")).toHaveCount(1);
  expect(n).toBeGreaterThan(1);

  const second = (await picks.nth(1).locator(".scattered-pick-title").innerText()).trim();
  await picks.nth(1).click();
  await expect(picks.first().locator(".scattered-pick-title")).toHaveText(second);
  await expect(picks.first()).toHaveAttribute("aria-pressed", "true");

  // And five minutes starts on that one.
  await page.getByRole("button", { name: "Start 5 minutes on the first" }).click();
  await expect(page.locator(".focus-mode-overlay").getByRole("heading", { level: 1 })).toHaveText(second);
});

test("Empty my head into Mind Box goes to Mind Box, and Back returns through the door it came in", async ({ page }) => {
  await enterDemo(page);
  await openScattered(page);
  // Opened from Plan, the back link says Plan and goes there.
  await expect(page.locator(".scattered-back")).toHaveText(/Plan/);
  await page.locator(".scattered-back").click();
  await expect(page.locator(".scattered")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /I'm scattered/i })).toBeVisible();

  // From Today, the back link says Today and goes there.
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Today", exact: true }).click();
  await page.locator(".today-list-hide").click().catch(() => {});
  await page.locator(".wall-link", { hasText: "Feeling scattered?" }).click();
  await expect(page.locator(".scattered-back")).toHaveText(/Today/);
  await page.getByRole("button", { name: "Empty my head into Mind Box" }).click();
  await expect(page.getByRole("heading", { name: "Mind Box" })).toBeVisible({ timeout: 8_000 });
});

// Addendum D: the five-minute session is "the same FocusSession, three
// deltas". This covers the two that are presentation — the kicker and the
// primary naming the length it will log. The third (holding at 00:00 with
// "Keep going · +20m" instead of a modal) touches the shared completion path
// and lands in its own commit.
test("mobile reliability: a five-minute session presents as one, not as a 25-minute session", async ({ page }) => {
  await enterDemo(page);
  await openScattered(page);

  await page.getByRole("button", { name: "Start 5 minutes on the first" }).click();

  const overlay = page.locator(".focus-mode-overlay");
  await expect(overlay).toBeVisible({ timeout: 10_000 });
  await expect(overlay.locator(".focus-mode-header-label")).toHaveText("FIVE MINUTES · THAT'S ALL");

  // At the start nothing has elapsed, and the completion path logs ELAPSED
  // seconds — so a button promising "log 5m" here names a figure the ledger
  // would never write. It names what would actually be logged, which at zero
  // is nothing. (This spec previously asserted the promise itself.)
  const done = overlay.locator(".focus-mode-done-btn");
  await expect(done).toContainText(/done/i);
  await expect(done).not.toContainText("5m");
});

test("mobile reliability: the full session is untouched by the five-minute deltas", async ({ page }) => {
  await enterDemo(page);
  // An ordinary session, from Today's wall.
  await page.locator(".today-wall .wall-primary").click();

  const overlay = page.locator(".focus-mode-overlay");
  await expect(overlay).toBeVisible({ timeout: 10_000 });
  await expect(overlay.locator(".focus-mode-header-label")).toHaveText("FOCUS");
  await expect(overlay.locator(".focus-mode-done-btn")).not.toContainText("log 5m");
});
