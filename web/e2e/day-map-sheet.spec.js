import { test, expect } from "@playwright/test";

// A Day map stop opens the task sheet (52; the user's pick over the inline
// panel): the sheet on a phone, the drawer from 1024px, with Remove from
// route in its footer. Demo mode, so nothing reaches Firebase.

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
  await page.getByRole("button", { name: "Auto-fill" }).click();
}

const sheet = (page) => page.getByTestId("task-detail");
const stops = (page) => page.locator(".dm-stop .dm-main");
const titles = (page) => page.locator(".dm-stop .dm-title").allInnerTexts().then(ts => ts.map(t => t.trim()));
const times = (page) => page.locator(".dm-stop .dm-time").allInnerTexts();

test("Remove from route: the stop goes, the route is timed again, and Undo puts it back where it was", async ({ page }) => {
  await openDayMap(page, { width: 375, height: 812 });
  const before = await titles(page);
  const beforeTimes = await times(page);
  expect(before.length).toBe(3);

  await stops(page).nth(1).click();
  await expect(sheet(page).locator(".detail-kicker").first()).toHaveText("DAY MAP · 2 OF 3");
  // A Day map footer: no Today-only actions.
  await expect(sheet(page).getByRole("button", { name: /Make this the one thing/ })).toHaveCount(0);
  await expect(sheet(page).getByRole("button", { name: /^Tomorrow/ })).toHaveCount(0);
  await sheet(page).getByRole("button", { name: "Remove from route" }).click();

  await expect(sheet(page)).toHaveCount(0);
  await expect.poll(() => titles(page)).toEqual([before[0], before[2]]);
  // The third stop now starts where the second did.
  await expect.poll(() => times(page)).toEqual([beforeTimes[0], beforeTimes[1]]);
  // Focus goes to the stop that took its place.
  await expect(stops(page).nth(1)).toBeFocused();
  await expect(page.locator(".undo-toast")).toContainText(`Removed from route: ${before[1]}`);

  await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => titles(page)).toEqual(before);
  await expect.poll(() => times(page)).toEqual(beforeTimes);
});

