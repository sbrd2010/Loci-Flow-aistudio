import { test, expect } from "@playwright/test";

// Screen 1 — the wall and the desk.
//
// Deliberately does NOT seed loci_today_peek_open, unlike every other spec:
// this one is about the default, and the default is the wall. If it ever seeds
// the peek open, it stops testing the thing it exists for.

async function enterDemo(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

test("mobile reliability: Today opens on the wall, with the list put away", async ({ page }) => {
  await enterDemo(page);

  // The commitment is the dominant element and IS the start control.
  await expect(page.locator(".wall-hero")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".wall-title.is-wall")).toBeVisible();
  await expect(page.getByText("tap anywhere to begin")).toBeVisible();

  // No second filled primary competing with it.
  await expect(page.locator(".wall-primary")).toHaveCount(0);

  // The list is genuinely gone, not merely scrolled past. This asserts the
  // computed style because the section carries an INLINE display, and a class
  // rule cannot override one — an earlier attempt toggled a class, looked
  // correct, and hid nothing.
  const display = await page.locator(".tasks-section").evaluate(el => getComputedStyle(el).display);
  expect(display).toBe("none");
});

test("mobile reliability: the peek opens the desk and closes back to the wall", async ({ page }) => {
  await enterDemo(page);

  await page.locator(".wall-peek").click();

  // The hero stops being a button; an explicit primary appears instead.
  await expect(page.locator(".wall-hero")).toHaveCount(0);
  await expect(page.locator(".wall-title.is-desk")).toBeVisible();
  await expect(page.locator(".wall-primary")).toBeVisible();
  await expect(page.locator(".tasks-section")).toBeVisible();
  await expect(page.locator(".wall-peek-label")).toContainText(/AFTER THAT/);

  // Two-way: the toggle is a button in both states, so you can always get back.
  await page.locator(".wall-peek").click();
  await expect(page.locator(".wall-hero")).toBeVisible();
  const display = await page.locator(".tasks-section").evaluate(el => getComputedStyle(el).display);
  expect(display).toBe("none");
});

test("mobile reliability: the peek state survives a reload", async ({ page }) => {
  await enterDemo(page);
  await page.locator(".wall-peek").click();
  await expect(page.locator(".wall-title.is-desk")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });

  // peekOpen is persisted to localStorage, per the handoff.
  await expect(page.locator(".wall-title.is-desk")).toBeVisible({ timeout: 10_000 });
});

test("mobile reliability: tapping the wall starts a focus session on the commitment", async ({ page }) => {
  await enterDemo(page);

  const title = (await page.locator(".wall-title.is-wall").innerText()).trim();
  await page.locator(".wall-hero").click();

  const overlay = page.locator(".focus-mode-overlay");
  await expect(overlay).toBeVisible({ timeout: 10_000 });
  await expect(overlay.getByRole("heading", { name: title })).toBeVisible();
});

test("mobile reliability: a deadline a year out is not painted as time pressure", async ({ page }) => {
  await enterDemo(page);

  // Clay is the one alert colour and the design reserves it for real pressure.
  // The demo's deadline is ~365 days away, so the figure shows but stays quiet.
  const days = page.locator(".wall-head-days");
  await expect(days).toBeVisible();
  await expect(days).not.toHaveClass(/is-pressing/);
});

// ── Fixes for the Codex review on PR #380 ─────────────────────────────────
// Each of these asserts a control does what its label says. All three were
// controls that rendered correctly and did the wrong thing (or nothing) —
// the same class of defect as the peek that hid nothing.

async function enterDemoWithPeek(page) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await enterDemo(page);
}

test("mobile reliability: Low Energy's smaller start actually starts five minutes", async ({ page }) => {
  await enterDemoWithPeek(page);

  await page.locator("button.stuck-btn", { hasText: "Low Energy" }).click();

  const smaller = page.locator(".wall-action", { hasText: "Start small — 5 minutes" });
  await expect(smaller).toBeVisible({ timeout: 8_000 });
  await smaller.click();

  // A focus session, at five minutes — not the task editor, and not the
  // task's own 25-minute estimate.
  const overlay = page.locator(".focus-mode-overlay");
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  // The five-minute session presents as one (528db2f) — and the figure is 5:00,
  // not the task's own 25:00.
  await expect(overlay.getByText("FIVE MINUTES", { exact: false })).toBeVisible();
  await expect(overlay.getByText(/\b5:00\b/)).toBeVisible();
});

test("mobile reliability: the scattered door on the desk reaches screen 14", async ({ page }) => {
  await enterDemoWithPeek(page);

  const door = page.locator(".wall-scattered-link");
  await expect(door).toBeVisible({ timeout: 8_000 });
  await door.click();

  await expect(page.locator(".scattered")).toBeVisible({ timeout: 8_000 });
});

test("mobile reliability: choosing today's one thing actually commits it", async ({ page }) => {
  await enterDemo(page);

  // Clear the demo's pinned commitment so the wall asks the question.
  await expect(page.locator(".wall-hero")).toBeVisible({ timeout: 10_000 });
  await page.locator(".wall-action", { hasText: "Mark done" }).click();
  await expect(page.getByText("SO — WHAT'S THE ONE THING TODAY?")).toBeVisible({ timeout: 8_000 });

  await page.locator("button", { hasText: "Choose today's one thing" }).click();
  const row = page.locator(".focus-now-pick-row").first();
  const chosen = (await row.locator(".focus-now-pick-title").innerText()).trim();
  await row.click();

  // The wall stops asking, because the answer was written to isNowFocus on the
  // task rather than to view-local state. Demo mode holds its payload in
  // memory, so a reload here would only return to the landing screen — the
  // assertion that matters is that the wall, which reads the pin, now shows it.
  await expect(page.locator(".wall-title")).toContainText(chosen, { timeout: 8_000 });
  await expect(page.getByText("SO — WHAT'S THE ONE THING TODAY?")).toHaveCount(0);
});
