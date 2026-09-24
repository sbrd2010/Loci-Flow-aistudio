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
  await page.getByRole("button", { name: "Auto-fill" }).click();
  await expect(page.getByText("Unscheduled · 0")).toBeVisible();
}

// Makes the second stop 6h long, so the third starts after the day ends.
async function overfill(page) {
  const second = page.locator(".dm-stop").nth(1);
  await second.locator(".dm-options").click();
  await second.locator(".dm-panel select").selectOption("360");
  await second.locator(".dm-options").click();
}

test("a route that fits says so, and the day ends at the end of the focus window", async ({ page }) => {
  await openDayMapAt(page, "2024-06-15T21:00:00");
  await expect(page.getByRole("region", { name: "Day plan" })).toContainText("Route fits the day");
  await expect(page.locator(".dm-end")).toContainText("02:00");
  await expect(page.locator(".dm-end")).toContainText("Day ends.");
  await expect(page.locator(".dm-dayend")).toHaveCount(0);
});

test("stops after the day end are marked, and Move N to tomorrow takes them off today's route, with Undo", async ({ page }) => {
  await openDayMapAt(page, "2024-06-15T21:00:00");
  await overfill(page);

  const dayEnd = page.locator(".dm-dayend");
  await expect(dayEnd).toContainText("02:00");
  await expect(dayEnd).toContainText(/Day ends · 1 won't fit/i);
  await expect(page.locator(".dm-stop.is-over")).toHaveCount(1);
  const status = page.getByRole("region", { name: "Day plan" });
  await expect(status).toContainText("7h planned in 5h");
  await expect(status).toContainText("+2h");
  // Screen readers hear where a stop sits against the day's end (brief §6).
  await expect(page.locator(".dm-stop.is-over .dm-main")).toHaveAttribute("aria-label", /after the day ends$/);

  await status.getByRole("button", { name: "Move 1 to tomorrow" }).click();
  await expect(page.locator(".undo-toast")).toContainText("1 task moved to tomorrow");
  await expect(page.locator(".dm-stop")).toHaveCount(2);
  await expect(page.locator(".dm-end")).toContainText("Day ends. 1 task now starts tomorrow.");
  // Not deleted, and not back in today's pool either.
  await expect(page.getByText("Unscheduled · 0")).toBeVisible();
  // The 6h stop still starts in time but runs past the end: said, not hidden.
  await expect(status).toContainText("runs 1h30m past 02:00");

  await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".dm-stop")).toHaveCount(3);
  await expect(dayEnd).toContainText(/1 won't fit/i);
  await page.locator(".dm-back").click();
  await expect(page.getByTestId("today-tasks-list").locator("[data-testid='task-row']")).toHaveCount(3);
});

test("on a laptop the plan sits in a side panel with the full sentence", async ({ page }) => {
  await openDayMapAt(page, "2024-06-15T21:00:00", { width: 1280, height: 800 });
  await overfill(page);
  const status = page.getByRole("region", { name: "Day plan" });
  await expect(status).toContainText("1 task won't fit before 02:00.");
  await expect(status).toContainText("Nothing is deleted. Moved tasks go to the top of tomorrow.");
  const route = await page.locator(".dm-route-wrap").boundingBox();
  const panel = await status.boundingBox();
  expect(panel.x).toBeGreaterThan(route.x + route.width);
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
  await page.getByRole("button", { name: "Day map →" }).click();
  const first = page.locator(".dm-stop").first();
  await expect(first.locator(".dm-title")).toHaveText(moved);
  await expect(first.locator(".dm-time")).toHaveText("NOW");
  // Timed from today's start (09:00), not left at midnight.
  await expect(first.locator(".dm-main")).toHaveAttribute("aria-label", /^Now to 09:\d\d, /);
  await expect(page.locator(".dm-stop")).toHaveCount(1);
  await expect(page.locator(".dm-time", { hasText: "00:00" })).toHaveCount(0);
  // Yesterday's other stops are not carried over; they wait in Unscheduled.
  await expect(page.getByText("Unscheduled · 2")).toBeVisible();
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
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  if (!(await page.locator("#settings-name").isVisible())) {
    await page.getByRole("button", { name: /Your Profile/i }).click();
  }
  await page.getByRole("button", { name: "+ Add focus window" }).click();
  await page.getByRole("button", { name: /Save Profile/ }).click();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Today", exact: true }).click();
  if (unpin) {
    const now = page.getByTestId("today-tasks-list").locator("[data-testid='task-row']", { has: page.locator(".task-tag.is-now") });
    await now.locator(".task-row-top").click();
    await page.getByText("Unpin from Focus").click();
  }
  await page.getByRole("button", { name: "Day map →" }).click();
  await page.getByRole("button", { name: "Auto-fill" }).click();
  await expect(page.locator(".dm-stop.is-over")).toHaveCount(3);
}

test("the pinned task is never moved to tomorrow from here: it may have a session open", async ({ page }) => {
  await dayOverAt18(page, { unpin: false });
  await expect(page.locator(".dm-dayend")).toContainText(/3 won't fit/i);
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
