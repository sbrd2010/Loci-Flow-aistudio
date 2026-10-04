import { test, expect } from "@playwright/test";

// Day map controls (52d, 56a–b): From · Fixed time. Every open Today task is
// on the route, in Today's list order (Q59): no Unscheduled, Auto-fill or
// Clear route.

async function openDayMap(page, viewport) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T11:35:00"));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Day map →" }).click();
  await expect(page.locator(".day-map-page")).toBeVisible();
}

const stopTitles = (page) => page.locator(".dm-stop .dm-title").allInnerTexts().then(ts => ts.map(t => t.trim()));

test("laptop: the controls sit in the right column as text: From and Fixed time, no Auto-fill or Clear", async ({ page }) => {
  await openDayMap(page, { width: 1280, height: 800 });
  const controls = page.locator(".dm-controls");
  const route = await page.locator(".dm-route-wrap").boundingBox();
  const box = await controls.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(route.x + route.width);
  await expect(controls.getByRole("button")).toHaveText(["Fixed time"]);
  await expect(page.getByRole("button", { name: /Auto-fill|Clear route/ })).toHaveCount(0);
  await expect(page.getByRole("region", { name: /^Unscheduled/ })).toHaveCount(0);
  // Every open Today task is a stop; the NOW stop keeps its Start focus.
  await expect(page.locator(".dm-stop")).toHaveCount(3);
  await expect(page.locator(".dm-stop.is-now").getByRole("button", { name: "Start focus" })).toBeVisible();
});

test("the route is Today's list, in its order; a task added to Today joins it at the end", async ({ page }) => {
  await openDayMap(page, { width: 1280, height: 800 });
  await page.getByRole("button", { name: "Back to Today" }).click();
  // Move the P2 row below the P4 one (Space picks it up, ↓, Space drops it),
  // so the list's order is not the priority order.
  const rows = page.getByTestId("today-tasks-list").locator("[data-testid='task-row']");
  const announced = (re) => page.waitForFunction((src) =>
    [...document.querySelectorAll("[id^='DndLiveRegion']")].some(el => new RegExp(src).test(el.textContent)), re.source);
  await rows.first().focus();
  await page.keyboard.press("Space");
  await announced(/Picked up|was moved over/);
  await page.keyboard.press("ArrowDown");
  await announced(/Draggable item (\S+) was moved over droppable area (?!\1\b)\S+/);
  await page.keyboard.press("Space");
  await expect(rows.first().locator(".task-row-priority")).toHaveText("P4");
  await page.getByRole("button", { name: "Add a task to Today" }).first().click();
  await page.getByTestId("add-task-title").fill("Order printer ink");
  await page.getByTestId("add-task-submit").click();
  await expect(page.locator(".add-card")).not.toBeVisible({ timeout: 5_000 });
  const one = (await page.locator(".wall-title").innerText()).trim();
  const list = (await rows.locator(".task-title-text").allInnerTexts()).map(t => t.trim());
  expect(list.length).toBe(3);
  expect(list[2]).toBe("Order printer ink");

  await page.getByRole("button", { name: "Day map →" }).click();
  // The one thing heads the route at NOW; the list's rows follow, in order.
  await expect.poll(() => stopTitles(page)).toEqual([one, ...list]);
});

// Codex review of #413: a stop opens from the keyboard (Enter) — now its
// task sheet (52) — while Space still picks it up to reorder.
test("keyboard: Enter on a stop opens its sheet, Esc hands focus back; Space picks it up to reorder", async ({ page }) => {
  await openDayMap(page, { width: 1280, height: 800 });
  const stops = page.locator(".dm-stop .dm-main");
  await stops.nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("task-detail").getByRole("button", { name: "Fix time" })).toBeVisible();
  await expect(page.locator(".dm-stop").nth(1)).toHaveClass(/is-open/);
  await page.getByTestId("task-detail").getByRole("button", { name: "Fix time" }).focus();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("task-detail")).toHaveCount(0);
  await expect(page.locator(".day-map-page")).toBeVisible();
  await expect(stops.nth(1)).toBeFocused();

  const before = await stopTitles(page);
  // Each step waits for the page's own state: the stop held, then moved.
  // dnd-kit measures the list a frame or two after the pick-up; an arrow key
  // before that is ignored, which no person types fast enough to hit.
  const held = page.locator(".dm-stop.is-dragging");
  const settle = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const moved = () => page.waitForFunction(() => {
    const el = document.querySelector(".dm-stop.is-dragging");
    return !!el && el.style.transform && el.style.transform !== "none" && !/translate3d\(0px, 0px/.test(el.style.transform);
  });
  await stops.nth(1).focus();
  await page.keyboard.press("Space");
  await expect(held).toHaveCount(1);
  await settle();
  await page.keyboard.press("ArrowDown");
  await moved();
  await page.keyboard.press("Space");
  await expect(held).toHaveCount(0);
  await expect.poll(() => stopTitles(page)).toEqual([before[0], before[2], before[1]]);

  // Enter drops a held stop too — and opens nothing.
  await page.locator(".dm-stop .dm-main").nth(2).focus();
  await page.keyboard.press("Space");
  await expect(held).toHaveCount(1);
  await settle();
  await page.keyboard.press("ArrowUp");
  await moved();
  await page.keyboard.press("Enter");
  await expect(held).toHaveCount(0);
  await expect.poll(() => stopTitles(page)).toEqual(before);
  await expect(page.getByTestId("task-detail")).toHaveCount(0);
});