test("the sheet's circle marks the stop done, with Undo; one toast shows, the latest", async ({ page }) => {
  await openDayMap(page, { width: 375, height: 812 });
  const before = await titles(page);

  // A route Undo first…
  await stops(page).nth(2).click();
  await sheet(page).getByRole("button", { name: "Remove from route" }).click();
  await expect(page.locator(".undo-toast")).toContainText("Removed from route");

  // …then Done: its toast replaces the route's, and Undo undoes Done only.
  await stops(page).nth(0).click();
  await sheet(page).getByRole("button", { name: `Mark done: ${before[0]}` }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator(".undo-toast")).toHaveCount(1);
  await expect(page.locator(".undo-toast")).toContainText(`Marked done: ${before[0]}`);
  await expect.poll(() => titles(page)).toEqual([before[1]]);

  await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => titles(page)).toEqual([before[0], before[1]]);
  // The route's older Undo does not come back once Done's is spent.
  await expect(page.locator(".undo-toast")).toHaveCount(0);

  // And the other way round: Done, then a route action — the route's shows.
  await stops(page).nth(0).click();
  await sheet(page).getByRole("button", { name: `Mark done: ${before[0]}` }).click();
  await stops(page).nth(0).click();
  await sheet(page).getByRole("button", { name: "Remove from route" }).click();
  await expect(page.locator(".undo-toast")).toContainText(`Removed from route: ${before[1]}`);
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
  await sheet(page).getByRole("radio", { name: "1h" }).click();
  await expect(page.locator(".dm-stop").nth(0).locator(".dm-dur")).toHaveText("1h");
  const [first, second] = await times(page);
  expect(first).toBe("NOW");
  // 11:35 rounds to 11:45; an hour, then the 5-minute gap.
  expect(second).toBe("12:50");
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

// Codex review of #415: the sheet shows the duration the route uses.
test("the sheet's estimate is the stop's duration even when set to None", async ({ page }) => {
  await openDayMap(page, { width: 375, height: 812 });
  await stops(page).nth(0).click();
  await sheet(page).getByRole("button", { name: /^Estimate/ }).click();
  await sheet(page).getByRole("radio", { name: "None" }).click();
  await expect(page.locator(".dm-stop").nth(0).locator(".dm-dur")).toHaveText("25m");
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
  const floating = page.getByRole("button", { name: /^Return to Focus/ });
  await expect(floating).toBeVisible();

  await page.getByRole("button", { name: "Day map →" }).click();
  await page.getByRole("button", { name: "Auto-fill" }).click();
  await page.locator(".dm-stop .dm-main", { hasText: wallTitle }).click();
  await sheet(page).getByRole("button", { name: /^Horizon/ }).click();
  await sheet(page).getByRole("radio", { name: "This week" }).click();

  await expect(page.locator(".dm-stop", { hasText: wallTitle })).toHaveCount(0);
  // (The Day map hides the floating timer, so look for it back on Today.)
  await page.locator(".dm-back").click();
  await expect(page.getByTestId("today-tasks-list")).toBeVisible();
  await expect(floating).toHaveCount(0);
  await expect(page.locator(".today-wall .wall-title", { hasText: wallTitle })).toHaveCount(0);
});

// Codex review of #415: a stop moved to a later horizon leaves the route for
// good; brought back to Today it waits in Unscheduled, not in its old slot.
test("a stop moved off Today and back waits in Unscheduled, not in its old slot", async ({ page }) => {
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
  await page.getByRole("button", { name: "Day map →" }).click();

  await expect.poll(() => titles(page)).toEqual([before[0], before[2]]);
  await expect(page.locator(".dm-pool .dm-pool-list")).toContainText(before[1]);
});

// Codex review of #415: More details opens the full editor from a stop. An
// estimate changed there times the route again, as the sheet's does.
test("More details: an estimate changed in the full editor times the route again", async ({ page }) => {
  await openDayMap(page, { width: 1280, height: 800 });
  const beforeTimes = await times(page);
  await stops(page).nth(0).click();
  await sheet(page).getByRole("button", { name: /^More details/ }).click();
  const editor = page.getByRole("dialog", { name: "Edit task" });
  await editor.getByRole("button", { name: "2h", exact: true }).click();
  await page.getByTestId("add-task-submit").click();
  await expect(page.locator(".dm-stop").nth(0).locator(".dm-dur")).toHaveText("2h");
  // 11:45 + 2h + the 5-minute gap.
  await expect.poll(async () => (await times(page))[1]).toBe("13:50");
  expect(beforeTimes[1]).not.toBe("13:50");
});

// …and a horizon changed there takes the one thing off Today properly: its
// session ends and its slot goes (Today's own editor gets the same).
test("More details: the one thing moved off Today in the full editor ends its session and leaves the route", async ({ page }) => {
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
  const floating = page.getByRole("button", { name: /^Return to Focus/ });
  await expect(floating).toBeVisible();

  await page.getByRole("button", { name: "Day map →" }).click();
  await page.getByRole("button", { name: "Auto-fill" }).click();
  const before = await titles(page);
  await page.locator(".dm-stop .dm-main", { hasText: wallTitle }).click();
  await sheet(page).getByRole("button", { name: /^More details/ }).click();
  const editor = page.getByRole("dialog", { name: "Edit task" });
  await editor.getByRole("group", { name: "Horizon" }).getByRole("button", { name: "Week", exact: true }).click();
  await page.getByTestId("add-task-submit").click();

  await expect.poll(() => titles(page)).toEqual(before.filter(t => t !== wallTitle));
  // The next stop moved up into the freed start.
  await expect(page.locator(".dm-stop").nth(0).locator(".dm-time")).toHaveText("NOW");
  await page.locator(".dm-back").click();
  await expect(page.getByTestId("today-tasks-list")).toBeVisible();
  await expect(floating).toHaveCount(0);
});
