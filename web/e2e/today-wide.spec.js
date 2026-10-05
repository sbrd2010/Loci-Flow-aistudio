import { test, expect } from "@playwright/test";
import { openDayMapPage } from "./helpers/today";

// 54a, 54e: from 1600px the cap is 1760px (2240px from 2200px). Q59: no
// Day map column of its own; the List | Day map switch shows the Day map in
// the list's place, at every size.

async function enterDemo(page, viewport, time = "2024-06-15T11:35:00") {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.clock.setFixedTime(new Date(time));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("today-tasks-list")).toBeVisible();
}

const column = (page) => page.getByRole("region", { name: "Day map" });

// The Day map view (Q59), with every open Today task on its route.
async function routeReady(page) {
  await page.getByRole("group", { name: "View" }).getByRole("button", { name: "Day map", exact: true }).click();
  await expect(column(page).locator("button.tdm-stop")).toHaveCount(3);
}

test("1680: no third column; the switch shows the Day map in the list's place, and keeps it (Q59)", async ({ page }) => {
  await enterDemo(page, { width: 1680, height: 1000 });
  await expect(column(page)).toHaveCount(0);
  await routeReady(page);
  await expect(page.getByTestId("today-tasks-list")).toHaveCount(0);
  const stops = column(page).getByRole("list", { name: "Today's route" }).getByRole("button");
  await expect(stops.first()).toHaveAccessibleName(/^Now to /);
  // Nothing past the line: the time to spare.
  await expect(column(page).locator(".tdm-dayend")).toHaveText(/^DAY ENDS 02:00 · \d+H(\d{2}M)? SPARE$/);
  // The view is kept: back on Today after the Day map page, still the map.
  await column(page).getByRole("button", { name: "Day map page ›" }).click();
  await expect(page.locator(".day-map-page")).toBeVisible();
  await page.locator(".dm-back").click();
  await expect(column(page)).toBeVisible();
  await page.getByRole("group", { name: "View" }).getByRole("button", { name: "List" }).click();
  await expect(page.getByTestId("today-tasks-list")).toBeVisible();
});

test("2130: the content stops at 1760px and the margins take the rest", async ({ page }) => {
  await enterDemo(page, { width: 2130, height: 1000 });
  const wall = await page.locator(".today-layout").boundingBox();
  expect(Math.round(wall.width)).toBeLessThanOrEqual(1760);
  expect(Math.round(wall.width)).toBeGreaterThanOrEqual(1740);
  const brand = await page.getByRole("banner").getByRole("button", { name: "Loci" }).boundingBox();
  expect(Math.abs(brand.x - wall.x)).toBeLessThan(2);
});

// 57b: from 2200px the cap is 2240px and the title is one step up.
test("2400: the content stops at 2240px, and the list-hidden title is one step up", async ({ page }) => {
  await enterDemo(page, { width: 2400, height: 1200 });
  const wall = await page.locator(".today-layout").boundingBox();
  expect(Math.round(wall.width)).toBe(2240);
  const shown = await page.locator(".wall-title").evaluate(el => [el.dataset.len, parseFloat(getComputedStyle(el).fontSize)]);
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("l");
  await expect(page.locator("section.today-list")).toBeHidden();
  const hidden = await page.locator(".wall-title").evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  // Wide sizes with the list shown, one step up with it hidden.
  const steps = { s: [64, 72], m: [52, 58], l: [42, 48], xl: [36, 40] }[shown[0]];
  expect([shown[1], hidden]).toEqual(steps);
});

// Codex review of #422: at the 2240px cap the header keeps the content's
// left edge.
test("2400: the header follows the 2240px cap", async ({ page }) => {
  await enterDemo(page, { width: 2400, height: 1200 });
  const wall = await page.locator(".today-layout").boundingBox();
  const brand = await page.getByRole("banner").getByRole("button", { name: "Loci" }).boundingBox();
  expect(Math.abs(brand.x - wall.x)).toBeLessThan(2);
});

