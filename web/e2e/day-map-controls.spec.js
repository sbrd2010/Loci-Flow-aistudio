import { test, expect } from "@playwright/test";

// Day map controls and the Unscheduled pool (52d–e): From · Auto-fill · Clear
// route above the route (Clear route has Undo, no confirm; Auto-fill fills
// from Today's list order), and the tasks not on the route in a card on the
// right (laptop) or a bar that opens a sheet (phone), each with a "+" that
// adds it to the end of the route. On a laptop a task can be dragged in.

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
const pool = (page) => page.getByRole("region", { name: /^Unscheduled/ });

test("laptop: the controls sit above the route as text, and Clear route has Undo, no confirm", async ({ page }) => {
  await openDayMap(page, { width: 1280, height: 800 });
  const controls = page.locator(".dm-controls");
  const route = await page.locator(".dm-route-wrap").boundingBox();
  const box = await controls.boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(route.y + 1);
  await expect(controls.getByRole("button")).toHaveText(["Auto-fill", "Clear route"]);

  await page.getByRole("button", { name: "Auto-fill" }).click();
  const before = await page.locator(".dm-stop .dm-main").evaluateAll(els => els.map(e => e.getAttribute("aria-label")));
  expect(before.length).toBe(3);

  await page.getByRole("button", { name: "Clear route" }).click();
  await expect(page.locator(".dm-stop")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".undo-toast")).toContainText("Route cleared");
  await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".dm-stop")).toHaveCount(3);
  const after = await page.locator(".dm-stop .dm-main").evaluateAll(els => els.map(e => e.getAttribute("aria-label")));
  expect(after).toEqual(before);
  // The NOW stop keeps its Start focus.
  await expect(page.locator(".dm-stop.is-now").getByRole("button", { name: "Start focus" })).toBeVisible();
});

test("Auto-fill fills from Today's list order, not by priority", async ({ page }) => {
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
  const one = (await page.locator(".wall-title").innerText()).trim();
  const list = (await page.getByTestId("today-tasks-list").locator("[data-testid='task-row'] .task-title-text").allInnerTexts()).map(t => t.trim());
  await page.getByRole("button", { name: "Day map →" }).click();
  await page.getByRole("button", { name: "Auto-fill" }).click();
  const route = await stopTitles(page);
  // The list's rows keep their order on the route; the one thing is on it too.
  expect(list.length).toBe(2);
  expect(route.filter(t => list.includes(t))).toEqual(list);
  expect(route).toContain(one);
});

test("laptop: Unscheduled is a card on the right; + adds a task to the end of the route", async ({ page }) => {
  await openDayMap(page, { width: 1280, height: 800 });
  const card = pool(page);
  const route = await page.locator(".dm-route-wrap").boundingBox();
  expect((await card.boundingBox()).x).toBeGreaterThan(route.x + route.width);
  await expect(card.locator(".dm-pool-count")).toHaveText("3");
  await expect(card).toContainText("+ OR DRAG IN");
  await expect(page.locator(".dm-pool-bar")).toBeHidden();

  const titles = (await card.locator(".dm-pool-title").allInnerTexts()).map(t => t.trim());
  await card.getByRole("button", { name: `Add to route: ${titles[1]}` }).click();
  await card.getByRole("button", { name: `Add to route: ${titles[0]}` }).click();
  expect(await stopTitles(page)).toEqual([titles[1], titles[0]]);
  await expect(card.locator(".dm-pool-count")).toHaveText("1");
  const add = card.getByRole("button", { name: `Add to route: ${titles[2]}` });
  const hit = await add.boundingBox();
  expect(Math.round(hit.width)).toBe(40);
  expect(Math.round(hit.height)).toBe(40);
  await add.click();
  await expect(card).toContainText("All of today’s tasks are on the route.");
});

