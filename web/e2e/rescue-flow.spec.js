import { test, expect } from "@playwright/test";

// Rescue (Q55.3, frames 64g–p) and Clear my day (Q52): full screen, nav
// hidden; state → breathing → three options → Where to now?. Clear my day
// moves Today's open tasks (fixed times and done stay), with Undo.

async function enterDemo(page, viewport = { width: 1280, height: 800 }) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}
const nav = (page) => page.getByRole("navigation", { name: "Main navigation" });
const rescue = (page) => page.getByRole("dialog", { name: "Rescue" });

async function openFromToday(page) {
  const hide = page.locator(".today-list-hide");
  if (await hide.isVisible()) await hide.click();
  await page.getByRole("button", { name: "Open Rescue" }).click();
  await expect(rescue(page)).toBeVisible();
}

test("the four steps, Clear my day to This week, and Undo", async ({ page }) => {
  await enterDemo(page);
  await openFromToday(page);
  await expect(rescue(page).getByText("STEP 1 OF 3")).toBeVisible();
  await rescue(page).getByRole("button", { name: /^Too much going on/ }).click();
  await expect(rescue(page).getByText("STEP 2 OF 3 · TOO MUCH GOING ON")).toBeVisible();
  await expect(rescue(page).getByRole("timer")).toContainText("ROUND 1 OF 4");
  await rescue(page).getByRole("button", { name: "Skip", exact: true }).click();

  await expect(rescue(page).getByRole("heading", { name: "Try one of these." })).toBeVisible();
  const clear = rescue(page).getByRole("button", { name: /^Clear my day/ });
  await clear.click();
  await expect(clear).toHaveAttribute("aria-expanded", "true");
  await expect(rescue(page).getByRole("radio", { name: "This week" })).toHaveAttribute("aria-checked", "true");
  await expect(rescue(page).getByRole("checkbox", { name: /as the one thing/ })).toBeChecked();
  const move = rescue(page).getByRole("button", { name: /^Move \d+ to This week$/ });
  const n = Number((await move.innerText()).match(/\d+/)[0]);
  expect(n).toBeGreaterThan(0);
  await move.click();

  await expect(rescue(page).getByText(`DONE · CLEARED ${n} TO THIS WEEK`)).toBeVisible();
  await expect(rescue(page).getByRole("heading", { name: "Where to now?" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: `${n} moved to This week` })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();

  // Leave: back on Today, the list as it was.
  await rescue(page).getByRole("button", { name: /^Leave/ }).click();
  await expect(rescue(page)).toHaveCount(0);
  await expect(page.locator(".wall-title")).toContainText("Reply to the important message");
});

test("Back to it starts a 10-minute focus block on the one thing", async ({ page }) => {
  await enterDemo(page);
  await openFromToday(page);
  await rescue(page).getByRole("button", { name: /^Got distracted/ }).click();
  await rescue(page).getByRole("button", { name: "Skip", exact: true }).click();
  await rescue(page).getByRole("button", { name: /^Close everything but the task/ }).click();
  await rescue(page).getByRole("checkbox", { name: "Close other tabs" }).check();
  await rescue(page).getByRole("button", { name: "Ready" }).click();
  await rescue(page).getByRole("button", { name: /^Back to it · Reply to the important message/ }).click();
  await expect(rescue(page)).toHaveCount(0);
  const overlay = page.locator(".focus-mode-overlay");
  await expect(overlay).toBeVisible({ timeout: 5_000 });
  await expect(overlay).toContainText("10:00");
});

test("a worry written down goes to Mind Box", async ({ page }) => {
  await enterDemo(page);
  await openFromToday(page);
  await rescue(page).getByRole("button", { name: /^Anxious, can/ }).click();
  await rescue(page).getByRole("button", { name: "Skip", exact: true }).click();
  await rescue(page).getByRole("button", { name: /^Write the worry down/ }).click();
  await rescue(page).getByLabel("Thought").fill("The review might go badly");
  await page.keyboard.press("Enter");
  await rescue(page).getByRole("button", { name: "Done" }).click();
  await expect(rescue(page).getByText("DONE · 1 SAVED TO MIND BOX")).toBeVisible();
  await rescue(page).getByRole("button", { name: /^Leave/ }).click();
  await nav(page).getByRole("button", { name: "Mind Box", exact: true }).click();
  await expect(page.getByTestId("thought-row").first()).toContainText("The review might go badly");
});

test("Mind Box opens Rescue; Leave comes back to Mind Box; the reset tiles are gone", async ({ page }) => {
  await enterDemo(page, { width: 412, height: 915 });
  await nav(page).getByRole("button", { name: "Mind Box", exact: true }).click();
  await expect(page.getByText("Bad Day Reset")).toHaveCount(0);
  await expect(page.getByText("Clean Slate")).toHaveCount(0);
  // A state picked on Mind Box enters Rescue at the breathing (65a).
  await page.getByRole("button", { name: /^Got distracted/ }).click();
  await expect(rescue(page).getByText("STEP 2 OF 3 · GOT DISTRACTED")).toBeVisible();
  // Full screen: the tab bar is under it.
  const box = await rescue(page).boundingBox();
  expect(Math.round(box.height)).toBe(915);
  await rescue(page).getByRole("button", { name: /^Leave/ }).click();
  await expect(page.getByRole("heading", { name: "Mind Box" })).toBeVisible();
});

test("a 10-minute break ends on 'Break's over. Ready?', asked once", async ({ page }) => {
  await enterDemo(page);
  await openFromToday(page);
  await rescue(page).getByRole("button", { name: /^Low energy, foggy/ }).click();
  await rescue(page).getByRole("button", { name: "Skip", exact: true }).click();
  await rescue(page).getByRole("button", { name: /^10-minute break/ }).click();
  await expect(rescue(page).getByText("BREAK · 10:00")).toBeVisible();
  await rescue(page).getByRole("button", { name: "End the break now" }).click();
  await expect(rescue(page).getByRole("heading", { name: "Break’s over. Ready?" })).toBeVisible();
  await rescue(page).getByRole("button", { name: "5 more minutes" }).click();
  await rescue(page).getByRole("button", { name: "End the break now" }).click();
  await expect(rescue(page).getByRole("button", { name: "5 more minutes" })).toHaveCount(0);
  await expect(rescue(page).getByRole("button", { name: "Start 10 minutes" })).toBeVisible();
});
