import { test, expect } from "@playwright/test";
import { openDayMapPage } from "./helpers/today";

// A Day map stop opens the task sheet (52; the user's pick over the inline
// panel): the sheet on a phone, the drawer from 1024px, with Fix time in its
// footer. Demo mode, so nothing reaches Firebase.

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
  await openDayMapPage(page);
  await expect(page.locator(".day-map-page")).toBeVisible();
}

const sheet = (page) => page.getByTestId("task-detail");
const stops = (page) => page.locator(".dm-stop .dm-main");
const titles = (page) => page.locator(".dm-stop .dm-title").allInnerTexts().then(ts => ts.map(t => t.trim()));
const times = (page) => page.locator(".dm-stop .dm-time").allInnerTexts();

// Q59: every open Today task is on the route, so a stop can't be taken off
// it; the footer is Fix time, Park and Delete.
test("a stop's sheet: Fix time, Park, Delete; no Remove from route, no Today-only actions", async ({ page }) => {
  await openDayMap(page, { width: 375, height: 812 });
  expect((await titles(page)).length).toBe(3);
  await stops(page).nth(1).click();
  await expect(sheet(page).locator(".detail-kicker").first()).toHaveText("DAY MAP · 2 OF 3");
  await expect(sheet(page).getByRole("button", { name: "Remove from route" })).toHaveCount(0);
  await expect(sheet(page).getByRole("button", { name: /Make this the one thing/ })).toHaveCount(0);
  await expect(sheet(page).getByRole("button", { name: /^Tomorrow/ })).toHaveCount(0);
  await expect(sheet(page).getByRole("button", { name: "Fix time" })).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "Park" })).toBeVisible();
});

test("the sheet's circle marks the stop done, with Undo; one toast shows, the latest", async ({ page }) => {
  await openDayMap(page, { width: 375, height: 812 });
  const before = await titles(page);

  // A route Undo first (a fixed time)…
  const fixLast = async () => {
    await stops(page).last().click();
    await sheet(page).getByRole("button", { name: /^(Fix time|Fixed at .* · Change time)$/ }).click();
    await page.getByRole("dialog", { name: /^Fix a time: / }).getByRole("textbox", { name: "At" }).press("Enter");
  };
  await fixLast();
  await expect(page.locator(".undo-toast")).toContainText(`${before[2]} fixed at`);

  // …then Done: its toast replaces the route's, and Undo undoes Done only.
  await stops(page).nth(0).click();
  await sheet(page).getByRole("button", { name: `Mark done: ${before[0]}` }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator(".undo-toast")).toHaveCount(1);
  await expect(page.locator(".undo-toast")).toContainText(`Marked done: ${before[0]}`);
  await expect.poll(() => titles(page)).toEqual([before[1], before[2]]);

  await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => titles(page)).toEqual(before);
  // The route's older Undo does not come back once Done's is spent.
  await expect(page.locator(".undo-toast")).toHaveCount(0);

  // And the other way round: Done, then a route action — the route's shows.
  await stops(page).nth(0).click();
  await sheet(page).getByRole("button", { name: `Mark done: ${before[0]}` }).click();
  await fixLast();
  await expect(page.locator(".undo-toast")).toHaveCount(1);
  await expect(page.locator(".undo-toast")).toContainText(`${before[2]} fixed at`);
});

test("laptop: the drawer; ↑/↓ walk the route; Esc closes it before the page, wherever focus is", async ({ page }) => {
  await openDayMap(page, { width: 1280, height: 800 });
  await stops(page).nth(0).click();
  await expect(sheet(page)).toHaveClass(/is-drawer/);
  await expect(page.locator(".dm-stop").nth(0)).toHaveClass(/is-open/);

  await sheet(page).locator(".detail-title").focus();
  await page.keyboard.press("ArrowDown");
  await expect(sheet(page).locator(".detail-kicker").first()).toHaveText("DAY MAP · 2 OF 3");
  await expect(page.locator(".dm-stop").nth(1)).toHaveClass(/is-open/);

  // The drawer is not modal: focus out on the page, Esc still closes it and
  // leaves the Day map open.
  await page.locator(".dm-heading").click();
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator(".day-map-page")).toBeVisible();
  // The next Esc goes back, as before.
  await page.keyboard.press("Escape");
  await expect(page.locator(".day-map-page")).toHaveCount(0);
});

