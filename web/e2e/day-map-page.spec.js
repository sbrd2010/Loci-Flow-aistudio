import { test, expect } from "@playwright/test";

// 50e–f: the Day map is Today's own page — Back (Esc), the title, and a day
// clock; Today stays current in the nav, which stays on screen.

async function enterDemo(page, viewport) {
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T11:35:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

async function openDayMapByKey(page) {
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("m");
  await expect(page.locator(".day-map-page")).toBeVisible();
}

test("phone: the Day map keeps the bottom nav with Today current, and its own header takes the app header's place (50e)", async ({ page }) => {
  await enterDemo(page, { width: 412, height: 892 });
  await openDayMapByKey(page);
  const nav = page.locator(".tab-bar");
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("button", { name: "Today" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".shell-header")).toBeHidden();

  // 56c: the factual line, then the day bar with NOW on it.
  await expect(page.locator(".dm-fact")).toHaveText("Nothing on the route.");
  await expect(page.getByRole("img", { name: /^The day so far: it runs 07:00 to 02:00; now 11:35$/ })).toBeVisible();
  await expect(page.locator(".dm-daybar-labels")).toContainText("11:35 NOW");

  // Today in the nav takes you back.
  await nav.getByRole("button", { name: "Today" }).click();
  await expect(page.locator(".day-map-page")).toHaveCount(0);
});

test("laptop: the app header stays with Today current; ‹ Today and Esc go back (50f)", async ({ page }) => {
  await enterDemo(page, { width: 1280, height: 800 });
  await openDayMapByKey(page);
  const header = page.locator(".shell-header");
  await expect(header).toBeVisible();
  await expect(header.getByRole("button", { name: "Today", exact: true })).toHaveAttribute("aria-current", "page");
  const back = page.getByRole("button", { name: "Back to Today" });
  await expect(back).toContainText("Today");
  await expect(page.locator(".dm-fact")).toHaveText("Nothing on the route.");

  // Esc in the From picker is the picker's own; on the page it goes back.
  const from = page.locator(".dm-from-select");
  await expect(from).toBeVisible();
  await from.focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(".day-map-page")).toBeVisible();
  await page.locator(".dm-heading").click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".day-map-page")).toHaveCount(0);
  await expect(page.locator(".wall-title")).toBeVisible();

  // And back in by the key, out by the link.
  await openDayMapByKey(page);
  await back.click();
  await expect(page.locator(".day-map-page")).toHaveCount(0);
});

// Codex review of #409: NOW marks where the fill ends — early in the day too,
// not held at a fifth of the way along — and stays inside the bar.
test("the NOW label sits where the day's fill ends, even near the start", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T07:30:00"));
  await page.getByTestId("demo-btn").click();
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("m");
  const geo = await page.evaluate(() => {
    const bar = document.querySelector(".dm-daybar-track").getBoundingClientRect();
    const fill = document.querySelector(".dm-daybar-done").getBoundingClientRect();
    const now = document.querySelector(".dm-daybar-now").getBoundingClientRect();
    const frac = fill.width / bar.width;
    return { frac, fillEnd: fill.right, anchor: now.left + frac * now.width, nowLeft: now.left, nowRight: now.right, barLeft: bar.left, barRight: bar.right };
  });
  expect(geo.frac).toBeGreaterThan(0);
  expect(geo.frac).toBeLessThan(0.15);
  // The point of the label that marks now is over the fill's end.
  expect(Math.abs(geo.anchor - geo.fillEnd)).toBeLessThan(2);
  expect(geo.nowLeft).toBeGreaterThanOrEqual(geo.barLeft - 1);
  expect(geo.nowRight).toBeLessThanOrEqual(geo.barRight + 1);
  await expect(page.locator(".dm-daybar-labels span").first()).toHaveClass(/is-covered/);
});

// Codex review of #409: the header is back on a laptop, so the Loci wordmark
// is another way out of the Day map (it goes through goToday, which now saves
// pending edits first, as Back and the tabs do).
test("laptop: the Loci wordmark leaves the Day map for Today", async ({ page }) => {
  await enterDemo(page, { width: 1280, height: 800 });
  await openDayMapByKey(page);
  await page.getByRole("banner").getByRole("button", { name: "Loci" }).click();
  await expect(page.locator(".day-map-page")).toHaveCount(0);
  await expect(page.locator(".wall-title")).toBeVisible();
});

// 56a–c: what was done today sits folded above the route, oldest first. The
// demo has no session ledger, so a task ticked done is its row ("marked
// done", no duration), and the line leaves the done part out.
test("a task marked done shows in the folded Done so far today, and the line says where the day stands", async ({ page }) => {
  await enterDemo(page, { width: 1280, height: 800 });
  await openDayMapByKey(page);
  await page.getByRole("button", { name: "Auto-fill" }).click();
  await expect(page.locator(".dm-fact")).toHaveText(/^On track: done by \d{2}:\d{2}\.$/);
  // The one thing, at NOW, until its stop ends.
  await expect(page.locator(".dm-stop.is-now .dm-one-thing")).toHaveText(/^THE ONE THING · UNTIL \d{2}:\d{2}$/);

  const first = page.locator(".dm-stop .dm-main").first();
  const title = (await page.locator(".dm-stop .dm-title").first().innerText()).trim();
  await first.click();
  await page.getByTestId("task-detail").getByRole("button", { name: `Mark done: ${title}` }).click();

  const fold = page.getByRole("region", { name: "Done so far today" });
  const toggle = fold.getByRole("button", { name: /^Done so far today · 1/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(fold.locator(".dm-done-row")).toHaveCount(1);
  await expect(fold.locator(".dm-done-row")).toContainText(title);
  await expect(fold.locator(".dm-done-row")).toContainText("MARKED DONE");
});
