import { test, expect } from "@playwright/test";

// Coach → Review (Q51, 62a–g): the facts, with a Today · 7 days · 30 days
// switch. Mind Box no longer has Insights. Demo mode: there is no focus
// ledger to read, so the focus figures say so instead of claiming zero.

async function openReview(page, viewport = { width: 1600, height: 900 }) {
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T10:00:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Coach", exact: true }).click();
  await page.getByRole("tab", { name: "Review" }).click();
}

test("Review shows the facts for 7 days, and the switch changes the period", async ({ page }) => {
  await openReview(page);
  const facts = page.getByRole("region", { name: "The facts" });
  await expect(page.getByRole("radio", { name: "7 days" })).toHaveAttribute("aria-checked", "true");
  await expect(facts.locator(".rv-hero-fig")).toHaveText("—");
  await expect(facts.locator(".rv-hero-main")).toContainText("Focus time not read");
  await expect(facts.locator(".rv-bar-col")).toHaveCount(7);
  await expect(facts.locator(".rv-bar-col").last()).toHaveAttribute("aria-label", /^15 JUN: focus not read, \d+ ticked$/);
  for (const k of ["Where the time went", "By category", "Best weekday · last 30 days"]) {
    await expect(facts.getByText(k)).toBeVisible();
  }
  await expect(facts.locator(".rv-card").filter({ hasText: /^Open now · \d+/ })).toContainText(/planned today, .* left\./);

  await page.getByRole("radio", { name: "30 days" }).click();
  await expect(facts.locator(".rv-bar-col")).toHaveCount(30);
  await page.getByRole("radio", { name: "Today" }).click();
  await expect(facts.locator(".rv-bar-col")).toHaveCount(1);
  await expect(facts.locator(".rv-dow-labels span")).toHaveCount(7);
});

test("phone: one column, the small charts stack", async ({ page }) => {
  await openReview(page, { width: 390, height: 844 });
  const cards = page.locator(".rv-card");
  await expect(cards).toHaveCount(4);
  const a = await cards.nth(0).boundingBox();
  const b = await cards.nth(1).boundingBox();
  expect(b.y).toBeGreaterThan(a.y + a.height - 1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("Mind Box no longer offers Insights", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByTestId("demo-btn").click();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Mind Box", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Morning ritual" })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole("button", { name: /Insights/ })).toHaveCount(0);
});
