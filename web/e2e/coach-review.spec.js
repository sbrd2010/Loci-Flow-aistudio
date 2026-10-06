import { test, expect } from "@playwright/test";

// Coach → Review (Q51, 73a/b): the brief, then the facts, with a Today ·
// 7 days · 30 days switch. Mind Box no longer has Insights. Demo mode: there is no focus
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
  await expect(facts.locator(".rv-numbers")).toContainText("focus time not read");
  await expect(facts.locator(".rv-bar-col")).toHaveCount(7);
  await expect(facts.locator(".rv-bar-col").last()).toHaveAttribute("aria-label", /^15 JUN: focus not read, \d+ ticked$/);
  await expect(facts.locator(".rv-bar-day").last()).toContainText("Today");
  await expect(facts.getByRole("heading", { name: "The week in numbers", exact: true })).toBeVisible();
  await expect(facts.getByText(/^Today has .* planned and .* left in the day\./)).toBeVisible();

  await page.getByRole("radio", { name: "30 days" }).click();
  await expect(facts.locator(".rv-bar-col")).toHaveCount(30);
  await expect(facts.getByRole("heading", { name: "30 days in numbers", exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Today" }).click();
  await expect(facts.locator(".rv-bar-col")).toHaveCount(1);
});

// 73a/b: one reading order. The brief first, then 02–06, each with a
// numbered sentence-case heading; no best-weekday chart; the period switch
// sits in the tab row, which stays put while the report scrolls.
test("Review reads top to bottom: 01 brief, then 02–06", async ({ page }) => {
  await openReview(page, { width: 1280, height: 720 });
  const titles = await page.locator("#coach-panel-review .rv-title").allInnerTexts();
  expect(titles.map(t => t.replace(/\s+/g, " ").trim())).toEqual([
    "01 Coach’s brief", "02 The week in numbers", "03 Focus each day",
    "04 Where the time went", "05 By category", expect.stringMatching(/^06 Still open · \d+ tasks?$/),
  ]);
  await expect(page.getByText(/Best weekday/)).toHaveCount(0);
  await expect(page.locator(".coach-tabs").getByRole("radiogroup", { name: "Period" })).toBeVisible();
  await page.mouse.wheel(0, 900);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(300);
  const tabs = await page.locator(".coach-tabs").boundingBox();
  const header = await page.locator(".shell-header").boundingBox();
  expect(Math.abs(tabs.y - (header.y + header.height))).toBeLessThanOrEqual(1);
});

test("phone: one column, the two small sections stack", async ({ page }) => {
  await openReview(page, { width: 390, height: 844 });
  const cards = page.locator(".rv-card");
  await expect(cards).toHaveCount(2);
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
