import { test, expect } from "@playwright/test";

// Day map's honest day end (Addendum Y5; 33a, 34c, 37d). Demo mode, so
// nothing reaches Firebase. The demo sets its focus window to 07:00–02:00, so
// at 21:00 the day has 5h left and ends at 02:00.

async function openDayMapAt(page, time, viewport = { width: 412, height: 892 }) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.clock.setFixedTime(new Date(time));
  await expect(page.getByTestId("demo-btn")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Day map →" }).click();
  await expect(page.getByRole("heading", { name: "Day map" })).toBeVisible({ timeout: 8_000 });
  // Every open Today task is on the route (Q59).
  await expect(page.locator(".dm-stop")).toHaveCount(3);
}

const fact = (page) => page.locator(".dm-fact");

// Makes the first stop 3h and the last 2h (from their sheets): 21:00–00:00,
// 00:05–00:30, then 00:35–02:35, which ends past the 02:00 line (56a), so
// only the last stop won't fit.
async function overfill(page) {
  const sheet = page.getByTestId("task-detail");
  for (const [i, length] of [[0, "3h"], [2, "2h"]]) {
    await page.locator(".dm-stop .dm-main").nth(i).click();
    await sheet.getByRole("button", { name: /^Estimate/ }).click();
    await sheet.getByRole("radio", { name: length }).click();
    await sheet.getByRole("button", { name: "Close", exact: true }).click();
    await expect(sheet).toHaveCount(0);
  }
}

test("a route that fits: the day ends at the end of the focus window, with the time to spare", async ({ page }) => {
  await openDayMapAt(page, "2024-06-15T21:00:00");
  await expect(page.locator(".dm-dayend")).toHaveText(/^DAY ENDS 02:00 · \d+h(\d+m)? FREE$/);
  await expect(fact(page)).toHaveText(/^On track: done by \d{2}:\d{2}\.$/);
  await expect(page.locator(".dm-daybar-past")).toHaveCount(0);
  await expect(page.locator(".dm-stop.is-over")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Move \d+ to tomorrow/ })).toHaveCount(0);
});

test("stops after the day end are marked, and Move N to tomorrow takes them off today's route, with Undo", async ({ page }) => {
  await openDayMapAt(page, "2024-06-15T21:00:00");
  await overfill(page);

  const dayEnd = page.locator(".dm-dayend");
  await expect(dayEnd).toContainText("DAY ENDS 02:00");
  await expect(page.locator(".dm-stop.is-over")).toHaveCount(1);
  // 56a: the line says it in words, the overrun in red; the bar hatches it.
  await expect(fact(page)).toHaveText("Keep this order and you finish at 02:35, 35 minutes past your day end.");
  await expect(fact(page).locator(".dm-fact-alert")).toHaveText("35 minutes past your day end.");
  await expect(page.locator(".dm-daybar-legend")).toContainText("past your day end 35m");
  // Screen readers hear where a stop sits against the day's end (brief §6).
  await expect(page.locator(".dm-stop.is-over .dm-main")).toHaveAttribute("aria-label", /after the day ends$/);

  await page.getByRole("button", { name: "Move 1 to tomorrow" }).click();
  await expect(page.locator(".undo-toast")).toContainText("1 task moved to tomorrow");
  await expect(page.locator(".dm-stop")).toHaveCount(2);
  await expect(page.locator(".dm-tomorrow-note")).toHaveText("1 task now starts tomorrow.");
  // What is left ends at 00:30: an hour and a half to spare.
  await expect(dayEnd).toHaveText("DAY ENDS 02:00 · 1h30m FREE");

  await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".dm-stop")).toHaveCount(3);
  await expect(page.locator(".dm-stop.is-over")).toHaveCount(1);
  await page.locator(".dm-back").click();
  // Three tasks: the one thing on the wall, two rows in the list.
  await expect(page.getByTestId("today-tasks-list").locator("[data-testid='task-row']")).toHaveCount(2);
});

test("on a laptop the action sits on the right of the route (52e)", async ({ page }) => {
  await openDayMapAt(page, "2024-06-15T21:00:00", { width: 1280, height: 800 });
  await overfill(page);
  const route = await page.locator(".dm-route-wrap").boundingBox();
  const move = await page.getByRole("button", { name: "Move 1 to tomorrow" }).boundingBox();
  expect(move.x).toBeGreaterThan(route.x + route.width);
  await expect(page.getByRole("button", { name: "Help me choose" })).toBeVisible();
});

