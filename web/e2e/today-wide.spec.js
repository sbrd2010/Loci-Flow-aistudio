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

// Turn 76: the page grows with the window, by the smaller of width ÷ 1422
// and height ÷ 800, a tenth smaller since the try-out (×1.25 ÷ 1.1 at
// 2130×1000), and runs edge to edge: no cap.
test("2130×1000: ×1.25 ÷ 1.1, edge to edge with 40px gutters (no 1760 cap)", async ({ page }) => {
  await enterDemo(page, { width: 2130, height: 1000 });
  const z = 1.25 / 1.1;
  expect(await page.evaluate(() => document.documentElement.currentCSSZoom)).toBeCloseTo(z, 3);
  const wall = await page.locator(".today-layout").boundingBox();
  expect(Math.abs(wall.x - 40 * z)).toBeLessThan(1);
  expect(Math.abs(wall.x + wall.width - (2130 - 40 * z))).toBeLessThan(1);
  const brand = await page.getByRole("banner").getByRole("button", { name: "Loci" }).boundingBox();
  expect(Math.abs(brand.x - wall.x)).toBeLessThan(2);
});

// 75a: the title is 46 (its length steps below that), list shown or hidden.
test("2400×1200: ×1.5 ÷ 1.1, and the title keeps its size, list shown or hidden", async ({ page }) => {
  await enterDemo(page, { width: 2400, height: 1200 });
  expect(await page.evaluate(() => document.documentElement.currentCSSZoom)).toBeCloseTo(1.5 / 1.1, 3);
  const shown = await page.locator(".wall-title").evaluate(el => [el.dataset.len, parseFloat(getComputedStyle(el).fontSize)]);
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("l");
  await expect(page.locator("section.today-list")).toBeHidden();
  const hidden = await page.locator(".wall-title").evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  const size = { s: 46, m: 46, l: 36, xl: 32 }[shown[0]];
  expect([shown[1], hidden]).toEqual([size, size]);
});

