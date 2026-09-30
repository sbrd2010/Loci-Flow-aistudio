import { test, expect } from "@playwright/test";
import { openRung } from "./helpers/plan.js";

// 57f: when a horizon's period ends, its open tasks wait for a review:
// each stays for the new period, goes to Today (top, tagged for the day), or
// is dropped — with a 10 s Undo. Opens on its own once; then Today's line.
test("the week ends: the review opens, each leftover gets a place, and Undo puts it back", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.clock.install({ time: new Date("2024-06-15T10:00:00") }); // Sat
  await page.goto("/");
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  const nav = page.getByRole("navigation", { name: "Main navigation" });

  // Nothing to review on the first day: the horizons are only noted.
  await expect(page.getByRole("dialog", { name: /ended$/ })).toHaveCount(0);
  await nav.getByRole("button", { name: "Plan", exact: true }).click();
  await openRung(page, "week");
  const titles = (await page.locator(".plan-open .plan-row-title").allInnerTexts()).map(t => t.trim());
  expect(titles.length).toBeGreaterThanOrEqual(3);

  // Monday: the week to Sun 16 Jun has ended.
  await page.clock.fastForward("48:00:00");
  const review = page.getByRole("dialog", { name: "The week to 16 Jun ended" });
  await expect(review).toBeVisible();
  await review.getByRole("radiogroup", { name: `Where ${titles[1]} goes` }).getByRole("radio", { name: "Today" }).click();
  await review.getByRole("radiogroup", { name: `Where ${titles[2]} goes` }).getByRole("radio", { name: "Drop" }).click();
  await review.getByRole("button", { name: "Done" }).click();
  await expect(review).toHaveCount(0);
  await expect(page.locator(".undo-toast")).toContainText("Reviewed: The week to 16 Jun ended");

  // Kept stays; the dropped one is gone; the Today one is on Today, tagged.
  await openRung(page, "week");
  const list = page.locator(".plan-open");
  await expect(list.getByText(titles[0], { exact: true })).toBeVisible();
  await expect(list.getByText(titles[2], { exact: true })).toHaveCount(0);
  await nav.getByRole("button", { name: "Today", exact: true }).click();
  const row = page.getByTestId("today-tasks-list").locator("[data-task-uuid]", { hasText: titles[1] });
  await expect(row.locator(".task-tag.is-from")).toHaveText("FROM WEEK TO 16 JUN");

  // Undo: both are back in the week, and the review waits on Today's line.
  await page.locator(".undo-toast").getByRole("button", { name: /Undo/ }).click();
  await expect(page.getByRole("button", { name: /^The week to 16 Jun ended · \d+ left · Review$/ })).toBeVisible();
});