test("won't fit: Move N to tomorrow moves the stops past the day's end, with Today's Undo", async ({ page }) => {
  // 01:00, an hour before the demo's day ends at 02:00: the third stop starts
  // at 02:00, so it won't fit.
  await enterDemo(page, { width: 1680, height: 1000 }, "2024-06-16T01:00:00");
  await routeReady(page);
  await expect(column(page).getByRole("heading", { name: /^Won’t fit today 1 · 25 MIN$/ })).toBeVisible();
  const late = column(page).getByRole("list", { name: "Won't fit today" }).getByRole("button");
  await expect(late).toHaveCount(1);
  await expect(late).toHaveAccessibleName(/, after the day ends$/);
  const title = (await late.locator(".tdm-title").textContent()).trim();

  await column(page).getByRole("button", { name: "Move 1 to tomorrow" }).click();
  await expect(page.locator(".undo-toast")).toContainText("1 task moved to tomorrow");
  await expect(column(page).getByRole("button", { name: /Move \d+ to tomorrow/ })).toHaveCount(0);
  await expect(column(page).getByText(title)).toHaveCount(0);

  await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
  await expect(column(page).getByRole("button", { name: "Move 1 to tomorrow" })).toBeVisible();
  await expect(column(page).getByText(title)).toBeVisible();

  // Q59 (70d): Park 1, with Undo; the line then shows the time to spare.
  await column(page).getByRole("button", { name: "Park 1" }).click();
  await expect(page.locator(".undo-toast")).toContainText("1 parked");
  await expect(column(page).getByText(title)).toHaveCount(0);
  await expect(column(page).locator(".tdm-dayend")).toContainText("SPARE");
  await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
  await expect(column(page).getByText(title)).toBeVisible();
});

test("a stop opens its task in the drawer; Esc goes back to the stop", async ({ page }) => {
  await enterDemo(page, { width: 1680, height: 1000 });
  await routeReady(page);
  const stop = column(page).getByRole("list", { name: "Today's route" }).getByRole("button").nth(1);
  await stop.click();
  const drawer = page.locator(".task-detail.is-drawer");
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(stop).toBeFocused();
});

test("1600: the drawer's footer sits on one row", async ({ page }) => {
  await enterDemo(page, { width: 1600, height: 900 });
  await routeReady(page);
  await column(page).getByRole("list", { name: "Today's route" }).getByRole("button").nth(1).click();
  const drawer = page.locator(".task-detail.is-drawer");
  await expect(drawer).toBeVisible();
  const drawerBox = await drawer.boundingBox();
  const actions = await drawer.locator(".detail-action").evaluateAll(els => els.map(el => el.getBoundingClientRect()).map(r => ({ top: r.top, right: r.right })));
  // 52b: three text buttons (Tomorrow · Park · Delete; Done is the circle).
  expect(actions).toHaveLength(3);
  expect(new Set(actions.map(a => Math.round(a.top))).size).toBe(1);
  for (const a of actions) expect(a.right).toBeLessThanOrEqual(drawerBox.x + drawerBox.width);
  // …and the 186px Priority segment stays whole inside it (52b).
  const seg = await drawer.locator(".detail-seg").boundingBox();
  expect(Math.round(seg.width)).toBeGreaterThanOrEqual(186);
  expect(seg.x + seg.width).toBeLessThanOrEqual(drawerBox.x + drawerBox.width);
});

test("the column's own route controls: From only; no Auto-fill, Clear route or Unscheduled (Q59)", async ({ page }) => {
  await enterDemo(page, { width: 1680, height: 1000 });
  await routeReady(page);
  await expect(column(page).getByLabel("Route start time")).toBeVisible();
  await expect(column(page).getByRole("button", { name: /Auto-fill|Clear route/ })).toHaveCount(0);
  await expect(column(page).getByRole("region", { name: "Unscheduled" })).toHaveCount(0);
});