test("laptop: a task dragged from Unscheduled goes in before the stop it is dropped on", async ({ page }) => {
  await openDayMap(page, { width: 1280, height: 800 });
  const card = pool(page);
  const titles = (await card.locator(".dm-pool-title").allInnerTexts()).map(t => t.trim());
  await card.getByRole("button", { name: `Add to route: ${titles[0]}` }).click();
  await card.getByRole("button", { name: `Add to route: ${titles[1]}` }).click();

  const from = await card.locator(".dm-pool-row").first().locator(".dm-pool-title").boundingBox();
  const to = await page.locator(".dm-stop").first().boundingBox();
  await page.mouse.move(from.x + 10, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 30, from.y + from.height / 2, { steps: 4 });
  await page.mouse.move(to.x + 40, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  expect(await stopTitles(page)).toEqual([titles[2], titles[0], titles[1]]);
  await expect(card.locator(".dm-pool-count")).toHaveText("0");
});

test("phone: Unscheduled is a bar above the action at the bottom; it opens a sheet whose + adds to the route", async ({ page }) => {
  await openDayMap(page, { width: 412, height: 892 });
  const bar = page.locator(".dm-pool-bar");
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("Unscheduled 3");
  await expect(bar).toContainText("Add to route");
  await expect(pool(page)).toBeHidden();
  // Pinned above the nav, not wherever the route happens to end.
  const nav = await page.locator(".tab-bar").boundingBox();
  const side = await page.locator(".dm-side").boundingBox();
  expect(Math.abs(side.y + side.height - nav.y)).toBeLessThan(3);

  await bar.click();
  const sheet = page.getByRole("dialog", { name: "Unscheduled" });
  await expect(sheet).toBeVisible();
  const title = (await sheet.locator(".dm-pool-title").first().innerText()).trim();
  await sheet.getByRole("button", { name: `Add to route: ${title}` }).click();
  expect(await stopTitles(page)).toEqual([title]);
  await expect(sheet.locator(".dm-pool-count")).toHaveText("2");
  // Its row has gone; focus moves to the next row's +, still in the sheet.
  await expect(sheet.locator(".dm-pool-add").first()).toBeFocused();
  // Esc closes the sheet, not the page, and hands focus back to the bar —
  // even with focus nowhere in particular (a tap on its heading).
  await sheet.locator(".dm-pool-name").click();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(page.locator(".day-map-page")).toBeVisible();
  await expect(bar).toContainText("Unscheduled 2");
  await expect(bar).toBeFocused();
});

// Codex review of #413: a stop opens from the keyboard (Enter) — now its
// task sheet (52) — while Space still picks it up to reorder.
test("keyboard: Enter on a stop opens its sheet, Esc hands focus back; Space picks it up to reorder", async ({ page }) => {
  await openDayMap(page, { width: 1280, height: 800 });
  await page.getByRole("button", { name: "Auto-fill" }).click();
  const stops = page.locator(".dm-stop .dm-main");
  await stops.nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("task-detail").getByRole("button", { name: "Remove from route" })).toBeVisible();
  await expect(page.locator(".dm-stop").nth(1)).toHaveClass(/is-open/);
  await page.getByTestId("task-detail").getByRole("button", { name: "Remove from route" }).focus();
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
  await expect(page.getByRole("button", { name: "Remove from route" })).toHaveCount(0);
});

// Codex review of #413: the sheet is modal — Tab stays in it — and adding its
// last task closes it for good, rather than leaving it open to come back.
test("phone: Tab stays in the Unscheduled sheet; adding its last task closes it, and it stays closed", async ({ page }) => {
  await openDayMap(page, { width: 412, height: 892 });
  await page.locator(".dm-pool-bar").click();
  const sheet = page.getByRole("dialog", { name: "Unscheduled" });
  const inSheet = () => page.evaluate(() => !!document.activeElement?.closest(".dm-pool-sheet"));
  await expect(sheet.getByRole("button", { name: "Close" })).toBeFocused();
  for (let i = 0; i < 5; i++) { await page.keyboard.press("Tab"); expect(await inSheet()).toBe(true); }
  for (let i = 0; i < 5; i++) { await page.keyboard.press("Shift+Tab"); expect(await inSheet()).toBe(true); }

  for (let i = 3; i > 0; i--) await sheet.locator(".dm-pool-add").first().click();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator(".dm-pool-bar")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".dm-stop .dm-main").first()).toBeFocused();
  // A task back in the pool must not bring the sheet back on its own.
  await page.getByRole("button", { name: "Clear route" }).click();
  await expect(page.locator(".dm-pool-bar")).toContainText("Unscheduled 3");
  await expect(sheet).toHaveCount(0);
});

