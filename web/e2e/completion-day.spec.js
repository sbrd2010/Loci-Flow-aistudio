import { test, expect } from "@playwright/test";

// A task finished after midnight, in a day that runs to 02:00, counts toward the
// Loci day it belongs to: the same day its "done" stamp carries, so the Review's
// bar for that day goes up (not tomorrow's). Demo mode; its day runs to 02:00.

test("a task finished at 01:00 ticks the Loci day it belongs to, in Review", async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-16T01:00:00")); // the 15th's day, until 02:00
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  const nav = page.getByRole("navigation", { name: "Main navigation" });

  const lastBarTicks = async () => {
    await nav.getByRole("button", { name: "Coach", exact: true }).click();
    await page.getByRole("tab", { name: "Review" }).click();
    const bar = page.getByRole("region", { name: "The facts" }).locator(".rv-bar-col").last();
    await expect(bar).toHaveAttribute("aria-label", /^15 JUN: /);
    const label = await bar.getAttribute("aria-label");
    return Number(/(\d+) ticked$/.exec(label)[1]);
  };

  const before = await lastBarTicks();

  await nav.getByRole("button", { name: "Today", exact: true }).click();
  const markDone = page.getByRole("button", { name: /^Mark done: / }).first();
  const title = (await markDone.getAttribute("aria-label")).replace(/^Mark done: /, "");
  await markDone.click();

  expect(await lastBarTicks()).toBe(before + 1);

  // Reopening takes the tick back from the day the task was finished on.
  await nav.getByRole("button", { name: "Today", exact: true }).click();
  const fold = page.locator(".today-done-fold .today-parked-line");
  if (await fold.count()) await fold.click();
  await page.getByRole("button", { name: `Mark not done: ${title}` }).click();

  expect(await lastBarTicks()).toBe(before);
});