test("the sheet's estimate is the stop's duration, and the route is timed again", async ({ page }) => {
  await openDayMap(page, { width: 375, height: 812 });
  await stops(page).nth(0).click();
  await sheet(page).getByRole("button", { name: /^Estimate/ }).click();
  // Codex review of #418: a stop always has a length — no None to pick.
  await expect(sheet(page).getByRole("radio", { name: "None" })).toHaveCount(0);
  await sheet(page).getByRole("radio", { name: "1h", exact: true }).click();
  await expect(page.locator(".dm-stop").nth(0).locator(".dm-dur")).toHaveText("1h");
  const [first, second] = await times(page);
  expect(first).toBe("NOW");
  // From 11:35 exactly; an hour, then the 5-minute gap on a 5-minute mark.
  expect(second).toBe("12:40");
});

// Codex review of #415: Done (and Park, Delete) from the sheet times the
// route again, and Undo puts the stop back in its place and its time.
test("Done from the sheet closes the gap; Undo puts the stop back where it was", async ({ page }) => {
  await openDayMap(page, { width: 1280, height: 800 });
  // Route order unlike the list's: the last stop moved up one. The stop put
  // back then shares its order with one that sits before it in the list.
  const start = await titles(page);
  await stops(page).nth(2).focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".dm-stop.is-dragging")).toHaveCount(1);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.keyboard.press("ArrowUp");
  await page.waitForFunction(() => {
    const el = document.querySelector(".dm-stop.is-dragging");
    return !!el && el.style.transform && !/translate3d\(0px, 0px/.test(el.style.transform);
  });
  await page.keyboard.press("Space");
  await expect.poll(() => titles(page)).toEqual([start[0], start[2], start[1]]);
  const before = await titles(page);
  const beforeTimes = await times(page);

  await stops(page).nth(1).click();
  await sheet(page).getByRole("button", { name: `Mark done: ${before[1]}` }).click();
  await expect.poll(() => titles(page)).toEqual([before[0], before[2]]);
  await expect.poll(() => times(page)).toEqual([beforeTimes[0], beforeTimes[1]]);

  await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => titles(page)).toEqual(before);
  await expect.poll(() => times(page)).toEqual(beforeTimes);
});

// Codex review of #415: the sheet shows the duration the route uses — for a
// task with no estimate (cleared from Today's sheet; a stop offers no None),
// the 25m the route gives it.
test("the sheet's estimate is the stop's duration for a task with no estimate", async ({ page }) => {
  await openDayMap(page, { width: 375, height: 812 });
  const title = (await titles(page))[1];
  await page.locator(".dm-back").click();
  await page.getByTestId("today-tasks-list").getByText(title, { exact: true }).click();
  await sheet(page).getByRole("button", { name: /^Estimate/ }).click();
  await sheet(page).getByRole("radio", { name: "None", exact: true }).click();
  await sheet(page).getByRole("button", { name: "Close", exact: true }).click();
  await openDayMapPage(page);

  const stop = page.locator(".dm-stop", { hasText: title });
  await expect(stop.locator(".dm-dur")).toHaveText("25m");
  await stop.locator(".dm-main").click();
  await expect(sheet(page).getByRole("button", { name: /^Estimate/ }).locator(".detail-value")).toHaveText("25m");
});