// Codex review of #413, round two.
test("Undo of Clear route after adding a task times the whole route again: no two stops share a start", async ({ page }) => {
  await openDayMap(page, { width: 1280, height: 800 });
  // Two on the route, one left in Unscheduled.
  const titles = (await pool(page).locator(".dm-pool-title").allInnerTexts()).map(t => t.trim());
  await pool(page).getByRole("button", { name: `Add to route: ${titles[0]}` }).click();
  await pool(page).getByRole("button", { name: `Add to route: ${titles[1]}` }).click();
  await page.getByRole("button", { name: "Clear route" }).click();
  // Then one that was not on it — it takes the first start time.
  await pool(page).getByRole("button", { name: `Add to route: ${titles[2]}` }).click();
  await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
  // What came back keeps its order; what was added since goes after it.
  await expect.poll(() => stopTitles(page)).toEqual([titles[0], titles[1], titles[2]]);
  const labels = await page.locator(".dm-stop .dm-main").evaluateAll(els => els.map(e => e.getAttribute("aria-label")));
  const starts = labels.map(l => l.split(" to ")[0]);
  expect(new Set(starts).size).toBe(3);
});

test("Space on an Unscheduled + adds the task; it never starts a drag", async ({ page }) => {
  await openDayMap(page, { width: 1280, height: 800 });
  const title = (await pool(page).locator(".dm-pool-title").first().innerText()).trim();
  await pool(page).getByRole("button", { name: `Add to route: ${title}` }).focus();
  await page.keyboard.press("Space");
  await expect.poll(() => stopTitles(page)).toEqual([title]);
  await expect(page.locator(".dm-drag-ghost")).toHaveCount(0);
});

test("the phone's sheet closes when the page crosses into the laptop layout, and stays closed", async ({ page }) => {
  await openDayMap(page, { width: 800, height: 1000 });
  await page.locator(".dm-pool-bar").click();
  await expect(page.getByRole("dialog", { name: "Unscheduled" }).getByRole("button", { name: "Close" })).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 800 });
  // Focus goes to what took the sheet's place, not to the page.
  await expect(pool(page).locator(".dm-pool-add").first()).toBeFocused();
  // Closed, not just hidden by the laptop's CSS.
  await expect(page.locator(".dm-pool-bar")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".dm-pool-sheet")).toHaveCount(0);
  await page.setViewportSize({ width: 800, height: 1000 });
  await expect(page.getByRole("dialog", { name: "Unscheduled" })).toHaveCount(0);
  await expect(page.locator(".dm-pool-bar")).toHaveAttribute("aria-expanded", "false");
  // And Esc, on the page, goes back as it should.
  await page.locator(".dm-heading").click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".day-map-page")).toHaveCount(0);
});

test("laptop: a task dragged from Unscheduled onto an empty route becomes its first stop", async ({ page }) => {
  await openDayMap(page, { width: 1280, height: 800 });
  const card = pool(page);
  const title = (await card.locator(".dm-pool-title").first().innerText()).trim();
  const from = await card.locator(".dm-pool-row").first().locator(".dm-pool-title").boundingBox();
  const to = await page.locator(".dm-route-empty").boundingBox();
  await page.mouse.move(from.x + 10, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 30, from.y + from.height / 2, { steps: 4 });
  await page.mouse.move(to.x + 40, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  expect(await stopTitles(page)).toEqual([title]);
});
