import { test, expect } from "@playwright/test";

// 50k–l: from 1600px the cap is 1760px, and the Day map is Today's third
// column while the list is open. The list never passes 720px.

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

// Lays every Today task on the route (the Day map page's Auto-fill), then back.
async function autoFillRoute(page) {
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("m");
  await page.getByRole("button", { name: "Auto-fill" }).click();
  await page.getByRole("button", { name: "Back to Today" }).click();
  await expect(page.locator(".day-map-page")).toHaveCount(0);
}

const column = (page) => page.getByRole("complementary", { name: "Day map" });

test("1680: the Day map is a third column beside a 720px list, and goes with the list", async ({ page }) => {
  await enterDemo(page, { width: 1680, height: 1000 });
  await expect(column(page)).toBeVisible();
  await expect(column(page)).toContainText("Nothing on the route yet.");

  const list = await page.locator("section.today-list").boundingBox();
  const map = await column(page).boundingBox();
  expect(Math.round(list.width)).toBe(720);
  expect(map.x).toBeGreaterThan(list.x + list.width);
  expect(map.x + map.width).toBeLessThanOrEqual(1680 - 40);

  await autoFillRoute(page);
  const stops = column(page).getByRole("list", { name: "Today's route" }).getByRole("button");
  await expect(stops).toHaveCount(3);
  await expect(stops.first()).toHaveAccessibleName(/^Now to /);
  await expect(column(page).locator(".tdm-dayend")).toHaveText(/^DAY ENDS 02:00 · \d+h\d{2}m FREE$/);

  // Hiding the list takes the column with it; showing it brings it back.
  // (51e: it leaves as the list does, and rides in 30ms behind it.)
  // The toggle runs in the keydown, so its copy is there the moment it ends.
  const ghosts = await page.evaluate(() => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    return document.querySelectorAll("body > .today-daymap[aria-hidden='true']").length;
  });
  expect(ghosts).toBe(1);
  await expect(column(page)).toHaveCount(0);
  await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== "running"));
  await page.keyboard.press("l");
  await expect(column(page)).toBeVisible();
  const delays = await page.evaluate(() => ({
    list: document.querySelector("section.today-list").getAnimations().map(a => a.effect.getTiming().delay),
    column: document.querySelector(".today-daymap:not([aria-hidden])").getAnimations().map(a => a.effect.getTiming().delay),
  }));
  expect(delays.list).toContain(60);
  expect(delays.column).toEqual([90]);

  // The heading opens the Day map itself.
  await column(page).getByRole("button", { name: "Day map" }).click();
  await expect(page.locator(".day-map-page")).toBeVisible();
});

test("below 1600 there is no Day map column", async ({ page }) => {
  await enterDemo(page, { width: 1599, height: 1000 });
  await expect(page.getByTestId("today-tasks-list")).toBeVisible();
  await expect(column(page)).toHaveCount(0);
});

test("2130: the content stops at 1760px and the margins take the rest", async ({ page }) => {
  await enterDemo(page, { width: 2130, height: 1000 });
  const wall = await page.locator(".today-layout").boundingBox();
  expect(Math.round(wall.width)).toBeLessThanOrEqual(1760);
  expect(Math.round(wall.width)).toBeGreaterThanOrEqual(1740);
  const list = await page.locator("section.today-list").boundingBox();
  expect(Math.round(list.width)).toBe(720);
  const brand = await page.getByRole("banner").getByRole("button", { name: "Loci" }).boundingBox();
  expect(Math.abs(brand.x - wall.x)).toBeLessThan(2);
});