test("the next day, moved tasks open tomorrow's route at the top, timed from its start", async ({ page }) => {
  await openDayMapAt(page, "2024-06-15T21:00:00");
  await overfill(page);
  const moved = (await page.locator(".dm-stop.is-over .dm-title").innerText()).trim();
  await page.getByRole("button", { name: "Move 1 to tomorrow" }).click();
  await page.locator(".dm-back").click();
  // Tomorrow means not today: it has left Today's list.
  const list = page.getByTestId("today-tasks-list");
  await expect(list).toBeVisible();
  await expect(list.getByText(moved)).toHaveCount(0);

  await page.clock.setFixedTime(new Date("2024-06-16T09:00:00"));
  // The next day it is back, at the top of the list (the NOW row aside).
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Today", exact: true }).click();
  await expect(list.locator("[data-testid='task-row']:not(:has(.task-tag.is-now))").first()).toContainText(moved);
  await expect(list.locator("[data-testid='task-row']").first().locator(".from-yesterday")).toHaveText("FROM YESTERDAY");
  const oneThing = (await page.locator(".wall-title").innerText()).trim();
  await page.getByRole("button", { name: "Day map →" }).click();
  // Q59: the one thing heads the route at NOW; the moved task comes next,
  // timed from today's start (09:00, after the one thing's 3h and a 5-minute
  // buffer), not left at midnight; FROM YESTERDAY under its title (Q7).
  // Yesterday's other stops join today's route too.
  const stops = page.locator(".dm-stop");
  await expect(stops).toHaveCount(3);
  await expect(stops.first().locator(".dm-title")).toContainText(oneThing);
  await expect(stops.first().locator(".dm-time")).toHaveText("NOW");
  await expect(stops.nth(1).locator(".dm-title")).toContainText(moved);
  await expect(stops.nth(1).locator(".from-yesterday")).toHaveText("FROM YESTERDAY");
  await expect(stops.nth(1).locator(".dm-time")).toHaveText("12:05");
  await expect(page.locator(".dm-time", { hasText: "00:00" })).toHaveCount(0);
});

// The demo's window runs to 02:00. Tomorrow is the next Loci day, not the next
// calendar date: at 00:30 the day is still going, so the task stays off it.
test("with a window to 02:00, a moved task stays off Today past midnight and returns when the day turns", async ({ page }) => {
  await openDayMapAt(page, "2024-06-15T21:00:00");
  await overfill(page);
  const moved = (await page.locator(".dm-stop.is-over .dm-title").innerText()).trim();
  await page.getByRole("button", { name: "Move 1 to tomorrow" }).click();
  await page.locator(".dm-back").click();
  const list = page.getByTestId("today-tasks-list");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  const revisitToday = async () => {
    await nav.getByRole("button", { name: "Plan", exact: true }).click();
    await nav.getByRole("button", { name: "Today", exact: true }).click();
    await expect(list).toBeVisible();
  };

  await page.clock.setFixedTime(new Date("2024-06-16T00:30:00"));
  await revisitToday();
  await expect(list.getByText(moved)).toHaveCount(0);

  await page.clock.setFixedTime(new Date("2024-06-16T02:30:00"));
  await revisitToday();
  await expect(list.getByText(moved)).toHaveCount(1);
});

// Past midnight in a window that runs to 02:00, the Day map still counts the
// day it is in: the route starts now (00:30), not at yesterday evening's 21:00,
// and 1h30m are left, not 5h.
test("at 00:30 with a window to 02:00, the route starts now and the day has 1h30m left", async ({ page }) => {
  await openDayMapAt(page, "2024-06-15T21:00:00");
  await page.locator(".dm-back").click();
  await page.clock.setFixedTime(new Date("2024-06-16T00:30:00"));
  await page.getByRole("button", { name: "Day map →" }).click();
  // 00:30 plus the 1h30m left is 02:00: the route's day ends there.
  await expect(page.locator(".dm-stop .dm-main").first()).toHaveAttribute("aria-label", /^Now to 00:\d\d, /);
  await expect(page.locator(".dm-dayend")).toContainText("DAY ENDS 02:00");
});

// A 09:00–17:00 window, opened at 18:00: the day is over, so every stop is
// past the line.
async function dayOverAt18(page, { unpin }) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("loci_today_peek_open", "1"); } catch { /* private mode */ }
  });
  await page.setViewportSize({ width: 412, height: 892 });
  await page.goto("/");
  await page.clock.setFixedTime(new Date("2024-06-15T18:00:00"));
  await page.getByTestId("demo-btn").click();
  await expect(page.locator(".app-container")).toBeVisible({ timeout: 10_000 });
  // Settings › Focus windows. The demo's day is its old 07:00–02:00 hours;
  // this replaces them with one 09:00–17:00 window, saved as it changes.
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: /^Focus windows/ }).click();
  await page.getByRole("button", { name: "Remove focus window 1" }).click();
  await page.getByRole("button", { name: "Add a window" }).click();
  await expect(page.getByLabel("Focus window 1 start time")).toHaveValue("09:00");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Today", exact: true }).click();
  if (unpin) {
    await page.locator(".wall-title").click();
    await page.getByTestId("task-detail").getByRole("button", { name: /^Not the one thing now/ }).click();
  }
  await page.getByRole("button", { name: "Day map →" }).click();
  await expect(page.locator(".dm-stop.is-over")).toHaveCount(3);
}

test("the pinned task is never moved to tomorrow from here: it may have a session open", async ({ page }) => {
  await dayOverAt18(page, { unpin: false });
  // The day ended with its window, 17:00, not when the page opened (Codex
  // review of #428).
  await expect(page.locator(".dm-fact")).toHaveText(/^Your day ended at 17:00\. 3 tasks left, /);
  await expect(page.locator(".dm-stop.is-over")).toHaveCount(3);
  await page.getByRole("button", { name: "Move 2 to tomorrow" }).click();
  await expect(page.locator(".dm-stop")).toHaveCount(1);
});

test("with everything moved to tomorrow, the page says so instead of 'all tasks are on the route'", async ({ page }) => {
  await dayOverAt18(page, { unpin: true });
  await page.getByRole("button", { name: "Move 3 to tomorrow" }).click();
  await expect(page.getByRole("heading", { name: "Nothing left for today" })).toBeVisible();
  await expect(page.getByText("3 tasks start tomorrow.")).toBeVisible();
  await expect(page.getByText(/all tasks are on the route/)).toHaveCount(0);
});