test("made the one thing, a task moves to NOW on the route; the rest flows after it; Undo puts it back (53–56)", async ({ page }) => {
  await enterDemo(page, { width: 1680, height: 1000 });
  await routeReady(page);
  const stops = column(page).getByRole("list", { name: "Today's route" }).getByRole("button");
  await expect(stops).toHaveCount(3);
  const firstBefore = (await stops.first().locator(".tdm-title").textContent()).trim();
  const lastTitle = (await stops.last().locator(".tdm-title").textContent()).trim();

  await stops.last().click();
  await page.getByTestId("task-detail").getByRole("button", { name: /^Make this the one thing/ }).click();
  await expect(page.locator(".wall-title")).toHaveText(lastTitle);
  await expect(stops.first()).toHaveAccessibleName(new RegExp(`^Now to \\d\\d:\\d\\d, ${lastTitle}, the one thing`));
  await expect(stops.first().locator(".tdm-one-thing")).toHaveText(/^THE ONE THING · UNTIL \d\d:\d\d$/);
  await expect(stops).toHaveCount(3);

  await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
  await expect(stops.first().locator(".tdm-title")).toHaveText(new RegExp(`^${firstBefore.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  await expect(stops.last().locator(".tdm-title")).toHaveText(lastTitle);
});

// Q59 (70a): the List keeps the Day ends line, the rows past it muted, then
// one line that sorts them in the Day map.
test("the List shows where the day ends; the row past it is muted, and Sort in Day map › switches the view", async ({ page }) => {
  await enterDemo(page, { width: 1280, height: 900 }, "2024-06-16T01:00:00");
  const list = page.getByTestId("today-tasks-list");
  const line = list.locator(".today-dayend");
  await expect(line).toHaveText("DAY ENDS 02:00");
  await expect(list.locator(".today-row-over")).toHaveCount(1);
  // The muted row comes after the line.
  const [lineBox, overBox] = await Promise.all([line.boundingBox(), list.locator(".today-row-over").boundingBox()]);
  expect(overBox.y).toBeGreaterThan(lineBox.y);
  const sort = list.locator(".today-wontfit-line");
  await expect(sort).toHaveText(/^1 won’t fit · 25 min · Sort in Day map ›$/);
  await sort.getByRole("button", { name: "Sort in Day map ›" }).click();
  await expect(column(page).getByRole("button", { name: "Move 1 to tomorrow" })).toBeVisible();
  await expect(column(page).getByRole("button", { name: "Park 1" })).toBeVisible();
});

// Q59 rows (70a, 70f): circle · title · how long; the grip only on hover.
test("a row is circle · title · how long, with the grip only on hover", async ({ page }) => {
  await enterDemo(page, { width: 1280, height: 900 });
  const row = page.getByTestId("today-tasks-list").locator("[data-testid='task-row']").first();
  await expect(row.locator(".task-row-dur")).toHaveText("25 MIN");
  await expect(row.locator(".task-row-priority")).toHaveCount(0);
  const grip = row.locator(".task-row-grip");
  await page.mouse.move(5, 5);
  expect(await grip.evaluate(el => getComputedStyle(el).opacity)).toBe("0");
  await row.hover();
  await expect.poll(() => grip.evaluate(el => getComputedStyle(el).opacity)).toBe("1");
});

// 69e: past the day's end, Tomorrow · Park take the length's place on hover.
test("a row past the day's end offers Tomorrow · Park on hover", async ({ page }) => {
  await enterDemo(page, { width: 1280, height: 900 }, "2024-06-16T01:00:00");
  const over = page.getByTestId("today-tasks-list").locator(".today-row-over [data-testid='task-row']");
  const title = (await over.locator(".task-title-text").innerText()).trim();
  await over.hover();
  await over.getByRole("button", { name: "Park" }).click();
  await expect(page.locator(".undo-toast")).toContainText(`Parked: ${title}`);
  await expect(page.getByTestId("today-tasks-list").locator(".today-row-over")).toHaveCount(0);
});

// Q1 (69c, 70c): a fixed time sits at its time, shows its span and isn't
// dragged; a task dropped above it that can't finish first goes after it.
test("a fixed time shows its span and stays put; a task dropped above it that won't fit goes after, with Undo", async ({ page }) => {
  await enterDemo(page, { width: 1280, height: 900 });
  await openDayMapPage(page);
  await page.getByRole("button", { name: "Fixed time" }).click();
  await page.getByRole("dialog", { name: "Fix a time" }).getByRole("button", { name: /Something else/ }).click();
  const step2 = page.getByRole("dialog", { name: /^Fix a time: Something else/ });
  await step2.getByRole("textbox", { name: "What" }).fill("Call with the recruiter");
  await step2.getByRole("radio", { name: "12:00" }).click();
  await step2.getByRole("button", { name: "Fix at 12:00" }).click();
  await page.locator(".dm-back").click();

  const rows = page.getByTestId("today-tasks-list").locator("[data-testid='task-row']");
  const call = rows.filter({ hasText: "Call with the recruiter" });
  await expect(call.locator(".task-row-dur")).toHaveText("12:00–12:30");
  // The one thing runs 11:35–12:00, so the call heads the list.
  await expect(rows.first()).toContainText("Call with the recruiter");
  await call.hover();
  await expect(call.locator(".task-row-grip")).toHaveCount(0);

  // The last row, dropped above the call: no room before 12:00.
  const last = (await rows.last().locator(".task-title-text").innerText()).trim();
  const announced = (re) => page.waitForFunction((src) =>
    [...document.querySelectorAll("[id^='DndLiveRegion']")].some(el => new RegExp(src).test(el.textContent)), re.source);
  // Each key waits for dnd-kit to say what it did: a key before it has
  // measured the list is ignored.
  const live = () => page.evaluate(() => [...document.querySelectorAll("[id^='DndLiveRegion']")].map(el => el.textContent).join("|"));
  await rows.last().focus();
  await page.keyboard.press("Space");
  await announced(/Picked up|was moved over/);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  for (let i = 0; i < 2; i++) {
    const before = await live();
    await page.keyboard.press("ArrowUp");
    await expect.poll(live).not.toBe(before);
  }
  await page.keyboard.press("Space");
  await expect(page.locator(".undo-toast")).toContainText("Doesn’t fit before 12:00 · placed after");
  await expect(rows.first()).toContainText("Call with the recruiter");
  await expect(rows.nth(1).locator(".task-title-text")).toHaveText(last);
  await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
  await expect(rows.last().locator(".task-title-text")).toHaveText(last);
});

// Rohan: Hide list is an arrow, as a chat app's sidebar; with the list away,
// an arrow at the right edge brings it back. The header reads "+ Add task".
test("the list hides with an arrow and comes back from the right edge's arrow; + Add task", async ({ page }) => {
  await enterDemo(page, { width: 1280, height: 900 });
  await expect(page.locator(".today-list-add")).toHaveText("+ Add task");
  await expect(page.locator(".today-list-head")).not.toContainText("Must-do");
  await page.getByRole("button", { name: "Hide list" }).click();
  await expect(page.locator(".tasks-section")).toBeHidden();
  const show = page.getByRole("button", { name: /^Show list · \d+/ });
  const [box, layout] = await Promise.all([show.boundingBox(), page.locator(".today-layout").boundingBox()]);
  expect(Math.round(box.width)).toBe(40);
  expect(Math.abs(box.x + box.width - (layout.x + layout.width))).toBeLessThan(2);
  await show.click();
  await expect(page.locator(".tasks-section")).toBeVisible();
});

// 72: the task side from 840px: the goal in one line, NOW · UNTIL, the step
// as circle · text · "1 / N", one row of buttons, I'm stuck · More, and the
// footer's "N OF M DONE TODAY".
test("72: the task side reads goal · NOW · UNTIL · title · step · buttons, and the footer counts the day", async ({ page }) => {
  await enterDemo(page, { width: 1280, height: 900 });
  const goal = page.locator(".wall-goal");
  expect(Math.round((await goal.boundingBox()).height)).toBe(44);
  await expect(page.locator(".wall-kicker-wide")).toHaveText(/^NOW · UNTIL \d\d:\d\d$/);
  await expect(page.locator(".wall-step-count")).toHaveText(/^1 \/ \d+$/);
  await expect(page.locator(".wall-first-step-label")).toBeHidden();
  const [start, done] = await Promise.all([page.locator(".wall-start").boundingBox(), page.locator(".wall-action", { hasText: "Mark done" }).boundingBox()]);
  expect(done.x).toBeGreaterThan(start.x + start.width);
  await expect(page.locator(".wall-quiet").getByRole("button", { name: "More" })).toBeVisible();
  await expect(page.locator(".wall-daymap")).toBeHidden();
  await expect(page.locator(".today-foot-done")).toHaveText(/^0 OF \d+ DONE TODAY$/);
  await page.getByTestId("today-tasks-list").getByTestId("task-checkbox").first().click();
  await expect(page.locator(".today-foot-done")).toHaveText(/^1 OF \d+ DONE TODAY$/);
});