test("won't fit: Move N to tomorrow moves the stops past the day's end, with Today's Undo", async ({ page }) => {
  // 01:00, an hour before the demo's day ends at 02:00: the third stop starts
  // at 02:00, so it won't fit.
  await enterDemo(page, { width: 1680, height: 1000 }, "2024-06-16T01:00:00");
  await autoFillRoute(page);
  await expect(column(page).locator(".tdm-status")).toHaveText("25m over");
  await expect(column(page).getByRole("heading", { name: /^WON’T FIT TODAY · 25m$/ })).toBeVisible();
  const late = column(page).getByRole("list", { name: "Won't fit today" }).getByRole("button");
  await expect(late).toHaveCount(1);
  await expect(late).toHaveAccessibleName(/, after the day ends$/);
  const title = (await late.locator(".tdm-title").textContent()).trim();

  const list = page.getByTestId("today-tasks-list");
  await column(page).getByRole("button", { name: "Move 1 to tomorrow" }).click();
  await expect(page.locator(".undo-toast")).toContainText("1 task moved to tomorrow");
  await expect(column(page).getByRole("button", { name: /Move \d+ to tomorrow/ })).toHaveCount(0);
  await expect(list.locator(".today-task-row", { hasText: title })).toHaveCount(0);

  await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
  await expect(column(page).getByRole("button", { name: "Move 1 to tomorrow" })).toBeVisible();
  await expect(list.getByText(title, { exact: true })).toBeVisible();
});

test("a stop opens its task in a drawer in the map column's place, clear of the list; Esc goes back to the stop", async ({ page }) => {
  await enterDemo(page, { width: 1680, height: 1000 });
  await autoFillRoute(page);
  const stop = column(page).getByRole("list", { name: "Today's route" }).getByRole("button").nth(1);
  await stop.click();
  const drawer = page.locator(".task-detail.is-drawer");
  await expect(drawer).toBeVisible();
  // 52: the drawer takes the column's place and width (360–480).
  await expect(column(page)).toBeHidden();
  const listBox = await page.locator("section.today-list").boundingBox();
  const drawerBox = await drawer.boundingBox();
  expect(drawerBox.x).toBeGreaterThanOrEqual(listBox.x + listBox.width);
  expect(drawerBox.x + drawerBox.width).toBeLessThanOrEqual(1680 + 1);
  expect(Math.round(drawerBox.width)).toBe(420);

  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(column(page)).toBeVisible();
  await expect(stop).toBeFocused();
});

test("1600: the drawer keeps 360px, clear of the list, its footer on one row", async ({ page }) => {
  await enterDemo(page, { width: 1600, height: 900 });
  await autoFillRoute(page);
  await column(page).getByRole("list", { name: "Today's route" }).getByRole("button").nth(1).click();
  const drawer = page.locator(".task-detail.is-drawer");
  await expect(drawer).toBeVisible();
  const listBox = await page.locator("section.today-list").boundingBox();
  const drawerBox = await drawer.boundingBox();
  expect(Math.round(drawerBox.width)).toBe(360);
  expect(drawerBox.x).toBeGreaterThanOrEqual(listBox.x + listBox.width);
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

test("a stop the Must-do filter hides opens anyway, the filter stays; Show all, and ↑/↓ into the filtered list", async ({ page }) => {
  await enterDemo(page, { width: 1680, height: 1000 });
  await autoFillRoute(page);
  const list = page.getByTestId("today-tasks-list");
  const drawer = page.locator(".task-detail.is-drawer");
  const kicker = drawer.locator(".detail-kicker").first();
  // One must-do, so the filtered list has a task in it.
  await list.getByText("10-minute walk between tasks to reset your focus").click();
  await drawer.getByRole("switch", { name: "Must-do" }).click();
  await page.keyboard.press("Escape");
  const mustDo = page.getByRole("button", { name: /^Must-do · \d+$/ });
  await mustDo.click();
  await expect(mustDo).toHaveAttribute("aria-pressed", "true");

  const hidden = column(page).getByRole("button", { name: /25-minute deep work block/ });
  await hidden.click();
  await expect(kicker).toHaveText("TODAY · HIDDEN BY MUST-DO");
  await expect(mustDo).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowDown");
  await expect(kicker).toHaveText("TODAY · 1 OF 1");
  await expect(drawer.locator(".detail-title")).toHaveText(/10-minute walk/);
  await page.keyboard.press("Escape");

  await hidden.click();
  await drawer.getByRole("button", { name: "Show all" }).click();
  await expect(page.getByRole("button", { name: /^All · \d+$/ })).toHaveAttribute("aria-pressed", "true");
  await expect(kicker).toHaveText(/^TODAY · \d+ OF \d+$/);
  await expect(drawer.getByRole("button", { name: "Show all" })).toHaveCount(0);
});
