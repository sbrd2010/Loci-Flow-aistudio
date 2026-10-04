import { test, expect } from "@playwright/test";

// One order for the Today list and the Day map (Rohan, 4 Oct 2026): a drag
// in either is the same reorder in the other. The one thing heads the route
// at NOW and is not in the list, so it is left out of the comparison.

async function enterDemo(page) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T11:35:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
}

const nav = (page) => page.getByRole("navigation", { name: "Main navigation" });
const listTitles = (page) => page.getByTestId("today-tasks-list")
  .locator("[data-testid='task-row']:not(.completed) .task-title-text").allInnerTexts().then(ts => ts.map(t => t.trim()));
const routeTitles = (page) => page.locator(".dm-stop:not(.is-now) .dm-title").allInnerTexts().then(ts => ts.map(t => t.trim()));
const announced = (page, re) => page.waitForFunction((src) =>
  [...document.querySelectorAll("[id^='DndLiveRegion']")].some(el => new RegExp(src).test(el.textContent)), re.source);

async function openDayMap(page) {
  await page.getByRole("button", { name: "Day map →" }).click();
  await expect(page.locator(".day-map-page")).toBeVisible();
}
async function backToToday(page) {
  await nav(page).getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.getByTestId("today-tasks-list")).toBeVisible();
}

test("a reorder on Today shows on the Day map", async ({ page }) => {
  await enterDemo(page);
  await openDayMap(page);
  await page.getByRole("button", { name: "Auto-fill" }).click();
  await expect.poll(() => routeTitles(page).then(t => t.length)).toBeGreaterThan(1);
  await backToToday(page);

  const rows = page.getByTestId("today-tasks-list").locator("[data-testid='task-row']:not(.completed)");
  const before = await listTitles(page);
  await rows.first().focus();
  await page.keyboard.press("Space");
  await announced(page, /Picked up|was moved over/);
  await page.keyboard.press("ArrowDown");
  await announced(page, /Draggable item (\S+) was moved over droppable area (?!\1\b)\S+/);
  await page.keyboard.press("Space");
  await expect.poll(() => listTitles(page)).toEqual([before[1], before[0], ...before.slice(2)]);
  const list = await listTitles(page);

  await openDayMap(page);
  const route = await routeTitles(page);
  expect(route).toEqual(list.filter(t => route.includes(t)));
});

test("a reorder on the Day map shows on Today", async ({ page }) => {
  await enterDemo(page);
  await openDayMap(page);
  await page.getByRole("button", { name: "Auto-fill" }).click();
  const stops = page.locator(".dm-stop:not(.is-now) .dm-main");
  await expect.poll(() => stops.count()).toBeGreaterThan(1);
  const before = await routeTitles(page);

  const held = page.locator(".dm-stop.is-dragging");
  const settle = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const moved = () => page.waitForFunction(() => {
    const el = document.querySelector(".dm-stop.is-dragging");
    return !!el && el.style.transform && el.style.transform !== "none" && !/translate3d\(0px, 0px/.test(el.style.transform);
  });
  await stops.first().focus();
  await page.keyboard.press("Space");
  await expect(held).toHaveCount(1);
  await settle();
  await page.keyboard.press("ArrowDown");
  await moved();
  await page.keyboard.press("Space");
  await expect(held).toHaveCount(0);
  await expect.poll(() => routeTitles(page)).toEqual([before[1], before[0], ...before.slice(2)]);
  const route = await routeTitles(page);

  await backToToday(page);
  const list = await listTitles(page);
  expect(list.filter(t => route.includes(t))).toEqual(route);
});
