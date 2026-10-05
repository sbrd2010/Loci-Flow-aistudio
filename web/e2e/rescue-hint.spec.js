import { test, expect } from "@playwright/test";

// Today's Rescue hint (Q55.2): one quiet line when the one thing isn't
// moving; "Open Rescue →" opens Rescue on the matching state; "Not today"
// puts it away; Settings › The day turns it off. Demo mode, nothing synced.

const AT = new Date("2024-06-15T10:00:00").getTime();

async function enterDemo(page, { viewport = { width: 390, height: 844 }, idleMinutes = 0 } = {}) {
  // The demo's one thing (demo-t1) has sat this long without a start.
  await page.addInitScript(([since]) => {
    try { window.localStorage.setItem("loci_one_thing_since", JSON.stringify({ uuid: "demo-t1", at: since })); } catch { /* private mode */ }
  }, [AT - idleMinutes * 60000]);
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.clock.setFixedTime(new Date(AT));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".wall-title")).toBeVisible({ timeout: 10_000 });
}

const hint = (page) => page.locator(".wall-hint");

test("45 minutes without a start: the hint names it, and Open Rescue lands on Anxious, can't start", async ({ page }) => {
  await enterDemo(page, { idleMinutes: 50 });
  await expect(hint(page).locator(".wall-hint-line")).toHaveText("This one hasn’t started in 50 minutes.");
  // It sits under the buttons; Done and More stay.
  await expect(page.locator(".wall-quiet")).toBeVisible();
  await hint(page).getByRole("button", { name: "Open Rescue →" }).click();
  const rescue = page.getByRole("dialog", { name: "Rescue" });
  await rescue.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(rescue.getByRole("button", { name: /^Make the first step tiny/ })).toBeVisible();
  await rescue.getByRole("button", { name: /^Leave/ }).click();
  // Tapped: nothing more today.
  await expect(hint(page)).toHaveCount(0);
});

test("not before 45 minutes", async ({ page }) => {
  await enterDemo(page, { idleMinutes: 40 });
  await expect(page.locator(".wall-title")).toBeVisible();
  await expect(hint(page)).toHaveCount(0);
});

test("Not today puts it away", async ({ page }) => {
  await enterDemo(page, { idleMinutes: 50 });
  await hint(page).getByRole("button", { name: "Not today" }).click();
  await expect(hint(page)).toHaveCount(0);
});

test("I'm stuck twice on the same task: the hint says so and opens Too much going on", async ({ page }) => {
  await enterDemo(page);
  await expect(hint(page)).toHaveCount(0);
  for (let i = 0; i < 2; i++) {
    await page.locator(".wall-quiet").getByRole("button", { name: "I’m stuck" }).click();
    await page.getByRole("dialog", { name: "Rescue" }).getByRole("button", { name: /^Leave/ }).click();
  }
  await expect(hint(page).locator(".wall-hint-line")).toHaveText("You’ve hit a wall on this one twice.");
  await hint(page).getByRole("button", { name: "Open Rescue →" }).click();
  const rescue = page.getByRole("dialog", { name: "Rescue" });
  await rescue.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(rescue.getByRole("button", { name: /^Clear my day/ })).toBeVisible();
});

test("laptop: the hint sits under the buttons; Settings › The day turns it off", async ({ page }) => {
  await enterDemo(page, { viewport: { width: 1280, height: 900 }, idleMinutes: 50 });
  await expect(hint(page)).toBeVisible();
  const [buttons, line] = await Promise.all([page.locator(".wall-buttons").boundingBox(), hint(page).boundingBox()]);
  expect(line.y).toBeGreaterThan(buttons.y + buttons.height);
  await page.getByRole("button", { name: "Settings" }).first().click();
  const day = page.getByRole("button", { name: "The day", exact: true });
  if (await day.isVisible()) await day.click();
  const sw = page.getByRole("switch", { name: "Rescue hint" });
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.locator(".wall-title")).toBeVisible();
  await expect(hint(page)).toHaveCount(0);
});