// Codex review of #415: the sheet's Horizon picker can take the one thing
// off Today; its focus session ends then, as Today's own move ends it.
test("moving the one thing off Today from the sheet ends its focus session", async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.clock.install({ time: new Date("2024-06-15T11:35:00") });
  await page.goto("/");
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  // A session on the one thing, left running.
  const wallTitle = (await page.locator(".today-wall .wall-title").innerText()).trim();
  await page.locator(".today-wall .wall-primary").click();
  const overlay = page.locator(".focus-mode-overlay");
  await expect(overlay).toBeVisible({ timeout: 5_000 });
  await overlay.getByLabel("Leave focus").click();
  // 59e: no focus bar on Today; the Day map shows it.
  const floating = page.getByRole("region", { name: "Focus session" });
  await expect(floating).toHaveCount(0);

  await openDayMapPage(page);
  await expect(floating.getByRole("button", { name: /^Back to focus/ })).toBeVisible();
  await page.locator(".dm-stop .dm-main", { hasText: wallTitle }).click();
  await sheet(page).getByRole("button", { name: /^Horizon/ }).click();
  await sheet(page).getByRole("radio", { name: "This week" }).click();

  await expect(page.locator(".dm-stop", { hasText: wallTitle })).toHaveCount(0);
  // The session ended: the Day map's focus bar goes.
  await expect(floating).toHaveCount(0);
  await page.locator(".dm-back").click();
  await expect(page.getByTestId("today-tasks-list")).toBeVisible();
  await expect(page.locator(".today-wall .wall-title", { hasText: wallTitle })).toHaveCount(0);
});

// Codex review of #415: a stop moved to a later horizon leaves the route for
// good; brought back to Today it joins the route again (Q59), timed with the
// rest.
test("a stop moved off Today and back joins the route again, timed with the rest", async ({ page }) => {
  await openDayMap(page, { width: 1280, height: 800 });
  const before = await titles(page);
  await stops(page).nth(1).click();
  await sheet(page).getByRole("button", { name: /^Horizon/ }).click();
  await sheet(page).getByRole("radio", { name: "This week" }).click();
  await expect.poll(() => titles(page)).toEqual([before[0], before[2]]);

  // Back to Today from Plan's sheet.
  await page.locator(".dm-back").click();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
  await page.locator(".plan-row", { hasText: before[1] }).click();
  await sheet(page).getByRole("button", { name: "Move to Today" }).click();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Today", exact: true }).click();
  await openDayMapPage(page);

  // Its slot is the end of Today's list, wherever that falls in the order;
  // it is on the route again, and no two stops share a start.
  await expect.poll(() => titles(page).then(t => [...t].sort())).toEqual([...before].sort());
  const starts = await times(page);
  expect(new Set(starts).size).toBe(starts.length);
});

// Codex review of #415: a horizon changed in a stop's sheet takes the one
// thing off Today properly: its session ends and its slot goes.
test("the one thing moved off Today from its stop's sheet ends its session and leaves the route", async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.clock.install({ time: new Date("2024-06-15T11:35:00") });
  await page.goto("/");
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  const wallTitle = (await page.locator(".today-wall .wall-title").innerText()).trim();
  await page.locator(".today-wall .wall-primary").click();
  const overlay = page.locator(".focus-mode-overlay");
  await expect(overlay).toBeVisible({ timeout: 5_000 });
  await overlay.getByLabel("Leave focus").click();
  // 59e: no focus bar on Today; the Day map shows it.
  const floating = page.getByRole("region", { name: "Focus session" });
  await expect(floating).toHaveCount(0);

  await openDayMapPage(page);
  await expect(floating.getByRole("button", { name: /^Back to focus/ })).toBeVisible();
  const before = await titles(page);
  await page.locator(".dm-stop .dm-main", { hasText: wallTitle }).click();
  await sheet(page).getByRole("button", { name: /^Horizon/ }).click();
  await sheet(page).getByRole("radio", { name: /^This week/ }).click();

  await expect.poll(() => titles(page)).toEqual(before.filter(t => t !== wallTitle));
  // The next stop moved up into the freed start.
  await expect(page.locator(".dm-stop").nth(0).locator(".dm-time")).toHaveText("NOW");
  // The session ended: the Day map's focus bar goes.
  await expect(floating).toHaveCount(0);
});