// Codex review of #422: on the widest screens the header keeps the content's
// left edge.
test("2400: the header keeps the content's left edge", async ({ page }) => {
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

// Codex review of #478: the swipe wrapper clipped the grip in the gutter, so
// it showed (opacity 1) but couldn't be seen or grabbed. With a mouse it
// takes the pointer and drags the row.
test("the hover grip is grabbable: a mouse drag by it reorders the list", async ({ page }) => {
  await enterDemo(page, { width: 1280, height: 900 }, "2024-06-15T10:00:00");
  const rows = page.getByTestId("today-tasks-list").locator("[data-testid='task-row']");
  const titles = async () => (await rows.locator(".task-title-text").allInnerTexts()).map(t => t.trim());
  const [first, second] = await titles();
  await rows.nth(1).hover();
  const grip = rows.nth(1).locator(".task-row-grip");
  const g = await grip.boundingBox();
  const x = g.x + g.width / 2, y = g.y + g.height / 2;
  expect(await page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.closest(".task-row-grip"), [x, y])).toBe(true);
  const target = await rows.nth(0).boundingBox();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 12, { steps: 3 });
  await page.mouse.move(x, target.y + 4, { steps: 10 });
  await page.mouse.up();
  await expect.poll(titles).toEqual([second, first]);
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
  // One line, and the Target as a quiet line under it (try-out 26).
  await expect(goal.locator(".wall-goal-target")).toBeVisible();
  const h = Math.round((await goal.boundingBox()).height);
  expect(h).toBeGreaterThanOrEqual(44);
  expect(h).toBeLessThanOrEqual(52);
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

// The widest screens: the dragged copy lands on the row it is moved to.
test("2880: a row moved by keyboard drag lands where its copy shows", async ({ page }) => {
  await enterDemo(page, { width: 2880, height: 1620 }, "2024-06-15T10:00:00");
  // The largest scale (28.5/16): the copy still lands on the row.
  expect(await page.evaluate(() => document.documentElement.currentCSSZoom)).toBeCloseTo(28.5 / 16, 3);
  const rows = page.getByTestId("today-tasks-list").locator("[data-testid='task-row']");
  const titles = async () => (await rows.locator(".task-title-text").allInnerTexts()).map(t => t.trim());
  const [first, second] = await titles();
  const target = await rows.nth(0).boundingBox();
  const source = await rows.nth(1).boundingBox();
  const copyTop = async () => (await page.locator("div[style*='rotate(1deg)']").boundingBox())?.y ?? -1e4;
  const near = (y) => async () => Math.abs((await copyTop()) - y) < 16;
  const live = () => page.evaluate(() => [...document.querySelectorAll("[id^='DndLiveRegion']")].map(el => el.textContent).join("|"));
  await rows.nth(1).focus();
  await page.keyboard.press("Space");
  // Picked up: the copy covers the row it came from.
  await expect.poll(near(source.y)).toBe(true);
  const before = await live();
  await page.keyboard.press("ArrowUp");
  await expect.poll(live).not.toBe(before);
  await expect.poll(near(target.y)).toBe(true);
  await page.keyboard.press("Space");
  await expect.poll(titles).toEqual([second, first]);
});

// Codex review of #486: a pick from "Pick the one thing" goes to NOW on the
// Day map too, not only to the wall.
test("no one thing: picking the second task puts it at NOW on the Day map", async ({ page }) => {
  await enterDemo(page, { width: 1280, height: 900 }, "2024-06-15T10:00:00");
  await page.locator(".wall-title").click();
  await page.getByTestId("task-detail").getByRole("button", { name: /^Not the one thing now/ }).click();
  await expect(page.locator(".wall-pick")).toBeVisible();
  const second = (await page.locator(".wall-pick-title").nth(1).innerText()).trim();
  await page.locator(".wall-pick-row").nth(1).click();
  await expect(page.locator(".wall-title")).toHaveText(second);
  await routeReady(page);
  await expect(column(page).locator("button.tdm-stop .tdm-title").first()).toContainText(second);
  await expect(column(page).locator("button.tdm-stop .tdm-title").first()).toContainText("THE ONE THING");
});

// Loopcheck of #486: with only set-time things open (a call can't be the one
// thing), the wall says so, not "Nothing in Today yet" over a list that has
// tasks in it.
test("no one thing, only set-time things open: the wall says so", async ({ page }) => {
  await enterDemo(page, { width: 1280, height: 900 });
  // A call at a set time, made on the Day map page (as in the fixed-time test).
  await openDayMapPage(page);
  await page.getByRole("button", { name: "Fixed time" }).click();
  await page.getByRole("dialog", { name: "Fix a time" }).getByRole("button", { name: /Something else/ }).click();
  const step2 = page.getByRole("dialog", { name: /^Fix a time: Something else/ });
  await step2.getByRole("textbox", { name: "What" }).fill("Call with the recruiter");
  await step2.getByRole("radio", { name: "12:00" }).click();
  await step2.getByRole("button", { name: "Fix at 12:00" }).click();
  await page.locator(".dm-back").click();
  await page.locator(".wall-title").click();
  await page.getByTestId("task-detail").getByRole("button", { name: /^Not the one thing now/ }).click();
  const rows = page.getByTestId("today-tasks-list").locator("[data-testid='task-row']:not(.completed)");
  const others = rows.filter({ hasNotText: "Call with the recruiter" });
  while (await others.count()) {
    await others.first().locator(".task-title-text").click();
    await page.getByTestId("task-detail").getByRole("button", { name: "Park", exact: true }).click();
    await expect(page.getByTestId("task-detail")).toHaveCount(0);
  }
  await expect(rows).toHaveCount(1);
  await expect(page.locator(".wall-empty-title")).toHaveText("Only set-time things left");
  await expect(page.locator(".wall-pick-all")).toHaveText("All 1 task");
});

// Try-out 19: the From panel opens in full over Today's Day map view; the
// scrolling column doesn't cut it off.
test("Today's Day map view: the From panel opens whole, and a quarter-hour moves the route", async ({ page }) => {
  await enterDemo(page, { width: 1680, height: 1000 });
  await routeReady(page);
  await column(page).locator(".dm-from-select").click();
  const panel = page.getByRole("dialog", { name: "Start the route at" });
  const set = panel.getByRole("button", { name: "Set" });
  await expect(set).toBeVisible();
  // Nothing covers it: the topmost element at its centre is the button.
  expect(await set.evaluate(el => { const r = el.getBoundingClientRect(); return document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2) === el; })).toBe(true);
  await panel.getByRole("button", { name: /^\d\d:\d\d$/ }).first().click();
  await expect(panel).toHaveCount(0);
  await expect(column(page).locator(".dm-from-select")).not.toContainText("(now)");
});
