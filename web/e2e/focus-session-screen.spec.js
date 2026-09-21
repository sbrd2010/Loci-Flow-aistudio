import { test, expect } from "@playwright/test";

// Screen 3, the Focus session: "one task, one number, two exits."
//
// Unlike the ledger work in #382/#383, this screen IS observable in a browser
// — demo mode can open a real session — so these assert the rebuilt layout
// rather than settling for unit tests. Each one fails if the element it names
// is removed.

async function openSession(page) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await page.setViewportSize({ width: 375, height: 812 });
  // install(), not setFixedTime(): these specs need the countdown to actually
  // advance, and a fixed clock pins Date.now() so the interval never moves.
  // The timer is anchored to wall-clock time via a deadline, so both the
  // timers and the clock have to be under the test's control.
  await page.clock.install({ time: new Date("2024-06-15T10:00:00") });
  await page.goto("/");
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });

  const pinnedSection = page.locator(".pinned-focus-section");
  await pinnedSection.scrollIntoViewIfNeeded();
  await pinnedSection.locator(".pinned-focus-start-btn").click();

  const overlay = page.locator(".focus-mode-overlay");
  await expect(overlay).toBeVisible({ timeout: 5_000 });
  return overlay;
}

test("mobile reliability: the session screen shows one task and one number", async ({ page }) => {
  const overlay = await openSession(page);

  // The task, not a ring, is the thing you read first.
  await expect(overlay.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(overlay.locator(".focus-mode-time-digits")).toBeVisible();
  await expect(overlay.locator(".focus-mode-time-digits")).toHaveText(/^\d+:\d{2}$/);
});

test("mobile reliability: the task sits above the number, not below it", async ({ page }) => {
  const overlay = await openSession(page);
  const title = await overlay.getByRole("heading", { level: 1 }).boundingBox();
  const digits = await overlay.locator(".focus-mode-time-digits").boundingBox();
  // The handoff's order — kicker, task, subtask, then the figure. The screen
  // read the other way round before this rebuild.
  expect(title.y).toBeLessThan(digits.y);
});

test("mobile reliability: progress is a track, and it reports what is done", async ({ page }) => {
  const overlay = await openSession(page);
  const track = overlay.getByRole("progressbar", { name: "Session progress" });
  await expect(track).toBeVisible();

  const box = await overlay.locator(".focus-mode-track").boundingBox();
  // 2px per the handoff — a hairline under the figure, not a ring around it.
  expect(box.height).toBeLessThanOrEqual(3);

  // The fill grows with elapsed time rather than shrinking with what is left.
  const before = (await overlay.locator(".focus-mode-track-fill").boundingBox()).width;
  await page.clock.runFor(120_000);
  const after = (await overlay.locator(".focus-mode-track-fill").boundingBox()).width;
  expect(after).toBeGreaterThan(before);
});

test("mobile reliability: the session names when it started and what it has logged", async ({ page }) => {
  const overlay = await openSession(page);
  await expect(overlay.locator(".focus-mode-figures")).toContainText(/STARTED \d{2}:\d{2}/);

  await page.clock.runFor(120_000);
  await expect(overlay.locator(".focus-mode-figures")).toContainText(/\+\d+m LOGGED SO FAR/);
});

test("mobile reliability: no ordinal is claimed when the ledger cannot be read", async ({ page }) => {
  const overlay = await openSession(page);
  // Demo mode has no uid, so useFocusLedger reports "unavailable" — the same
  // state as a refused or still-loading read. Showing "SESSION 1" there would
  // assert an ordinal to someone who may have done four already. The honest
  // answer to "I don't know" is to say nothing.
  await expect(overlay.locator(".focus-mode-session-count")).toHaveCount(0);
});

test("mobile reliability: reaching 00:00 holds, with two choices and no modal", async ({ page }) => {
  const overlay = await openSession(page);

  // Run the block out. D3: no auto-close — the screen used to shut itself
  // three seconds later, taking both of the hold's choices with it.
  await page.clock.runFor(26 * 60_000);

  await expect(overlay).toBeVisible();
  await expect(overlay.locator(".focus-mode-time-digits")).toHaveText("0:00");
  await expect(overlay.getByRole("button", { name: /Keep going · \+\d+m/ })).toBeVisible();
  await expect(overlay.getByRole("button", { name: /Stop here/ })).toBeVisible();

  // The global completion dialog must not cover them.
  await expect(page.locator(".confirm-dialog, .modal-backdrop")).toHaveCount(0);
});

// The two specs below CLICK the buttons rather than asserting they exist.
// Both of these actions shipped broken behind a spec that only checked
// visibility: "Keep going" was wired to addTimeToSession, which returns
// immediately while a completion is pending, and "Stop here" was wired to the
// ordinary overlay exit, which left the session open and handed the user
// straight to the global modal. Presence is not behaviour.

test("mobile reliability: Keep going actually restarts the timer", async ({ page }) => {
  const overlay = await openSession(page);
  await page.clock.runFor(26 * 60_000);
  await expect(overlay.locator(".focus-mode-time-digits")).toHaveText("0:00");

  await overlay.getByRole("button", { name: /Keep going · \+\d+m/ }).click();

  // A running countdown on a fresh block, not a frozen 0:00.
  await expect(overlay.locator(".focus-mode-time-digits")).not.toHaveText("0:00");
  await expect(overlay.getByLabel("Pause timer")).toBeVisible();
  // And the hold is gone, because the session is no longer complete.
  await expect(overlay.getByRole("button", { name: /Stop here/ })).toHaveCount(0);
});

test("mobile reliability: Stop here ends the session without handing over to a modal", async ({ page }) => {
  const overlay = await openSession(page);
  await page.clock.runFor(26 * 60_000);

  await overlay.getByRole("button", { name: /Stop here/ }).click();

  await expect(overlay).toHaveCount(0);
  // The whole point of the inline hold: leaving it must not summon the
  // dialog it replaced.
  await expect(page.locator(".confirm-dialog, .modal-backdrop")).toHaveCount(0);
  await expect(page.getByText(/Focus block complete/i)).toHaveCount(0);
});
